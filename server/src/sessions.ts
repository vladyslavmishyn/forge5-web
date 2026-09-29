import type { Request, Response } from 'express';
import type pg from 'pg';
import {
  ADMIN_COOKIE,
  ADMIN_SESSION_MS,
  USER_COOKIE,
  USER_SESSION_MS,
  cookieOptions,
  hashToken,
  newToken,
  readCookie,
  unauthorized,
  forbidden,
} from './http.js';
import type { Phase } from '../../shared/constants.js';

export interface UserRow {
  id: number;
  name: string;
  email: string;
  college: string;
  major: string;
  skills: string[];
  wants_team: boolean;
  email_verified_at: Date | null;
  project_id: number | null;
}

const USER_COLS = 'u.id, u.name, u.email, u.college, u.major, u.skills, u.wants_team, u.email_verified_at, u.project_id';

type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;

export class Sessions {
  constructor(
    private pool: pg.Pool,
    private secureCookies: boolean,
  ) {}

  /** Opportunistic cleanup of expired rows; never fails the request. */
  async sweep(): Promise<void> {
    try {
      await this.pool.query('DELETE FROM sessions WHERE expires_at < now()');
      await this.pool.query(
        "DELETE FROM login_tokens WHERE expires_at < now() - interval '1 day' OR used_at < now() - interval '1 day'",
      );
    } catch (err) {
      console.error('[sessions] sweep failed:', (err as { code?: string }).code ?? 'error');
    }
  }

  async startUserSession(res: Response, userId: number, db: Queryable = this.pool): Promise<void> {
    const token = newToken();
    await db.query(
      `INSERT INTO sessions (token_hash, user_id, is_admin, expires_at)
       VALUES ($1, $2, false, now() + make_interval(secs => $3))`,
      [hashToken(token), userId, USER_SESSION_MS / 1000],
    );
    res.cookie(USER_COOKIE, token, cookieOptions(this.secureCookies, USER_SESSION_MS));
  }

  async startAdminSession(res: Response): Promise<void> {
    const token = newToken();
    await this.pool.query(
      `INSERT INTO sessions (token_hash, user_id, is_admin, expires_at)
       VALUES ($1, NULL, true, now() + make_interval(secs => $2))`,
      [hashToken(token), ADMIN_SESSION_MS / 1000],
    );
    res.cookie(ADMIN_COOKIE, token, cookieOptions(this.secureCookies, ADMIN_SESSION_MS));
  }

  async endUserSession(req: Request, res: Response): Promise<void> {
    const token = readCookie(req, USER_COOKIE);
    if (token) await this.pool.query('DELETE FROM sessions WHERE token_hash = $1 AND NOT is_admin', [hashToken(token)]);
    res.clearCookie(USER_COOKIE, cookieOptions(this.secureCookies));
    delete res.locals.user;
  }

  async endAdminSession(req: Request, res: Response): Promise<void> {
    const token = readCookie(req, ADMIN_COOKIE);
    if (token) await this.pool.query('DELETE FROM sessions WHERE token_hash = $1 AND is_admin', [hashToken(token)]);
    res.clearCookie(ADMIN_COOKIE, cookieOptions(this.secureCookies));
    delete res.locals.isAdmin;
  }

  /** The signed-in user or null. Cached per request. */
  async user(req: Request, res: Response): Promise<UserRow | null> {
    if (res.locals.user !== undefined) return res.locals.user as UserRow | null;
    const token = readCookie(req, USER_COOKIE);
    let user: UserRow | null = null;
    if (token) {
      const r = await this.pool.query<UserRow>(
        `SELECT ${USER_COLS}
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND NOT s.is_admin AND s.expires_at > now()`,
        [hashToken(token)],
      );
      user = r.rows[0] ?? null;
    }
    res.locals.user = user;
    return user;
  }

  async userById(id: number): Promise<UserRow | null> {
    const r = await this.pool.query<UserRow>(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [id]);
    return r.rows[0] ?? null;
  }

  async requireUser(req: Request, res: Response): Promise<UserRow> {
    const u = await this.user(req, res);
    if (!u) throw unauthorized('Register or sign in first.');
    return u;
  }

  async isAdmin(req: Request, res: Response): Promise<boolean> {
    if (res.locals.isAdmin !== undefined) return res.locals.isAdmin as boolean;
    const token = readCookie(req, ADMIN_COOKIE);
    let ok = false;
    if (token) {
      const r = await this.pool.query(
        'SELECT 1 FROM sessions WHERE token_hash = $1 AND is_admin AND expires_at > now()',
        [hashToken(token)],
      );
      ok = r.rowCount === 1;
    }
    res.locals.isAdmin = ok;
    return ok;
  }

  async requireAdmin(req: Request, res: Response): Promise<void> {
    if (!(await this.isAdmin(req, res))) throw unauthorized('Admin sign-in required.');
  }
}

export async function getPhase(db: Queryable, lock: '' | 'FOR SHARE' | 'FOR UPDATE' = ''): Promise<Phase> {
  const r = await db.query<{ phase: Phase }>(`SELECT phase FROM settings WHERE id ${lock}`);
  return r.rows[0]?.phase ?? 'reg';
}

export function requirePhase(phase: Phase, allowed: Phase[], msg: string): void {
  if (!allowed.includes(phase)) throw forbidden(msg);
}
