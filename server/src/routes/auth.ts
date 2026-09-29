import { Router } from 'express';
import { z } from 'zod';
import { EMAIL_RE, INSTITUTIONS, SKILLS } from '../../../shared/constants.js';
import { emailDomainAllowed } from '../config.js';
import { withTx } from '../db.js';
import { bad, conflict, hashToken, newToken, parse, text } from '../http.js';
import type { Mail } from '../mailer.js';
import { getPhase, requirePhase } from '../sessions.js';
import type { Deps } from '../app.js';
import { meBody } from './public.js';

const SIGNIN_TTL_S = 20 * 60;
const CONFIRM_TTL_S = 48 * 3600;

// Validate BEFORE lower-casing: EMAIL_RE admits printable ASCII only, so no control characters
// (Postgres rejects NUL) and no non-ASCII letters whose JS/Postgres lower-casing could disagree.
const emailSchema = z
  .string()
  .trim()
  .max(254)
  .refine((s) => EMAIL_RE.test(s), { message: 'invalid email' })
  .transform((s) => s.toLowerCase());

const registerSchema = z
  .object({
    name: text(1, 80),
    email: emailSchema,
    college: z.string().refine((s) => INSTITUTIONS.includes(s)),
    major: z.union([text(0, 80), z.null()]).optional(),
    skills: z
      .array(z.string().refine((s) => SKILLS.includes(s)))
      .max(SKILLS.length)
      .refine((a) => new Set(a).size === a.length)
      .default([]),
    diet: z.union([text(0, 120), z.null()]).optional(),
    aiPolicy: z.literal(true),
    waiver: z.literal(true),
    wantsTeam: z.boolean().default(false),
  })
  .strict();

const REGISTER_MSG: Record<string, string> = {
  name: 'Enter your full name (up to 80 characters, no special control characters).',
  email: 'Enter a valid college email address (plain letters, digits and symbols only).',
  college: 'Pick your institution from the list.',
  major: 'Major / field must be at most 80 characters.',
  skills: 'Pick skills from the list only.',
  diet: 'Dietary needs must be at most 120 characters.',
  aiPolicy: 'You need to accept the AI credit policy and the waiver.',
  waiver: 'You need to accept the AI credit policy and the waiver.',
  wantsTeam: 'Invalid “Place me on a team” value.',
};

const RULES_TEXT = `THE RULES (full text)

1. AI is allowed — credit it. Every AI tool is permitted: coding agents, image models,
   whatever helps. Your submission must name what you used and where. Uncredited AI is
   the only disqualifier.
2. Teams of 2 to 5. Cross-college and cross-discipline teams are the point. Register solo
   and join a team in the portal, or bring one. Every project must cross at least two fields.
3. Equipment is checked out per team at the equipment desk during the first networking
   session and must be returned before the closing session.
4. Peer vote: three votes each, cast through the portal during the second networking
   session (4:00–5:00 p.m.). You cannot vote for your own team.
5. By registering you accepted the event waiver and agreed to photographs during the
   closing session.

Schedule: one Saturday, 9:00 a.m. to 6:00 p.m., Chalmers Library 330.`;

export function authRoutes({ pool, sessions, config, mailer, limiters, stateCache }: Deps): Router {
  const r = Router();

  const link = (token: string) => `${config.appUrl}/signin#token=${token}`;

  async function issueToken(
    db: Pick<typeof pool, 'query'>,
    userId: number,
    purpose: 'signin' | 'confirm',
  ): Promise<string> {
    const token = newToken();
    await db.query(
      `INSERT INTO login_tokens (token_hash, user_id, purpose, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [hashToken(token), userId, purpose, purpose === 'signin' ? SIGNIN_TTL_S : CONFIRM_TTL_S],
    );
    return token;
  }

  function send(mail: Mail) {
    // Fire-and-forget: a mail outage must not fail the request. Never log the address or link.
    mailer.send(mail).catch((err: unknown) => {
      console.error('[mail] send failed:', (err as { code?: string }).code ?? (err as Error)?.name ?? 'error');
    });
  }

  r.post('/register', limiters.register, async (req, res) => {
    if (await sessions.user(req, res)) {
      throw conflict('You are already registered and signed in. Use “Register someone else” to sign out first.');
    }
    const body = parse(registerSchema, req.body, REGISTER_MSG);
    if (!emailDomainAllowed(config, body.email)) {
      throw bad(
        `Use your college email address (${config.allowedEmailDomains.join(', ')}).`,
      );
    }
    const major = body.major?.trim() || 'Undeclared';
    const diet = body.diet?.trim() ?? '';

    const result = await withTx(pool, async (c) => {
      const phase = await getPhase(c, 'FOR SHARE');
      requirePhase(phase, ['reg', 'build'], 'Registration is closed.');
      const ins = await c.query<{ id: number }>(
        `INSERT INTO users (name, email, college, major, skills, diet, wants_team, accepted_ai_policy, accepted_waiver)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, true)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [body.name, body.email, body.college, major, body.skills, diet, body.wantsTeam],
      );
      const id = ins.rows[0]?.id;
      if (!id) throw conflict('This email is already registered. Use “Email me a sign-in link” below.');
      await sessions.startUserSession(res, id, c);
      const token = await issueToken(c, id, 'confirm');
      return { id, token };
    });

    stateCache.invalidate();
    const url = link(result.token);
    send({
      kind: 'confirm',
      to: body.email,
      link: url,
      subject: 'Forge5: confirm your registration',
      text:
        `Hi ${body.name},\n\nYou're registered for Forge5.\n\n` +
        `Confirm your email with the link below. It also signs you in on any device and expires in 48 hours:\n${url}\n\n` +
        `${RULES_TEXT}\n\nIf you did not register, you can ignore this email.\n`,
    });
    void sessions.sweep();

    const row = await sessions.userById(result.id);
    res.status(201).json(await meBody(pool, row, await sessions.isAdmin(req, res), config.requireVerifiedEmailToVote));
  });

  r.post('/auth/link', limiters.authLink, async (req, res) => {
    const { email } = parse(z.object({ email: emailSchema }).strict(), req.body, {
      email: 'Enter a valid email address.',
    });
    if (!limiters.emailLinkAllowed(email)) {
      res.status(429).json({ error: 'Too many sign-in links for this address — try again in 15 minutes.' });
      return;
    }
    // Same work whether or not the account exists (no timing oracle): always mint and hash a token,
    // and do exactly one DB round-trip that inserts it only if the email is registered.
    const token = newToken();
    const ins = await pool.query<{ user_id: number }>(
      `INSERT INTO login_tokens (token_hash, user_id, purpose, expires_at)
       SELECT $1, u.id, 'signin', now() + make_interval(secs => $3)
         FROM users u WHERE u.email = $2
       RETURNING user_id`,
      [hashToken(token), email, SIGNIN_TTL_S],
    );
    if (ins.rows[0]) {
      const url = link(token);
      send({
        kind: 'signin',
        to: email,
        link: url,
        subject: 'Forge5: your sign-in link',
        text:
          `Use this link to sign in to the Forge5 portal. It works once and expires in 20 minutes:\n${url}\n\n` +
          `If you did not ask for it, ignore this email — nobody can sign in without the link.\n`,
      });
    }
    res.json({ ok: true });
  });

  r.post('/auth/redeem', limiters.authRedeem, async (req, res) => {
    const { token } = parse(
      z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) }).strict(),
      req.body,
      {},
      'That sign-in link is invalid or has expired. Request a new one.',
    );
    const userId = await withTx(pool, async (c) => {
      const t = await c.query<{ user_id: number }>(
        `UPDATE login_tokens SET used_at = now()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
          RETURNING user_id`,
        [hashToken(token)],
      );
      const id = t.rows[0]?.user_id;
      if (!id) throw bad('That sign-in link is invalid or has expired. Request a new one.');
      await c.query('UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1', [id]);
      return id;
    });
    // Replace any existing user session in this browser.
    await sessions.endUserSession(req, res);
    await sessions.startUserSession(res, userId);
    void sessions.sweep();
    const row = await sessions.userById(userId);
    res.json(await meBody(pool, row, await sessions.isAdmin(req, res), config.requireVerifiedEmailToVote));
  });

  r.post('/auth/logout', async (req, res) => {
    await sessions.endUserSession(req, res);
    res.json({ ok: true });
  });

  return r;
}

