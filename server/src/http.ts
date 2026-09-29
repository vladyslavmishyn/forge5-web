import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

/** An error whose message is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const bad = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = 'Sign in first.') => new HttpError(401, msg);
export const forbidden = (msg: string) => new HttpError(403, msg);
export const notFound = (msg = 'Not found.') => new HttpError(404, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

// ------------------------------------------------------------------ tokens

export function newToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time string comparison (hash both sides so lengths always match). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

// -------------------------------------------------------------- validation

// C0/C1 control characters, DEL, line/paragraph separators, bidi overrides.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

export const hasControlChars = (s: string) => CONTROL_RE.test(s);

/** Trimmed single-line text with length bounds and no control characters. */
export function text(min: number, max: number) {
  return z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !hasControlChars(s), { message: 'contains control characters' });
}

/** Like text() but newlines/tabs are first collapsed to single spaces (textareas). */
export function paragraph(min: number, max: number) {
  return z
    .string()
    .transform((s) => s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' '))
    .pipe(text(min, max));
}

/**
 * Parse `data` with `schema`. On failure throw a 400 HttpError whose message is taken from
 * `messages[firstIssuePathKey]`, else a generic message.
 */
export function parse<T extends z.ZodType>(
  schema: T,
  data: unknown,
  messages: Record<string, string> = {},
  fallback = 'Invalid request.',
): z.output<T> {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  if (issue?.code === 'unrecognized_keys') throw bad('Unexpected field in request.');
  const key = issue ? String(issue.path[0] ?? '') : '';
  throw bad(messages[key] ?? fallback);
}

/** Positive integer route param. */
export function idParam(raw: unknown): number {
  const s = String(raw ?? '');
  if (!/^\d{1,15}$/.test(s)) throw notFound('No such project.');
  const n = Number(s);
  if (n < 1) throw notFound('No such project.');
  return n;
}

// ----------------------------------------------------------------- cookies

export const USER_COOKIE = 'f5_session';
export const ADMIN_COOKIE = 'f5_admin';
export const USER_SESSION_MS = 30 * 24 * 3600 * 1000;
export const ADMIN_SESSION_MS = 12 * 3600 * 1000;

export function cookieOptions(secure: boolean, maxAgeMs?: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  };
}

export function readCookie(req: Request, name: string): string | null {
  const v = (req.cookies as Record<string, unknown> | undefined)?.[name];
  // Tokens are 43-char base64url; reject anything else without touching the DB.
  return typeof v === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : null;
}

// ------------------------------------------------------------------ misc

export const noStore = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
};
