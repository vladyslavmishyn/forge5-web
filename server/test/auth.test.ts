import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { loadConfig } from '../src/config.js';
import {
  ADMIN_PASSWORD,
  APP_URL,
  assertCleanError,
  endPool,
  pool,
  resetDb,
  setPhase,
  sha256hex,
  startApp,
  tokenFromLink,
  validRegistration,
  type TestApp,
} from './helpers.js';

const apps: TestApp[] = [];
async function fresh(env: Record<string, string | undefined> = {}) {
  const a = await startApp(env);
  apps.push(a);
  return a;
}

beforeEach(async () => {
  await resetDb();
});
after(async () => {
  for (const a of apps) await a.close();
  await endPool();
});

const cookieAttrs = (sc: string) => sc.split(';').map((s) => s.trim().toLowerCase());

describe('registration + session cookie', () => {
  test('register sets an HttpOnly, SameSite=Lax, Path=/ cookie (not Secure in dev)', async () => {
    const app = await fresh();
    const c = app.client();
    const body = validRegistration();
    const r = await c.post('/api/register', body);
    assert.equal(r.status, 201, r.text);
    const sc = r.setCookies.find((s) => s.startsWith('f5_session='))!;
    assert.ok(sc, 'session cookie set');
    const attrs = cookieAttrs(sc);
    assert.ok(attrs.includes('httponly'));
    assert.ok(attrs.includes('samesite=lax'));
    assert.ok(attrs.includes('path=/'));
    assert.ok(!attrs.includes('secure'));
    assert.equal(r.json.user.email, body.email.toLowerCase());
    assert.equal(r.json.user.emailVerified, false);
    // Session cookie value is not stored in plaintext.
    const token = c.jar.get('f5_session')!;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const rows = await pool().query('SELECT token_hash FROM sessions');
    assert.equal(rows.rowCount, 1);
    assert.notEqual(rows.rows[0].token_hash, token);
    assert.equal(rows.rows[0].token_hash, sha256hex(token));
    // Confirmation email with rules and a fragment link.
    assert.equal(app.mails.length, 1);
    const m = app.mails[0]!;
    assert.equal(m.kind, 'confirm');
    assert.equal(m.to, body.email.toLowerCase());
    assert.ok(m.link.startsWith(`${APP_URL}/signin#token=`));
    assert.ok(m.text.includes(m.link));
    assert.ok(/rules/i.test(m.text));
    // Diet stored, not returned.
    assert.ok(!r.text.includes('vegan'));
  });

  test('Secure cookie when NODE_ENV=production', async () => {
    const app = await fresh({ NODE_ENV: 'production', APP_URL: 'https://forge5.example.edu' });
    const c = app.client();
    const r = await c.post('/api/register', validRegistration());
    assert.equal(r.status, 201, r.text);
    const attrs = cookieAttrs(r.setCookies.find((s) => s.startsWith('f5_session='))!);
    assert.ok(attrs.includes('secure'));
    assert.ok(attrs.includes('httponly'));
    assert.ok(attrs.includes('samesite=lax'));
    const a = await c.post('/api/admin/login', { password: ADMIN_PASSWORD });
    assert.equal(a.status, 200);
    const aattrs = cookieAttrs(a.setCookies.find((s) => s.startsWith('f5_admin='))!);
    assert.ok(aattrs.includes('secure') && aattrs.includes('httponly') && aattrs.includes('samesite=lax'));
    // HSTS in production
    const st = await c.get('/api/state');
    assert.match(st.headers.get('strict-transport-security') ?? '', /max-age=\d+/);
    // Production only accepts the APP_URL origin (no localhost dev origins).
    const d = await app.client().post('/api/auth/link', { email: 'x@y.edu' }, { origin: 'http://localhost:5173' });
    assert.equal(d.status, 403);
  });

  test('registering while signed in -> 409; duplicate email (any case) -> 409', async () => {
    const app = await fresh();
    const c = app.client();
    const body = validRegistration({ email: 'Grace.Hopper@Kenyon.EDU' });
    assert.equal((await c.post('/api/register', body)).status, 201);
    const again = await c.post('/api/register', validRegistration());
    assert.equal(again.status, 409);
    const other = app.client();
    const dup = await other.post('/api/register', validRegistration({ email: 'grace.hopper@kenyon.edu' }));
    assert.equal(dup.status, 409);
    assertCleanError(dup);
    assert.match(dup.json.error, /already registered/i);
    assert.equal(dup.setCookies.length, 0, 'no session for a failed registration');
    const users = await pool().query('SELECT email FROM users');
    assert.deepEqual(users.rows, [{ email: 'grace.hopper@kenyon.edu' }]);
  });

  test('email domain allowlist', async () => {
    const app = await fresh({ ALLOWED_EMAIL_DOMAINS: '.edu' });
    for (const email of ['a@gmail.com', 'a@kenyon.edu.evil.com', 'a@notedu', 'a@kenyon.education']) {
      const r = await app.client().post('/api/register', validRegistration({ email }));
      assert.equal(r.status, 400, `${email} -> ${r.status}`);
      assertCleanError(r);
    }
    assert.equal((await app.client().post('/api/register', validRegistration({ email: 'a@cs.kenyon.edu' }))).status, 201);
    const any = await fresh({ ALLOWED_EMAIL_DOMAINS: '' });
    assert.equal((await any.client().post('/api/register', validRegistration({ email: 'b@gmail.com' }))).status, 201);
    const specific = await fresh({ ALLOWED_EMAIL_DOMAINS: 'kenyon.edu, denison.edu' });
    assert.equal((await specific.client().post('/api/register', validRegistration({ email: 'c@oberlin.edu' }))).status, 400);
    assert.equal((await specific.client().post('/api/register', validRegistration({ email: 'c@denison.edu' }))).status, 201);
    assert.equal((await specific.client().post('/api/register', validRegistration({ email: 'c@evilkenyon.edu' }))).status, 400);
  });

  test('registration validation', async () => {
    const app = await fresh();
    const cases: Record<string, unknown>[] = [
      { aiPolicy: false },
      { waiver: false },
      { college: 'Harvard' },
      { skills: ['Hacking'] },
      { skills: ['Python', 'Python'] },
      { name: '' },
      { name: '   ' },
      { name: 'x'.repeat(81) },
      { name: 'Evil‮Name' },
      { name: 'Line\nBreak' },
      { diet: 'x'.repeat(121) },
      { major: 'x'.repeat(81) },
      { email: 'not-an-email' },
      { email: 'a@b.edu' + 'x'.repeat(260) },
    ];
    for (const over of cases) {
      const r = await app.client().post('/api/register', validRegistration(over));
      assert.equal(r.status, 400, `${JSON.stringify(over).slice(0, 50)} -> ${r.status} ${r.text}`);
      assertCleanError(r);
    }
    assert.equal((await pool().query('SELECT count(*)::int n FROM users')).rows[0].n, 0);
    // Names are trimmed; an absent major defaults to Undeclared.
    const ok = await app.client().post('/api/register', validRegistration({ name: '  Trim Me  ', major: undefined, diet: undefined }));
    assert.equal(ok.status, 201, ok.text);
    assert.equal(ok.json.user.name, 'Trim Me');
    assert.equal(ok.json.user.major, 'Undeclared');
  });

  test('register closed in vote/result phases', async () => {
    const app = await fresh();
    for (const phase of ['vote', 'result'] as const) {
      await setPhase(phase);
      const r = await app.client().post('/api/register', validRegistration());
      assert.equal(r.status, 403, `${phase}`);
    }
    for (const phase of ['reg', 'build'] as const) {
      await setPhase(phase);
      assert.equal((await app.client().post('/api/register', validRegistration())).status, 201);
    }
  });
});

describe('sign-in links', () => {
  test('identical response for known vs unknown emails; mail only for known', async () => {
    const app = await fresh();
    const reg = validRegistration();
    await app.client().post('/api/register', reg);
    app.mails.length = 0;
    const known = await app.client().post('/api/auth/link', { email: reg.email.toUpperCase() });
    const unknown = await app.client().post('/api/auth/link', { email: 'nobody.here@kenyon.edu' });
    const badDomain = await app.client().post('/api/auth/link', { email: 'nobody@gmail.com' });
    for (const r of [known, unknown, badDomain]) {
      assert.equal(r.status, 200);
      assert.equal(r.text, '{"ok":true}');
      assert.equal(r.setCookies.length, 0);
    }
    assert.deepEqual(
      [...known.headers.keys()].filter((k) => k !== 'date').sort(),
      [...unknown.headers.keys()].filter((k) => k !== 'date').sort(),
    );
    assert.equal(app.mails.length, 1);
    assert.equal(app.mails[0]!.kind, 'signin');
    assert.equal(app.mails[0]!.to, reg.email.toLowerCase());
  });

  test('token single-use, sets verified, not stored in plaintext', async () => {
    const app = await fresh();
    const reg = validRegistration();
    await app.client().post('/api/register', reg);
    await app.client().post('/api/auth/link', { email: reg.email });
    const token = tokenFromLink(app.mails.at(-1)!.link);
    const rows = await pool().query('SELECT token_hash FROM login_tokens');
    for (const r of rows.rows) assert.notEqual(r.token_hash, token);
    assert.ok(rows.rows.some((r) => r.token_hash === sha256hex(token)));
    const dump = JSON.stringify((await pool().query('SELECT * FROM login_tokens')).rows);
    assert.ok(!dump.includes(token));

    const c = app.client();
    const r1 = await c.post('/api/auth/redeem', { token });
    assert.equal(r1.status, 200, r1.text);
    assert.equal(r1.json.user.email, reg.email.toLowerCase());
    assert.equal(r1.json.user.emailVerified, true);
    assert.ok(c.jar.get('f5_session'));
    const r2 = await app.client().post('/api/auth/redeem', { token });
    assert.equal(r2.status, 400);
    assertCleanError(r2);
    assert.equal(r2.setCookies.length, 0);
  });

  test('confirmation link (from register) also redeems once', async () => {
    const app = await fresh();
    await app.client().post('/api/register', validRegistration());
    const token = tokenFromLink(app.mails[0]!.link);
    const r = await app.client().post('/api/auth/redeem', { token });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.emailVerified, true);
    assert.equal((await app.client().post('/api/auth/redeem', { token })).status, 400);
  });

  test('expired token rejected', async () => {
    const app = await fresh();
    const reg = validRegistration();
    await app.client().post('/api/register', reg);
    await app.client().post('/api/auth/link', { email: reg.email });
    const token = tokenFromLink(app.mails.at(-1)!.link);
    const ttl = await pool().query(
      `SELECT extract(epoch FROM expires_at - created_at)::int s FROM login_tokens WHERE token_hash = $1`,
      [sha256hex(token)],
    );
    assert.equal(ttl.rows[0].s, 20 * 60, 'sign-in link lives 20 minutes');
    const conf = await pool().query(
      `SELECT extract(epoch FROM expires_at - created_at)::int s FROM login_tokens WHERE purpose = 'confirm'`,
    );
    assert.equal(conf.rows[0].s, 48 * 3600, 'confirm link lives 48 hours');
    await pool().query(`UPDATE login_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = $1`, [sha256hex(token)]);
    const r = await app.client().post('/api/auth/redeem', { token });
    assert.equal(r.status, 400);
    assertCleanError(r);
  });

  test('random / malformed tokens rejected', async () => {
    const app = await fresh();
    for (const token of ['x'.repeat(43), 'short', '', '../../etc/passwd', 'a'.repeat(200)]) {
      const r = await app.client().post('/api/auth/redeem', { token });
      assert.equal(r.status, 400, token);
      assertCleanError(r);
    }
  });

  test('per-email limit 3/15min (same for unknown emails); per-IP limit 60/15min', async () => {
    const app = await fresh();
    const reg = validRegistration();
    await app.client().post('/api/register', reg);
    const statuses = async (email: string) => {
      const out: number[] = [];
      for (let i = 0; i < 4; i++) out.push((await app.client().post('/api/auth/link', { email })).status);
      return out;
    };
    assert.deepEqual(await statuses(reg.email), [200, 200, 200, 429]);
    assert.deepEqual(await statuses('ghost@kenyon.edu'), [200, 200, 200, 429]);
    // 8 requests so far from this IP; 52 more distinct emails are fine, the 61st request is limited.
    const more: number[] = [];
    for (let i = 0; i < 53; i++) more.push((await app.client().post('/api/auth/link', { email: `n${i}@kenyon.edu` })).status);
    assert.deepEqual(more.slice(0, 52), Array(52).fill(200));
    assert.equal(more[52], 429);
    // Link request is rejected by the per-IP limiter even for a registered address.
    assert.equal((await app.client().post('/api/auth/link', { email: reg.email })).status, 429);
  });

  test('redeem is rate-limited (100/15min per IP)', async () => {
    const app = await fresh();
    const statuses: number[] = [];
    for (let i = 0; i < 101; i++) statuses.push((await app.client().post('/api/auth/redeem', { token: 'y'.repeat(43) })).status);
    assert.deepEqual(statuses.slice(0, 100), Array(100).fill(400));
    assert.equal(statuses[100], 429);
  });

  test('GET /api/state and /api/health are exempt from the general limiter; other /api routes are not (1200/min)', async () => {
    const app = await fresh();
    const c = app.client();
    const burst = async (path: string, n: number, method = 'GET') => {
      const out: number[] = [];
      for (let i = 0; i < n; i += 50) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(50, n - i) }, () => fetch(app.base + path, { method }).then((r) => r.status)),
        );
        out.push(...batch);
      }
      return out;
    };
    const st = await burst('/api/state', 1300);
    assert.equal(st.filter((s) => s === 200).length, 1300);
    const hl = await burst('/api/health', 1300, 'HEAD');
    assert.equal(hl.filter((s) => s === 200).length, 1300);
    // The general limiter is still live for everything else.
    const me = await burst('/api/me', 1201);
    assert.equal(me.filter((s) => s === 200).length, 1200);
    assert.equal(me.filter((s) => s === 429).length, 1);
    // …and the exemption still holds once the IP is over the general limit.
    assert.equal((await c.get('/api/state')).status, 200);
    assert.equal((await c.post('/api/auth/logout', {})).status, 429);
  });

  test('register allows well over 30 per IP (200/10min), then limits', async () => {
    const app = await fresh();
    const statuses: number[] = [];
    for (let i = 0; i < 201; i++) {
      statuses.push((await app.client().post('/api/register', validRegistration({ email: `bulk${i}@kenyon.edu` }))).status);
    }
    assert.deepEqual(statuses.slice(0, 200), Array(200).fill(201));
    assert.equal(statuses[200], 429);
    assert.equal((await pool().query('SELECT count(*)::int n FROM users')).rows[0].n, 200);
  });

  test('logout deletes the session server-side', async () => {
    const app = await fresh();
    const c = app.client();
    await c.post('/api/register', validRegistration());
    const token = c.jar.get('f5_session')!;
    const out = await c.post('/api/auth/logout', {});
    assert.equal(out.status, 200);
    assert.ok(out.setCookies.some((s) => s.startsWith('f5_session=;') || /f5_session=.*expires=thu, 01 jan 1970/i.test(s)));
    assert.equal((await pool().query('SELECT count(*)::int n FROM sessions')).rows[0].n, 0);
    // Replaying the old cookie does nothing.
    const replay = app.client();
    replay.jar.set('f5_session', token);
    assert.equal((await replay.get('/api/me')).json.user, null);
    assert.equal((await replay.post('/api/projects', { title: 'T', blurb: 'B', fields: ['cs', 'bio'], cap: 3 })).status, 401);
  });

  test('expired session is rejected', async () => {
    const app = await fresh();
    const c = app.client();
    await c.post('/api/register', validRegistration());
    await pool().query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
    assert.equal((await c.get('/api/me')).json.user, null);
  });
});

describe('admin login', () => {
  test('correct password -> admin session; wrong -> 401; logout invalidates', async () => {
    const app = await fresh();
    const c = app.client();
    const bad = await c.post('/api/admin/login', { password: 'wrong-password-wrong-password' });
    assert.equal(bad.status, 401);
    assertCleanError(bad);
    assert.equal(bad.setCookies.length, 0);
    const ok = await c.post('/api/admin/login', { password: ADMIN_PASSWORD });
    assert.equal(ok.status, 200);
    const token = c.jar.get('f5_admin')!;
    assert.ok(token);
    const row = await pool().query(`SELECT token_hash, extract(epoch FROM expires_at - created_at)::int s FROM sessions WHERE is_admin`);
    assert.equal(row.rows[0].token_hash, sha256hex(token));
    assert.ok(Math.abs(row.rows[0].s - 12 * 3600) < 5, 'admin session 12h');
    assert.equal((await c.get('/api/me')).json.isAdmin, true);
    assert.equal((await c.get('/api/admin/requests')).status, 200);
    assert.equal((await c.post('/api/admin/logout', {})).status, 200);
    const replay = app.client();
    replay.jar.set('f5_admin', token);
    assert.equal((await replay.get('/api/admin/requests')).status, 401);
  });

  test('admin login is rate-limited (5/15 min), even for the right password and spoofed X-Forwarded-For', async () => {
    const app = await fresh();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (await app.client().post('/api/admin/login', { password: `guess-${i}-xxxxxxxxxxxx` }, { headers: { 'x-forwarded-for': `10.0.0.${i}` } }))
          .status,
      );
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 401]);
    const r = await app.client().post('/api/admin/login', { password: ADMIN_PASSWORD }, { headers: { 'x-forwarded-for': '10.9.9.9' } });
    assert.equal(r.status, 429);
    assertCleanError(r);
    assert.equal(r.setCookies.length, 0);
  });

  test('admin disabled when ADMIN_PASSWORD is missing or short', async () => {
    for (const pw of [undefined, '', 'short-pass']) {
      const app = await fresh({ ADMIN_PASSWORD: pw });
      assert.equal(app.config.adminPassword, null);
      for (const guess of ['', 'short-pass', 'undefined', 'null']) {
        const r = await app.client().post('/api/admin/login', { password: guess });
        assert.ok(r.status === 403 || r.status === 400, `pw=${pw} guess=${guess} -> ${r.status}`);
        assert.equal(r.setCookies.length, 0);
      }
    }
    assert.throws(() =>
      loadConfig({ DATABASE_URL: 'postgres://x/y_test', NODE_ENV: 'production', APP_URL: 'https://a.edu', ADMIN_PASSWORD: 'tooshort' }),
    );
    assert.throws(() => loadConfig({ DATABASE_URL: 'postgres://x/y_test', NODE_ENV: 'production' }), /APP_URL/);
  });
});
