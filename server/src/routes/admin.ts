import { Router } from 'express';
import { z } from 'zod';
import { PHASES, projectCode } from '../../../shared/constants.js';
import { forbidden, notFound, parse, safeEqual, unauthorized } from '../http.js';
import type { Deps } from '../app.js';

/** Quote a CSV cell and neutralise spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function adminRoutes({ pool, sessions, config, limiters, stateCache }: Deps): Router {
  const r = Router();

  r.post('/login', limiters.adminLogin, async (req, res) => {
    const { password } = parse(z.object({ password: z.string().max(200) }).strict(), req.body, {
      password: 'Enter the admin password.',
    });
    if (!config.adminPassword) throw forbidden('Admin sign-in is disabled on this server.');
    if (!safeEqual(password, config.adminPassword)) throw unauthorized('Wrong admin password.');
    await sessions.endAdminSession(req, res);
    await sessions.startAdminSession(res);
    void sessions.sweep();
    res.json({ ok: true, isAdmin: true });
  });

  r.post('/logout', async (req, res) => {
    await sessions.endAdminSession(req, res);
    res.json({ ok: true });
  });

  // Everything below requires an admin session.
  r.use(async (req, res, next) => {
    await sessions.requireAdmin(req, res);
    next();
  });

  r.put('/phase', async (req, res) => {
    const { phase } = parse(z.object({ phase: z.enum(PHASES) }).strict(), req.body, {
      phase: 'Unknown phase.',
    });
    await pool.query('UPDATE settings SET phase = $1, updated_at = now() WHERE id', [phase]);
    stateCache.invalidate();
    res.json({ ok: true, phase });
  });

  r.get('/requests', async (_req, res) => {
    const rows = await pool.query<{
      id: number;
      project_id: number;
      project_title: string;
      requested_by: string | null;
      created_at: Date;
      returned_at: Date | null;
      items: { key: string; name: string; qty: number }[];
    }>(
      `SELECT r.id, r.project_id, p.title AS project_title, u.name AS requested_by, r.created_at, r.returned_at,
              COALESCE(json_agg(json_build_object('key', e.key, 'name', e.name, 'qty', i.qty) ORDER BY e.sort)
                       FILTER (WHERE i.request_id IS NOT NULL), '[]'::json) AS items
         FROM equipment_requests r
         JOIN projects p ON p.id = r.project_id
         LEFT JOIN users u ON u.id = r.requested_by
         LEFT JOIN equipment_request_items i ON i.request_id = r.id
         LEFT JOIN equipment e ON e.key = i.equipment_key
        GROUP BY r.id, p.title, u.name
        ORDER BY (r.returned_at IS NULL) DESC, r.project_id, r.created_at`,
    );
    res.json(
      rows.rows.map((x) => ({
        id: x.id,
        projectId: x.project_id,
        projectCode: projectCode(x.project_id),
        projectTitle: x.project_title,
        requestedBy: x.requested_by,
        createdAt: x.created_at,
        returnedAt: x.returned_at,
        items: x.items,
      })),
    );
  });

  r.post('/requests/:id/return', async (req, res) => {
    const raw = String(req.params.id ?? '');
    if (!/^\d{1,15}$/.test(raw)) throw notFound('No such request.');
    const u = await pool.query<{ returned_at: Date }>(
      `UPDATE equipment_requests SET returned_at = COALESCE(returned_at, now()) WHERE id = $1 RETURNING returned_at`,
      [Number(raw)],
    );
    if (!u.rows[0]) throw notFound('No such request.');
    stateCache.invalidate();
    res.json({ ok: true, id: Number(raw), returnedAt: u.rows[0].returned_at });
  });

  r.get('/registrations.csv', async (_req, res) => {
    const rows = await pool.query<{
      name: string;
      email: string;
      college: string;
      major: string;
      skills: string[];
      diet: string;
      wants_team: boolean;
      project_id: number | null;
      email_verified_at: Date | null;
      created_at: Date;
    }>(
      `SELECT name, email, college, major, skills, diet, wants_team, project_id, email_verified_at, created_at
         FROM users ORDER BY created_at, id`,
    );
    const header = ['name', 'email', 'college', 'major', 'skills', 'diet', 'wants_team', 'team', 'verified', 'created_at'];
    const lines = [header.map(csvCell).join(',')];
    for (const u of rows.rows) {
      lines.push(
        [
          u.name,
          u.email,
          u.college,
          u.major,
          u.skills.join('; '),
          u.diet,
          u.wants_team ? 'yes' : 'no',
          u.project_id ? projectCode(u.project_id) : '',
          u.email_verified_at ? 'yes' : 'no',
          u.created_at,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="forge5-registrations-${date}.csv"`);
    res.send('\ufeff' + lines.join('\r\n') + '\r\n');
  });

  return r;
}
