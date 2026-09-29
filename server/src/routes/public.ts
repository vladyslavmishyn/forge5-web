import { Router } from 'express';
import { projectCode, type Phase } from '../../../shared/constants.js';
import { forbidden } from '../http.js';
import { getPhase } from '../sessions.js';
import type { Deps } from '../app.js';

export function publicRoutes({ pool, sessions, config, limiters, stateCache }: Deps): Router {
  const r = Router();

  r.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  // Public event state. Identical for every caller (built from the database only, never from the
  // request), so it is served from a short per-app cache. It must never include emails, user ids, diet,
  // skills, majors, verification status, or anything about ballots/votes.
  r.get('/state', limiters.state, async (_req, res) => {
    res.json(await stateCache.get());
  });

  r.get('/me', async (req, res) => {
    const [user, isAdmin] = await Promise.all([sessions.user(req, res), sessions.isAdmin(req, res)]);
    res.json(await meBody(pool, user, isAdmin, config.requireVerifiedEmailToVote));
  });

  r.get('/results', async (_req, res) => {
    const phase = await getPhase(pool);
    if (phase !== 'result') throw forbidden('Results are sealed until they are announced.');
    const rows = await pool.query<{ id: number; title: string; fields: string[]; member_count: number; votes: number }>(
      `SELECT p.id, p.title, p.fields,
              (SELECT count(*) FROM users u WHERE u.project_id = p.id) AS member_count,
              (SELECT count(*) FROM ballot_votes v WHERE v.project_id = p.id) AS votes
         FROM projects p
        ORDER BY votes DESC, p.id ASC`,
    );
    res.json(
      rows.rows.map((p) => ({
        id: p.id,
        code: projectCode(p.id),
        title: p.title,
        fields: p.fields,
        memberCount: p.member_count,
        votes: p.votes,
      })),
    );
  });

  return r;
}

export async function meBody(
  pool: Deps['pool'],
  user: Awaited<ReturnType<Deps['sessions']['user']>>,
  isAdmin: boolean,
  verificationRequired: boolean,
) {
  if (!user) return { user: null, isAdmin, verificationRequired };
  const [ballot, votes] = await Promise.all([
    pool.query('SELECT 1 FROM ballots WHERE user_id = $1', [user.id]),
    pool.query<{ project_id: number }>('SELECT project_id FROM ballot_votes WHERE user_id = $1 ORDER BY project_id', [
      user.id,
    ]),
  ]);
  return {
    user: {
      name: user.name,
      email: user.email,
      college: user.college,
      major: user.major,
      skills: user.skills,
      wantsTeam: user.wants_team,
      projectId: user.project_id,
      emailVerified: user.email_verified_at !== null,
      hasVoted: (ballot.rowCount ?? 0) > 0,
      votes: votes.rows.map((v) => v.project_id),
    },
    isAdmin,
    verificationRequired,
  };
}

export type PublicState = { phase: Phase } & Awaited<ReturnType<typeof loadPublicState>>;

/**
 * Build the public /api/state payload minus `phase` (which is read fresh per request, see app.ts).
 * Takes no request input by design: the result is identical for every caller.
 */
export async function loadPublicState(pool: Deps['pool']) {
  const [counts, projects, equipment] = await Promise.all([
    pool.query<{ students: number; teams: number; colleges: number }>(
      `SELECT (SELECT count(*) FROM users) AS students,
              (SELECT count(*) FROM projects) AS teams,
              (SELECT count(DISTINCT college) FROM users) AS colleges`,
    ),
    pool.query<{
      id: number;
      title: string;
      blurb: string;
      fields: string[];
      cap: number;
      need: string;
      members: { name: string; college: string }[];
    }>(
      `SELECT p.id, p.title, p.blurb, p.fields, p.cap, p.need,
              COALESCE(
                json_agg(json_build_object('name', u.name, 'college', u.college)
                         ORDER BY u.team_joined_at, u.id) FILTER (WHERE u.id IS NOT NULL),
                '[]'::json) AS members
         FROM projects p
         LEFT JOIN users u ON u.project_id = p.id
        GROUP BY p.id
        ORDER BY p.created_at DESC, p.id DESC`,
    ),
    pool.query<{ key: string; name: string; stock: number; available: number }>(
      `SELECT e.key, e.name, e.stock_total AS stock,
              GREATEST(0, e.stock_total - COALESCE(sum(i.qty) FILTER (WHERE r.id IS NOT NULL AND r.returned_at IS NULL), 0))::int AS available
         FROM equipment e
         LEFT JOIN equipment_request_items i ON i.equipment_key = e.key
         LEFT JOIN equipment_requests r ON r.id = i.request_id
        GROUP BY e.key
        ORDER BY e.sort, e.key`,
    ),
  ]);
  const c = counts.rows[0]!;
  const seats = projects.rows.reduce((s, p) => s + Math.max(0, p.cap - p.members.length), 0);
  return {
    stats: { students: c.students, teams: c.teams, colleges: c.colleges, seats },
    projects: projects.rows.map((p) => ({
      id: p.id,
      code: projectCode(p.id),
      title: p.title,
      blurb: p.blurb,
      fields: p.fields,
      cap: p.cap,
      need: p.need,
      members: p.members.map((m) => ({ name: m.name, college: m.college })),
    })),
    equipment: equipment.rows.map((e) => ({ key: e.key, name: e.name, stock: e.stock, available: e.available })),
  };
}
