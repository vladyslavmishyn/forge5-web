// Adversarial edge cases: every malformed input must produce a 4xx, never a 500.
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertCleanError, endPool, pool, resetDb, seedProject, seedUser, startApp, validRegistration, type TestApp } from './helpers.js';

let app: TestApp;
let errors: unknown[][] = [];
const origError = console.error;
before(async () => {
  app = await startApp({ ALLOWED_EMAIL_DOMAINS: '' });
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
});
beforeEach(async () => {
  await resetDb();
  errors = [];
});
after(async () => {
  console.error = origError;
  await app.close();
  await endPool();
});

describe('NUL / odd characters in emails', () => {
  test('register with a NUL byte in the email is a 400, not a 500', async () => {
    const r = await app.client().post('/api/register', validRegistration({ email: 'a\u0000b@kenyon.edu' }));
    assert.equal(r.status, 400, `${r.status} ${r.text}`);
    assertCleanError(r);
  });
  test('sign-in link request with a NUL byte in the email is a 400, not a 500', async () => {
    const r = await app.client().post('/api/auth/link', { email: 'a\u0000b@kenyon.edu' });
    assert.equal(r.status, 400, `${r.status} ${r.text}`);
    assertCleanError(r);
  });
  test('emails with control characters are rejected', async () => {
    for (const email of ['a\u0007b@kenyon.edu', 'a\u007fb@kenyon.edu', 'a@ken\u0001yon.edu', 'a\u202eb@kenyon.edu']) {
      const r = await app.client().post('/api/register', validRegistration({ email }));
      assert.equal(r.status, 400, `${JSON.stringify(email)} -> ${r.status} ${r.text}`);
    }
    // Uppercase ASCII emails still register and are stored lower-cased.
    const ok = await app.client().post('/api/register', validRegistration({ email: 'Mixed.Case@Kenyon.EDU' }));
    assert.equal(ok.status, 201);
    assert.equal(ok.json.user.email, 'mixed.case@kenyon.edu');
  });
  test('email whose JS-lowercase differs from Postgres lower() (U+038D) is not a 500', async () => {
    const r = await app.client().post('/api/register', validRegistration({ email: 'a΍@kenyon.edu' }));
    assert.ok(r.status < 500, `${r.status} ${r.text}`);
  });
});

describe('NUL bytes elsewhere', () => {
  test('diet / major / need with NUL are rejected cleanly', async () => {
    for (const over of [{ diet: 'x\u0000' }, { major: 'x\u0000' }]) {
      const r = await app.client().post('/api/register', validRegistration(over));
      assert.equal(r.status, 400, `${JSON.stringify(over)} -> ${r.status}`);
    }
    const u = await seedUser(app);
    const r = await u.client.post('/api/projects', { title: 'T', blurb: 'B\u0000', fields: ['cs', 'bio'], cap: 3, need: 'x' });
    assert.equal(r.status, 400);
  });
});

describe('odd numeric inputs', () => {
  test('ballot with ids beyond bigint / unsafe integers is a 4xx', async () => {
    const u = await seedUser(app);
    await seedProject();
    await pool().query(`UPDATE settings SET phase = 'vote'`);
    for (const ids of [[2 ** 53], [9007199254740993], ['999999999'], [1e20]]) {
      const r = await u.client.post('/api/ballot', { projectIds: ids });
      assert.ok(r.status >= 400 && r.status < 500, `${JSON.stringify(ids)} -> ${r.status} ${r.text}`);
    }
  });
  test('project cap given as an array / bool / null is rejected (strict schema, no coercion)', async () => {
    const got: string[] = [];
    for (const cap of [[3], '3', true, null, { valueOf: 3 }]) {
      const u = await seedUser(app);
      const r = await u.client.post('/api/projects', { title: 'T', blurb: 'B', fields: ['cs', 'bio'], cap });
      if (r.status !== 400) got.push(`cap=${JSON.stringify(cap)} -> ${r.status}`);
    }
    assert.deepEqual(got, []);
  });
});

describe('no server errors logged during probes', () => {
  test('console.error was not called with a stack for 4xx inputs', async () => {
    await app.client().post('/api/register', validRegistration({ email: 'ok@kenyon.edu' }));
    assert.equal(errors.length, 0, JSON.stringify(errors).slice(0, 300));
  });
});
