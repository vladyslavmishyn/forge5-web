// Shared test harness: real Postgres (forge5_test), a fresh createApp() per suite on an ephemeral
// port, and a tiny cookie-jar HTTP client that sends real Origin / Content-Type headers.
import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type pg from 'pg';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import type { Mail } from '../src/mailer.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/forge5_test';
if (!/\/[\w-]*_test(\?.*)?$/.test(TEST_DB)) {
  throw new Error(`Refusing to run tests against a non-test database: ${TEST_DB}`);
}

export const ADMIN_PASSWORD = 'correct-horse-battery-staple-42';
export const APP_URL = 'http://localhost:5173';

let sharedPool: pg.Pool | null = null;
export function pool(): pg.Pool {
  if (!sharedPool) sharedPool = createPool({ databaseUrl: TEST_DB, databaseSsl: false });
  return sharedPool;
}
export async function endPool() {
  if (sharedPool) await sharedPool.end();
  sharedPool = null;
}

export async function resetDb(): Promise<void> {
  await pool().query(
    `TRUNCATE ballot_votes, ballots, equipment_request_items, equipment_requests, login_tokens, sessions,
              users, projects RESTART IDENTITY CASCADE`,
  );
  await pool().query(`UPDATE settings SET phase = 'reg'`);
}

export async function setPhase(phase: 'reg' | 'build' | 'vote' | 'result') {
  await pool().query('UPDATE settings SET phase = $1', [phase]);
}

export const sha256hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');

// ---------------------------------------------------------------------------- HTTP client

export interface Res {
  status: number;
  headers: Headers;
  text: string;
  json: any;
  setCookies: string[];
}

export interface ReqOpts {
  /** null = omit the Origin header. Default: the app origin for non-GET. */
  origin?: string | null;
  /** null = omit Content-Type. Default application/json for non-GET. */
  contentType?: string | null;
  /** Send this exact body instead of JSON.stringify(body). */
  raw?: string;
  headers?: Record<string, string>;
}

export class Client {
  jar = new Map<string, string>();
  constructor(
    public base: string,
    public origin = APP_URL,
  ) {}

  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async req(method: string, path: string, body?: unknown, opts: ReqOpts = {}): Promise<Res> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.jar.size) headers.cookie = this.cookieHeader();
    let payload: string | undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = opts.origin === undefined ? this.origin : opts.origin;
      if (origin !== null) headers.origin = origin;
      const ct = opts.contentType === undefined ? 'application/json' : opts.contentType;
      if (ct !== null) headers['content-type'] = ct;
      payload = opts.raw ?? JSON.stringify(body ?? {});
    }
    const r = await fetch(this.base + path, { method, headers, body: payload, redirect: 'manual' });
    const text = await r.text();
    let json: any = undefined;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    const setCookies = r.headers.getSetCookie();
    for (const sc of setCookies) {
      const [pair, ...attrs] = sc.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq).trim();
      const value = pair!.slice(eq + 1).trim();
      const expired =
        value === '' ||
        attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) ||
        attrs.some((a) => {
          const m = /^\s*expires=(.*)$/i.exec(a);
          return m ? new Date(m[1]!).getTime() < Date.now() : false;
        });
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return { status: r.status, headers: r.headers, text, json, setCookies };
  }
  get(path: string, opts?: ReqOpts) {
    return this.req('GET', path, undefined, opts);
  }
  post(path: string, body?: unknown, opts?: ReqOpts) {
    return this.req('POST', path, body, opts);
  }
  put(path: string, body?: unknown, opts?: ReqOpts) {
    return this.req('PUT', path, body, opts);
  }
}

// ---------------------------------------------------------------------------- app

export interface TestApp {
  base: string;
  mails: Mail[];
  config: ReturnType<typeof loadConfig>;
  client(): Client;
  admin(): Promise<Client>;
  close(): Promise<void>;
}

export async function startApp(env: Record<string, string | undefined> = {}): Promise<TestApp> {
  const config = loadConfig({
    DATABASE_URL: TEST_DB,
    APP_URL,
    ADMIN_PASSWORD,
    ALLOWED_EMAIL_DOMAINS: '.edu',
    ...env,
  });
  const mails: Mail[] = [];
  const app = createApp({
    pool: pool(),
    config,
    mailer: {
      async send(m) {
        mails.push(m);
      },
    },
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    mails,
    config,
    client: () => new Client(base, config.appUrl),
    async admin() {
      // Insert an admin session directly so the 5/15min admin-login limiter is not consumed.
      const token = newToken();
      await pool().query(
        `INSERT INTO sessions (token_hash, user_id, is_admin, expires_at) VALUES ($1, NULL, true, now() + interval '1 hour')`,
        [sha256hex(token)],
      );
      const c = new Client(base, config.appUrl);
      c.jar.set('f5_admin', token);
      return c;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------- seeding

export interface SeedUser {
  name?: string;
  email?: string;
  college?: string;
  major?: string;
  skills?: string[];
  diet?: string;
  verified?: boolean;
  wantsTeam?: boolean;
}

let seq = 0;
export async function seedUser(app: TestApp, u: SeedUser = {}): Promise<{ id: number; client: Client; email: string }> {
  seq++;
  const email = u.email ?? `user${seq}.${Date.now()}@test.edu`;
  const r = await pool().query<{ id: number }>(
    `INSERT INTO users (name, email, college, major, skills, diet, wants_team, accepted_ai_policy, accepted_waiver, email_verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,$8) RETURNING id`,
    [
      u.name ?? `User ${seq}`,
      email,
      u.college ?? 'Kenyon College',
      u.major ?? 'Undeclared',
      u.skills ?? [],
      u.diet ?? '',
      u.wantsTeam ?? false,
      u.verified ? new Date() : null,
    ],
  );
  const id = Number(r.rows[0]!.id);
  const token = newToken();
  await pool().query(
    `INSERT INTO sessions (token_hash, user_id, is_admin, expires_at) VALUES ($1, $2, false, now() + interval '1 day')`,
    [sha256hex(token), id],
  );
  const client = app.client();
  client.jar.set('f5_session', token);
  return { id, client, email };
}

export async function seedProject(
  opts: { title?: string; blurb?: string; fields?: string[]; cap?: number; members?: number[] } = {},
): Promise<number> {
  const r = await pool().query<{ id: number }>(
    `INSERT INTO projects (title, blurb, fields, cap, need, created_by) VALUES ($1,$2,$3,$4,'',$5) RETURNING id`,
    [opts.title ?? 'Proj', opts.blurb ?? 'Blurb', opts.fields ?? ['cs', 'bio'], opts.cap ?? 5, opts.members?.[0] ?? null],
  );
  const id = Number(r.rows[0]!.id);
  for (const m of opts.members ?? []) {
    await pool().query('UPDATE users SET project_id = $1, team_joined_at = clock_timestamp() WHERE id = $2', [id, m]);
  }
  return id;
}

export const validRegistration = (over: Record<string, unknown> = {}) => ({
  name: 'Ada Lovelace',
  email: `ada.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@kenyon.edu`,
  college: 'Kenyon College',
  major: 'Mathematics',
  skills: ['Python'],
  diet: 'vegan',
  aiPolicy: true,
  waiver: true,
  wantsTeam: true,
  ...over,
});

export const tokenFromLink = (link: string) => {
  const i = link.indexOf('#token=');
  if (i < 0) throw new Error('no token in link: ' + link);
  return link.slice(i + '#token='.length);
};

/** Error bodies must be a bare {error: string} with nothing that looks like internals. */
export function assertCleanError(res: Res) {
  if (!res.json || typeof res.json.error !== 'string') {
    throw new Error(`expected JSON {error}, got ${res.status} ${res.text.slice(0, 200)}`);
  }
  const keys = Object.keys(res.json);
  if (keys.length !== 1) throw new Error(`error body has extra keys: ${keys.join(',')}`);
  const bad = /(stack|\bat \w+ \(|node_modules|\.ts:\d|\.js:\d|SELECT |INSERT |UPDATE |violates|constraint|relation "|syntax error|pg_|ZodError|"issues")/i;
  if (bad.test(res.text)) throw new Error(`error body leaks internals: ${res.text.slice(0, 300)}`);
}
