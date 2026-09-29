import { Router } from 'express';
import { z } from 'zod';
import { FIELD_KEYS, MAX_VOTES, TEAM_CAP_MAX, TEAM_CAP_MIN, projectCode } from '../../../shared/constants.js';
import { withTx } from '../db.js';
import { bad, conflict, forbidden, idParam, notFound, paragraph, parse, text } from '../http.js';
import { getPhase, requirePhase } from '../sessions.js';
import type { Deps } from '../app.js';

const TEAMS_LOCKED = 'Teams are locked once voting starts.';

const projectSchema = z
  .object({
    title: text(1, 80),
    blurb: paragraph(1, 280),
    fields: z
      .array(z.string().refine((k) => FIELD_KEYS.includes(k)))
      .max(FIELD_KEYS.length)
      .refine((a) => new Set(a).size === a.length && a.length >= 2),
    cap: z.number().int().min(TEAM_CAP_MIN).max(TEAM_CAP_MAX),
    need: z.union([text(0, 120), z.null()]).optional(),
  })
  .strict();

const PROJECT_MSG: Record<string, string> = {
  title: 'A title is required (up to 80 characters).',
  blurb: 'A one-line pitch is required (up to 280 characters).',
  fields: 'Pick at least two fields — Forge5 projects are interdisciplinary by rule.',
  cap: 'Team size cap must be between 2 and 5.',
  need: '“Looking for” must be at most 120 characters.',
};

const equipmentSchema = z
  .object({
    items: z
      .record(z.string().regex(/^[a-z0-9_-]{1,32}$/), z.number().int().min(1).max(999))
      .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 50),
  })
  .strict();

const ballotSchema = z
  .object({
    projectIds: z
      .array(
        z.union([
          z.number().int().positive(),
          z
            .string()
            .regex(/^(P-?)?\d{1,9}$/i)
            .transform((s) => Number(s.replace(/^P-?/i, ''))),
        ]),
      )
      .min(1)
      .max(MAX_VOTES),
  })
  .strict();

export function teamRoutes({ pool, sessions, config, stateCache }: Deps): Router {
  const r = Router();

  // ------------------------------------------------------------- projects
  r.post('/projects', async (req, res) => {
    const user = await sessions.requireUser(req, res);
    const body = parse(projectSchema, req.body, PROJECT_MSG);
    const id = await withTx(pool, async (c) => {
      requirePhase(await getPhase(c, 'FOR SHARE'), ['reg', 'build'], TEAMS_LOCKED);
      const p = await c.query<{ id: number }>(
        `INSERT INTO projects (title, blurb, fields, cap, need, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [body.title, body.blurb, body.fields, body.cap, body.need?.trim() ?? '', user.id],
      );
      const pid = p.rows[0]!.id;
      const u = await c.query(
        'UPDATE users SET project_id = $1, team_joined_at = now() WHERE id = $2 AND project_id IS NULL',
        [pid, user.id],
      );
      if (u.rowCount !== 1) throw conflict('You are already on a team.');
      return pid;
    });
    stateCache.invalidate();
    res.status(201).json({ id, code: projectCode(id) });
  });

  r.post('/projects/:id/join', async (req, res) => {
    const user = await sessions.requireUser(req, res);
    const id = idParam(req.params.id);
    parse(z.object({}).strict(), req.body);
    const title = await withTx(pool, async (c) => {
      requirePhase(await getPhase(c, 'FOR SHARE'), ['reg', 'build'], TEAMS_LOCKED);
      const p = await c.query<{ cap: number; title: string }>(
        'SELECT cap, title FROM projects WHERE id = $1 FOR UPDATE',
        [id],
      );
      const proj = p.rows[0];
      if (!proj) throw notFound('No such project.');
      const n = await c.query<{ n: number }>('SELECT count(*) AS n FROM users WHERE project_id = $1', [id]);
      if (n.rows[0]!.n >= proj.cap) throw conflict('That team just filled up.');
      const u = await c.query(
        'UPDATE users SET project_id = $1, team_joined_at = now() WHERE id = $2 AND project_id IS NULL',
        [id, user.id],
      );
      if (u.rowCount !== 1) throw conflict('Leave your current team before joining another.');
      return proj.title;
    });
    stateCache.invalidate();
    res.json({ ok: true, id, code: projectCode(id), title });
  });

  r.post('/projects/:id/leave', async (req, res) => {
    const user = await sessions.requireUser(req, res);
    const id = idParam(req.params.id);
    parse(z.object({}).strict(), req.body);
    const result = await withTx(pool, async (c) => {
      requirePhase(await getPhase(c, 'FOR SHARE'), ['reg', 'build'], TEAMS_LOCKED);
      const p = await c.query<{ title: string }>('SELECT title FROM projects WHERE id = $1 FOR UPDATE', [id]);
      if (!p.rows[0]) throw notFound('No such project.');
      const u = await c.query(
        'UPDATE users SET project_id = NULL, team_joined_at = NULL WHERE id = $1 AND project_id = $2',
        [user.id, id],
      );
      if (u.rowCount !== 1) throw forbidden('You are not on this team.');
      // Delete the project if nobody is left and nothing is checked out (or voted for).
      const del = await c.query(
        `DELETE FROM projects p
          WHERE p.id = $1
            AND NOT EXISTS (SELECT 1 FROM users WHERE project_id = p.id)
            AND NOT EXISTS (SELECT 1 FROM equipment_requests WHERE project_id = p.id AND returned_at IS NULL)
            AND NOT EXISTS (SELECT 1 FROM ballot_votes WHERE project_id = p.id)`,
        [id],
      );
      return { title: p.rows[0].title, deleted: del.rowCount === 1 };
    });
    stateCache.invalidate();
    res.json({ ok: true, ...result });
  });

  // ------------------------------------------------------------ equipment
  r.post('/equipment/requests', async (req, res) => {
    const user = await sessions.requireUser(req, res);
    const { items } = parse(equipmentSchema, req.body, {
      items: 'Quantities must be whole numbers from 1 to 999 for known items.',
    });
    const keys = Object.keys(items).sort();
    const out = await withTx(pool, async (c) => {
      requirePhase(await getPhase(c, 'FOR SHARE'), ['reg', 'build'], 'The equipment desk is closed for new requests.');
      const me = await c.query<{ project_id: number | null }>('SELECT project_id FROM users WHERE id = $1 FOR SHARE', [
        user.id,
      ]);
      const projectId = me.rows[0]?.project_id;
      if (!projectId) throw forbidden('Join or post a project first — the desk issues one pick-list per team.');
      const eq = await c.query<{ key: string; name: string; stock_total: number }>(
        'SELECT key, name, stock_total FROM equipment WHERE key = ANY($1::text[]) ORDER BY key FOR UPDATE',
        [keys],
      );
      if (eq.rows.length !== keys.length) throw bad('Unknown equipment item.');
      const used = await c.query<{ key: string; used: number }>(
        `SELECT i.equipment_key AS key, sum(i.qty)::int AS used
           FROM equipment_request_items i
           JOIN equipment_requests r ON r.id = i.request_id
          WHERE r.returned_at IS NULL AND i.equipment_key = ANY($1::text[])
          GROUP BY i.equipment_key`,
        [keys],
      );
      const usedBy = new Map(used.rows.map((u) => [u.key, u.used]));
      for (const e of eq.rows) {
        const available = Math.max(0, e.stock_total - (usedBy.get(e.key) ?? 0));
        if (items[e.key]! > available) {
          throw conflict(
            available === 0 ? `No more ${e.name} in stock.` : `Only ${available} × ${e.name} left in stock.`,
          );
        }
      }
      const rq = await c.query<{ id: number }>(
        'INSERT INTO equipment_requests (project_id, requested_by) VALUES ($1, $2) RETURNING id',
        [projectId, user.id],
      );
      const rid = rq.rows[0]!.id;
      await c.query(
        `INSERT INTO equipment_request_items (request_id, equipment_key, qty)
         SELECT $1, k, q FROM unnest($2::text[], $3::int[]) AS t(k, q)`,
        [rid, keys, keys.map((k) => items[k]!)],
      );
      const total = keys.reduce((s, k) => s + items[k]!, 0);
      return { id: rid, total };
    });
    stateCache.invalidate();
    res.status(201).json({ ok: true, ...out });
  });

  // ---------------------------------------------------------------- ballot
  r.post('/ballot', async (req, res) => {
    const user = await sessions.requireUser(req, res);
    const { projectIds } = parse(ballotSchema, req.body, {
      projectIds: 'Pick between one and three projects.',
    });
    const ids = [...new Set(projectIds)];
    if (ids.length !== projectIds.length) throw bad('Each project can get only one of your votes.');
    await withTx(pool, async (c) => {
      requirePhase(await getPhase(c, 'FOR SHARE'), ['vote'], 'Voting is not open.');
      const me = await c.query<{ project_id: number | null; email_verified_at: Date | null }>(
        'SELECT project_id, email_verified_at FROM users WHERE id = $1 FOR SHARE',
        [user.id],
      );
      const row = me.rows[0]!;
      if (config.requireVerifiedEmailToVote && !row.email_verified_at) {
        throw forbidden('Confirm your email first — use the link we sent you.');
      }
      if (row.project_id !== null && ids.includes(row.project_id)) {
        throw forbidden('You cannot vote for your own team.');
      }
      const found = await c.query<{ n: number }>('SELECT count(*) AS n FROM projects WHERE id = ANY($1::bigint[])', [
        ids,
      ]);
      if (found.rows[0]!.n !== ids.length) throw notFound('One of those projects no longer exists.');
      const b = await c.query('INSERT INTO ballots (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
      if (b.rowCount !== 1) throw conflict('You already voted.');
      await c.query(
        'INSERT INTO ballot_votes (user_id, project_id) SELECT $1, unnest($2::bigint[])',
        [user.id, ids],
      );
    });
    res.status(201).json({ ok: true, votes: ids });
  });

  return r;
}
