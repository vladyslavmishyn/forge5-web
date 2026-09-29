import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { assertCleanError, endPool, pool, resetDb, seedProject, seedUser, startApp, validRegistration, type TestApp } from './helpers.js';

let app: TestApp;
before(async () => {
  await resetDb();
  app = await startApp();
});
after(async () => {
  await app.close();
  await endPool();
});

describe('CSRF guard on every non-GET /api request', () => {
  const variants: [string, { origin?: string | null; contentType?: string | null }][] = [
    ['no Origin', { origin: null }],
    ['foreign Origin', { origin: 'https://evil.example' }],
    ['look-alike Origin', { origin: 'http://localhost:5173.evil.example' }],
    ['Origin null', { origin: 'null' }],
    ['text/plain', { contentType: 'text/plain' }],
    ['form-urlencoded', { contentType: 'application/x-www-form-urlencoded' }],
    ['multipart', { contentType: 'multipart/form-data; boundary=x' }],
    ['no content type', { contentType: null }],
    ['json-ish type', { contentType: 'application/json-patch+json' }],
  ];

  test('each variant is 403 on every mutating endpoint and changes nothing', async () => {
    const u = await seedUser(app);
    const pid = await seedProject({ cap: 5 });
    const admin = await app.admin();
    const targets: [typeof u.client, string, string, unknown][] = [
      [app.client(), 'POST', '/api/register', validRegistration()],
      [app.client(), 'POST', '/api/auth/link', { email: 'a@b.edu' }],
      [app.client(), 'POST', '/api/auth/redeem', { token: 'x'.repeat(43) }],
      [u.client, 'POST', '/api/auth/logout', {}],
      [u.client, 'POST', '/api/projects', { title: 'T', blurb: 'B', fields: ['cs', 'bio'], cap: 3 }],
      [u.client, 'POST', `/api/projects/${pid}/join`, {}],
      [u.client, 'POST', `/api/projects/${pid}/leave`, {}],
      [u.client, 'POST', '/api/equipment/requests', { items: { led: 1 } }],
      [u.client, 'POST', '/api/ballot', { projectIds: [pid] }],
      [app.client(), 'POST', '/api/admin/login', { password: 'x' }],
      [admin, 'POST', '/api/admin/logout', {}],
      [admin, 'PUT', '/api/admin/phase', { phase: 'result' }],
      [admin, 'POST', '/api/admin/requests/1/return', {}],
      [u.client, 'DELETE', '/api/projects/1', {}],
      [u.client, 'PATCH', '/api/me', {}],
    ];
    for (const [name, opts] of variants) {
      for (const [client, method, path, body] of targets) {
        const r = await client.req(method, path, body, opts);
        assert.equal(r.status, 403, `${name}: ${method} ${path} -> ${r.status}`);
        assertCleanError(r);
        assert.equal(r.setCookies.length, 0, `${name}: ${method} ${path} set a cookie`);
      }
    }
    const counts = await pool().query(
      `SELECT (SELECT count(*) FROM users)::int users, (SELECT count(*) FROM projects)::int projects,
              (SELECT count(*) FROM sessions)::int sessions, (SELECT phase FROM settings) phase,
              (SELECT count(*) FROM equipment_requests)::int reqs, (SELECT count(*) FROM login_tokens)::int tokens`,
    );
    assert.deepEqual(counts.rows[0], { users: 1, projects: 1, sessions: 2, phase: 'reg', reqs: 0, tokens: 0 });
    // Sessions still valid (logout was blocked).
    assert.ok((await u.client.get('/api/me')).json.user);
    assert.equal((await admin.get('/api/me')).json.isAdmin, true);
  });

  test('correct Origin + JSON passes; charset parameter tolerated', async () => {
    const r = await app.client().post('/api/auth/link', { email: 'a@b.edu' }, { contentType: 'application/json; charset=utf-8' });
    assert.equal(r.status, 200);
  });

  test('GET requests are not blocked and do not mutate', async () => {
    const r = await app.client().get('/api/state', { headers: { origin: 'https://evil.example' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('access-control-allow-origin'), null, 'no CORS');
  });

  test('state-changing routes do not exist as GET', async () => {
    for (const p of ['/api/auth/logout', '/api/admin/logout', '/api/auth/redeem?token=x', '/api/projects/1/join']) {
      const r = await app.client().get(p);
      assert.ok(r.status === 404 || r.status === 401, `${p} -> ${r.status}`);
    }
  });

  test('preflight OPTIONS from a foreign origin gets no CORS allowance', async () => {
    const r = await fetch(app.base + '/api/register', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
    });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal(r.headers.get('access-control-allow-credentials'), null);
  });
});
