import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
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

let app: TestApp;
before(async () => {
  app = await startApp({ REQUIRE_VERIFIED_EMAIL_TO_VOTE: 'false' });
});
beforeEach(async () => {
  await resetDb();
});
after(async () => {
  await app.close();
  await endPool();
});

const newProject = (over: Record<string, unknown> = {}) => ({
  title: 'Solar Sensor Net',
  blurb: 'Tiny sensors,\n big data.',
  fields: ['cs', 'env'],
  cap: 3,
  need: 'a biologist',
  ...over,
});

const count = async (sql: string, params: unknown[] = []) => Number((await pool().query(sql, params)).rows[0].n);

describe('phase gating table', () => {
  const PHASES = ['reg', 'build', 'vote', 'result'] as const;
  const allowed: Record<string, readonly string[]> = {
    create: ['reg', 'build'],
    join: ['reg', 'build'],
    leave: ['reg', 'build'],
    equipment: ['reg', 'build'],
    ballot: ['vote'],
    results: ['result'],
  };
  for (const phase of PHASES) {
    test(`phase=${phase}`, async () => {
      await resetDb();
      const creator = await seedUser(app);
      const joiner = await seedUser(app);
      const member = await seedUser(app);
      const voter = await seedUser(app);
      const other = await seedProject({ members: [member.id], cap: 5 });
      const other2 = await seedProject({ cap: 5 });
      await pool().query('INSERT INTO equipment_requests (project_id) VALUES ($1)', [other]);
      await setPhase(phase);
      const expect = (action: string, status: number, okStatus: number) => {
        const want = allowed[action]!.includes(phase) ? okStatus : 403;
        assert.equal(status, want, `${action} in ${phase}: got ${status}`);
      };
      expect('create', (await creator.client.post('/api/projects', newProject())).status, 201);
      expect('join', (await joiner.client.post(`/api/projects/${other}/join`, {})).status, 200);
      expect('equipment', (await member.client.post('/api/equipment/requests', { items: { led: 1 } })).status, 201);
      // Leave: use a second member so the project with equipment survives.
      const leaver = await seedUser(app);
      await pool().query('UPDATE users SET project_id = $1 WHERE id = $2', [other2, leaver.id]);
      expect('leave', (await leaver.client.post(`/api/projects/${other2}/leave`, {})).status, 200);
      expect('ballot', (await voter.client.post('/api/ballot', { projectIds: [other] })).status, 201);
      expect('results', (await app.client().get('/api/results')).status, 200);
      // Sign-in link, logout always allowed.
      assert.equal((await app.client().post('/api/auth/link', { email: `x-${phase}@kenyon.edu` })).status, 200);
      assert.equal((await voter.client.post('/api/auth/logout', {})).status, 200);
      // Admin can change phase and mark equipment returned in any phase.
      const admin = await app.admin();
      const reqId = (await pool().query('SELECT id FROM equipment_requests ORDER BY id LIMIT 1')).rows[0].id;
      assert.equal((await admin.post(`/api/admin/requests/${reqId}/return`, {})).status, 200);
      assert.equal((await admin.put('/api/admin/phase', { phase })).status, 200);
    });
  }
});

describe('projects', () => {
  test('create: signed in, ≥2 distinct fields, creator auto-joins, validation', async () => {
    assert.equal((await app.client().post('/api/projects', newProject())).status, 401);
    const u = await seedUser(app);
    for (const over of [
      { fields: ['cs'] },
      { fields: ['cs', 'cs'] },
      { fields: [] },
      { fields: ['cs', 'nope'] },
      { cap: 1 },
      { cap: 6 },
      { cap: 2.5 },
      { title: '' },
      { title: 'x'.repeat(81) },
      { blurb: 'x'.repeat(281) },
      { blurb: '' },
      { need: 'x'.repeat(121) },
      { title: 'bad\u0000title' },
    ]) {
      const r = await u.client.post('/api/projects', newProject(over));
      assert.equal(r.status, 400, `${JSON.stringify(over).slice(0, 40)} -> ${r.status}`);
      assertCleanError(r);
    }
    assert.equal(await count('SELECT count(*) n FROM projects'), 0);
    const r = await u.client.post('/api/projects', newProject());
    assert.equal(r.status, 201, r.text);
    assert.match(r.json.code, /^P-\d{2,}$/);
    const me = await u.client.get('/api/me');
    assert.equal(me.json.user.projectId, r.json.id);
    const st = await app.client().get('/api/state');
    const p = st.json.projects.find((x: { id: number }) => x.id === r.json.id);
    assert.equal(p.blurb, 'Tiny sensors, big data.', 'newlines collapsed');
    assert.equal(p.members.length, 1);
    // One team per user: creating a second project fails and leaves no orphan.
    const again = await u.client.post('/api/projects', newProject({ title: 'Second' }));
    assert.equal(again.status, 409);
    assert.equal(await count('SELECT count(*) n FROM projects'), 1);
  });

  test('join/leave basics', async () => {
    const a = await seedUser(app);
    const b = await seedUser(app);
    const pid = await seedProject({ members: [a.id], cap: 2 });
    const pid2 = await seedProject({ cap: 5 });
    assert.equal((await app.client().post(`/api/projects/${pid}/join`, {})).status, 401);
    assert.equal((await b.client.post(`/api/projects/99999/join`, {})).status, 404);
    assert.equal((await b.client.post(`/api/projects/${pid}/join`, {})).status, 200);
    assert.equal((await b.client.post(`/api/projects/${pid2}/join`, {})).status, 409, 'already on a team');
    const c = await seedUser(app);
    const full = await c.client.post(`/api/projects/${pid}/join`, {});
    assert.equal(full.status, 409, 'team full');
    assertCleanError(full);
    assert.equal((await c.client.post(`/api/projects/${pid}/leave`, {})).status, 403, 'not a member');
    assert.equal((await b.client.post(`/api/projects/${pid}/leave`, {})).status, 200);
    assert.equal(await count('SELECT count(*) n FROM projects WHERE id = $1', [pid]), 1, 'still has a member');
    const last = await a.client.post(`/api/projects/${pid}/leave`, {});
    assert.equal(last.status, 200);
    assert.equal(last.json.deleted, true);
    assert.equal(await count('SELECT count(*) n FROM projects WHERE id = $1', [pid]), 0, 'empty project deleted');
  });

  test('leaving an empty project with active equipment keeps it', async () => {
    const a = await seedUser(app);
    const pid = await seedProject({ members: [a.id] });
    assert.equal((await a.client.post('/api/equipment/requests', { items: { esp32: 2 } })).status, 201);
    const r = await a.client.post(`/api/projects/${pid}/leave`, {});
    assert.equal(r.status, 200);
    assert.equal(r.json.deleted, false);
    assert.equal(await count('SELECT count(*) n FROM projects WHERE id = $1', [pid]), 1);
  });

  test('team cap holds under 10 concurrent joins (cap 2, 1 existing member)', async () => {
    const owner = await seedUser(app);
    const pid = await seedProject({ members: [owner.id], cap: 2 });
    const users = await Promise.all(Array.from({ length: 10 }, () => seedUser(app)));
    const results = await Promise.all(users.map((u) => u.client.post(`/api/projects/${pid}/join`, {})));
    const statuses = results.map((r) => r.status).sort();
    assert.equal(statuses.filter((s) => s === 200).length, 1, statuses.join(','));
    assert.equal(statuses.filter((s) => s === 409).length, 9, statuses.join(','));
    assert.equal(await count('SELECT count(*) n FROM users WHERE project_id = $1', [pid]), 2);
  });

  test('team cap holds under 12 concurrent joins (cap 5, empty)', async () => {
    const pid = await seedProject({ cap: 5 });
    const users = await Promise.all(Array.from({ length: 12 }, () => seedUser(app)));
    const results = await Promise.all(users.map((u) => u.client.post(`/api/projects/${pid}/join`, {})));
    assert.equal(results.filter((r) => r.status === 200).length, 5);
    assert.equal(await count('SELECT count(*) n FROM users WHERE project_id = $1', [pid]), 5);
  });

  test('one user joining many teams concurrently lands on exactly one', async () => {
    const u = await seedUser(app);
    const pids = await Promise.all(Array.from({ length: 6 }, () => seedProject({ cap: 5 })));
    const results = await Promise.all(pids.map((p) => u.client.post(`/api/projects/${p}/join`, {})));
    assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.status).join(','));
    assert.equal(await count('SELECT count(*) n FROM users WHERE project_id IS NOT NULL'), 1);
  });

  test('one user creating projects concurrently ends with exactly one project', async () => {
    const u = await seedUser(app);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => u.client.post('/api/projects', newProject({ title: `P${i}` }))),
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1, results.map((r) => r.status).join(','));
    assert.equal(await count('SELECT count(*) n FROM projects'), 1, 'no orphan projects');
  });
});

describe('equipment', () => {
  test('requires sign-in and a team; validates keys and quantities', async () => {
    assert.equal((await app.client().post('/api/equipment/requests', { items: { led: 1 } })).status, 401);
    const solo = await seedUser(app);
    const r = await solo.client.post('/api/equipment/requests', { items: { led: 1 } });
    assert.equal(r.status, 403);
    assertCleanError(r);
    const a = await seedUser(app);
    await seedProject({ members: [a.id] });
    for (const items of [{}, { nope: 1 }, { led: 0 }, { led: 1000 }, { LED: 1 }, { 'led; DROP TABLE users': 1 }]) {
      const x = await a.client.post('/api/equipment/requests', { items });
      assert.equal(x.status, 400, `${JSON.stringify(items)} -> ${x.status}`);
      assertCleanError(x);
    }
    const ok = await a.client.post('/api/equipment/requests', { items: { led: 3, esp32: 2 } });
    assert.equal(ok.status, 201, ok.text);
    const st = await app.client().get('/api/state');
    const byKey = Object.fromEntries(st.json.equipment.map((e: { key: string }) => [e.key, e]));
    assert.equal(byKey.led.available, byKey.led.stock - 3);
    assert.equal(byKey.esp32.available, byKey.esp32.stock - 2);
    const tooMany = await a.client.post('/api/equipment/requests', { items: { mic: 9 } });
    assert.equal(tooMany.status, 409);
    assert.match(tooMany.json.error, /Microphone/);
  });

  test('returning restores availability (idempotent)', async () => {
    const a = await seedUser(app);
    await seedProject({ members: [a.id] });
    const r = await a.client.post('/api/equipment/requests', { items: { mic: 8 } });
    assert.equal(r.status, 201);
    assert.equal((await a.client.post('/api/equipment/requests', { items: { mic: 1 } })).status, 409);
    const admin = await app.admin();
    const x1 = await admin.post(`/api/admin/requests/${r.json.id}/return`, {});
    const x2 = await admin.post(`/api/admin/requests/${r.json.id}/return`, {});
    assert.equal(x1.status, 200);
    assert.equal(x2.json.returnedAt, x1.json.returnedAt);
    assert.equal((await admin.post('/api/admin/requests/999999/return', {})).status, 404);
    assert.equal((await a.client.post('/api/equipment/requests', { items: { mic: 8 } })).status, 201);
    const list = await admin.get('/api/admin/requests');
    assert.equal(list.json.length, 2);
    assert.ok(list.json.every((q: { projectCode: string; items: unknown[] }) => /^P-/.test(q.projectCode) && q.items.length === 1));
  });

  test('stock never goes negative under concurrent requests', async () => {
    // mic stock = 8. 12 teams each ask for 1 mic + 1 ultra (stock 10) at the same time.
    const teams = [];
    for (let i = 0; i < 12; i++) {
      const u = await seedUser(app);
      await seedProject({ members: [u.id] });
      teams.push(u);
    }
    const results = await Promise.all(teams.map((t) => t.client.post('/api/equipment/requests', { items: { mic: 1, ultra: 1 } })));
    const ok = results.filter((r) => r.status === 201).length;
    assert.equal(ok, 8, results.map((r) => r.status).join(','));
    assert.ok(results.every((r) => r.status === 201 || r.status === 409));
    const used = await count(
      `SELECT COALESCE(sum(i.qty),0) n FROM equipment_request_items i JOIN equipment_requests r ON r.id = i.request_id
        WHERE r.returned_at IS NULL AND i.equipment_key = 'mic'`,
    );
    assert.equal(used, 8);
    const st = await app.client().get('/api/state');
    const mic = st.json.equipment.find((e: { key: string }) => e.key === 'mic');
    assert.equal(mic.available, 0);
    // Opposite lock order in the same instant must not deadlock into a 500.
    const u1 = await seedUser(app);
    const u2 = await seedUser(app);
    await seedProject({ members: [u1.id] });
    await seedProject({ members: [u2.id] });
    const rs = await Promise.all([
      u1.client.post('/api/equipment/requests', { items: { usb: 1, bread: 1, led: 1 } }),
      u2.client.post('/api/equipment/requests', { items: { led: 1, bread: 1, usb: 1 } }),
    ]);
    assert.deepEqual(rs.map((r) => r.status), [201, 201]);
  });

  test('a large single request exceeding stock is rejected atomically', async () => {
    const a = await seedUser(app);
    await seedProject({ members: [a.id] });
    const r = await a.client.post('/api/equipment/requests', { items: { led: 5, mic: 99 } });
    assert.equal(r.status, 409);
    assert.equal(await count('SELECT count(*) n FROM equipment_requests'), 0);
  });
});

describe('ballot', () => {
  async function setup() {
    const voter = await seedUser(app, { verified: true });
    const mate = await seedUser(app);
    const own = await seedProject({ members: [voter.id, mate.id], title: 'Own' });
    const p = [];
    for (let i = 0; i < 4; i++) p.push(await seedProject({ title: `Other ${i}` }));
    await setPhase('vote');
    return { voter, own, p };
  }

  test('1–3 distinct, not own team, projects must exist, only once', async () => {
    const { voter, own, p } = await setup();
    const bad: unknown[] = [[], [p[0], p[1], p[2], p[3]], [p[0], p[0]], [p[0], `P-${String(p[0]).padStart(2, '0')}`], ['abc'], [0], [-1], [1.5]];
    for (const ids of bad) {
      const r = await voter.client.post('/api/ballot', { projectIds: ids });
      assert.equal(r.status, 400, `${JSON.stringify(ids)} -> ${r.status} ${r.text}`);
      assertCleanError(r);
    }
    assert.equal((await voter.client.post('/api/ballot', { projectIds: [own] })).status, 403);
    assert.equal((await voter.client.post('/api/ballot', { projectIds: [p[0], own] })).status, 403);
    assert.equal((await voter.client.post('/api/ballot', { projectIds: [p[0], 999999] })).status, 404);
    assert.equal(await count('SELECT count(*) n FROM ballots'), 0);
    const ok = await voter.client.post('/api/ballot', { projectIds: [p[0], `P-${String(p[1]).padStart(2, '0')}`, String(p[2])] });
    assert.equal(ok.status, 201, ok.text);
    const again = await voter.client.post('/api/ballot', { projectIds: [p[3]] });
    assert.equal(again.status, 409);
    const me = await voter.client.get('/api/me');
    assert.equal(me.json.user.hasVoted, true);
    assert.deepEqual(me.json.user.votes, [p[0], p[1], p[2]].sort((a, b) => a! - b!));
    assert.equal(await count('SELECT count(*) n FROM ballot_votes'), 3);
  });

  test('unauthenticated ballot is 401', async () => {
    const { p } = await setup();
    assert.equal((await app.client().post('/api/ballot', { projectIds: [p[0]] })).status, 401);
  });

  test('concurrent double-submit records exactly one ballot', async () => {
    const { voter, p } = await setup();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => voter.client.post('/api/ballot', { projectIds: [p[i % 4]] })),
    );
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 201).length, 1, statuses.join(','));
    assert.ok(statuses.every((s) => s === 201 || s === 409), statuses.join(','));
    assert.equal(await count('SELECT count(*) n FROM ballots'), 1);
    assert.equal(await count('SELECT count(*) n FROM ballot_votes'), 1);
  });

  test('users without a team can vote for anyone', async () => {
    const { p } = await setup();
    const solo = await seedUser(app);
    assert.equal((await solo.client.post('/api/ballot', { projectIds: p.slice(0, 3) })).status, 201);
  });

  test('verified email required when enabled', async () => {
    const strict = await startApp({ REQUIRE_VERIFIED_EMAIL_TO_VOTE: 'true' });
    try {
      const { p } = await setup();
      const unverified = await seedUser(strict);
      const r = await unverified.client.post('/api/ballot', { projectIds: [p[0]] });
      assert.equal(r.status, 403);
      assert.equal(r.json.error, 'Confirm your email first — use the link we sent you.');
      const me = await unverified.client.get('/api/me');
      assert.equal(me.json.verificationRequired, true);
      assert.equal(me.json.user.emailVerified, false);
      const verified = await seedUser(strict, { verified: true });
      assert.equal((await verified.client.post('/api/ballot', { projectIds: [p[0]] })).status, 201);
    } finally {
      await strict.close();
    }
  });

  test('REQUIRE_VERIFIED_EMAIL_TO_VOTE defaults to true when SMTP_URL is set', async () => {
    const withSmtp = await startApp({ SMTP_URL: 'smtp://localhost:2525', REQUIRE_VERIFIED_EMAIL_TO_VOTE: undefined });
    const without = await startApp({ SMTP_URL: undefined, REQUIRE_VERIFIED_EMAIL_TO_VOTE: undefined });
    try {
      assert.equal(withSmtp.config.requireVerifiedEmailToVote, true);
      assert.equal(without.config.requireVerifiedEmailToVote, false);
    } finally {
      await withSmtp.close();
      await without.close();
    }
  });
});

describe('results', () => {
  test('math and ordering: votes desc, then id asc; memberCount correct', async () => {
    const members = await Promise.all(Array.from({ length: 6 }, () => seedUser(app)));
    const p1 = await seedProject({ title: 'One', members: [members[0]!.id, members[1]!.id] });
    const p2 = await seedProject({ title: 'Two', members: [members[2]!.id] });
    const p3 = await seedProject({ title: 'Three', members: [members[3]!.id, members[4]!.id, members[5]!.id] });
    const p4 = await seedProject({ title: 'Four (no votes)' });
    await setPhase('vote');
    const voters = await Promise.all(Array.from({ length: 5 }, () => seedUser(app)));
    // p2: 4 votes, p1: 3 votes, p3: 3 votes (tie with p1 -> lower id first), p4: 0
    const ballots = [
      [p2, p1, p3],
      [p2, p1, p3],
      [p2, p1],
      [p2, p3],
      [],
    ];
    for (let i = 0; i < voters.length; i++) {
      if (!ballots[i]!.length) continue;
      const r = await voters[i]!.client.post('/api/ballot', { projectIds: ballots[i] });
      assert.equal(r.status, 201, r.text);
    }
    // Members also vote (not for their own team).
    assert.equal((await members[0]!.client.post('/api/ballot', { projectIds: [p2] })).status, 201);
    await setPhase('result');
    const r = await app.client().get('/api/results');
    assert.equal(r.status, 200);
    assert.deepEqual(
      r.json.map((x: { id: number; votes: number; memberCount: number; title: string }) => [x.title, x.votes, x.memberCount]),
      [
        ['Two', 5, 1],
        ['One', 3, 2],
        ['Three', 3, 3],
        ['Four (no votes)', 0, 0],
      ],
    );
    assert.ok(p1 < p3 && p4 > 0);
    for (const x of r.json) assert.equal(typeof x.votes, 'number');
  });
});

describe('stats', () => {
  test('students, teams, colleges, seats', async () => {
    const a = await seedUser(app, { college: 'Kenyon College' });
    const b = await seedUser(app, { college: 'Kenyon College' });
    await seedUser(app, { college: 'Oberlin College' });
    await seedProject({ members: [a.id, b.id], cap: 2 }); // 0 seats
    await seedProject({ cap: 4 }); // 4 seats
    const st = await app.client().get('/api/state');
    assert.deepEqual(st.json.stats, { students: 3, teams: 2, colleges: 2, seats: 4 });
  });
});
