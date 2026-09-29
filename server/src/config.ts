import { z } from 'zod';

export interface Config {
  databaseUrl: string;
  databaseSsl: boolean;
  port: number;
  isProduction: boolean;
  /** Public origin, e.g. https://forge5.example.com (no trailing slash). */
  appUrl: string;
  /** Origins accepted by the CSRF Origin check. */
  allowedOrigins: string[];
  trustProxy: number;
  /** null when admin sign-in is disabled. */
  adminPassword: string | null;
  smtpUrl: string | null;
  mailFrom: string;
  /** Lower-cased domain suffixes; empty = any domain allowed. */
  allowedEmailDomains: string[];
  requireVerifiedEmailToVote: boolean;
}

export class ConfigError extends Error {}

const boolish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .transform((v) => (v === '' ? undefined : v === 'true' || v === '1' || v === 'yes'));

const envSchema = z.object({
  DATABASE_URL: z
    .string({ error: 'is required (e.g. postgres://localhost:5432/forge5)' })
    .min(1, 'is required (e.g. postgres://localhost:5432/forge5)'),
  DATABASE_SSL: boolish.optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.string().optional(),
  APP_URL: z.string().optional(),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  ADMIN_PASSWORD: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  ALLOWED_EMAIL_DOMAINS: z.string().optional(),
  REQUIRE_VERIFIED_EMAIL_TO_VOTE: boolish.optional(),
});

export interface ConfigWarnings {
  warnings: string[];
}

/**
 * Parse and validate configuration from an environment object. Throws ConfigError with a readable
 * message on any problem. Returns non-fatal warnings alongside the config.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config & ConfigWarnings {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration — ${msg}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const warnings: string[] = [];

  // APP_URL
  const rawAppUrl = e.APP_URL?.trim() || (isProduction ? '' : 'http://localhost:5173');
  if (!rawAppUrl) throw new ConfigError('APP_URL is required in production (e.g. https://forge5.example.com)');
  let appOrigin: string;
  try {
    const u = new URL(rawAppUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
    appOrigin = u.origin;
  } catch {
    throw new ConfigError(`APP_URL must be an absolute http(s) URL, got "${rawAppUrl}"`);
  }
  if (isProduction && !appOrigin.startsWith('https://')) {
    warnings.push('APP_URL is not https — secure cookies will not be sent over plain http.');
  }
  const allowedOrigins = [appOrigin];
  if (!isProduction) {
    for (const o of ['http://localhost:5173', 'http://localhost:3000']) {
      if (!allowedOrigins.includes(o)) allowedOrigins.push(o);
    }
  }

  // ADMIN_PASSWORD
  let adminPassword: string | null = e.ADMIN_PASSWORD ?? null;
  if (!adminPassword) {
    adminPassword = null;
    warnings.push('ADMIN_PASSWORD is not set — admin sign-in is disabled.');
  } else if (adminPassword.length < 16) {
    if (isProduction) throw new ConfigError('ADMIN_PASSWORD must be at least 16 characters in production.');
    adminPassword = null;
    warnings.push('ADMIN_PASSWORD is shorter than 16 characters — admin sign-in is disabled.');
  }

  const smtpUrl = e.SMTP_URL?.trim() || null;
  let requireVerifiedEmailToVote = e.REQUIRE_VERIFIED_EMAIL_TO_VOTE ?? Boolean(smtpUrl);
  if (!smtpUrl) {
    if (isProduction) {
      warnings.push(
        'SMTP_URL is not set — sign-in and confirmation emails are DISABLED. Returning users cannot get ' +
          'sign-in links and emails cannot be verified. Set SMTP_URL (and MAIL_FROM) before the event.',
      );
      if (requireVerifiedEmailToVote) {
        warnings.push('REQUIRE_VERIFIED_EMAIL_TO_VOTE ignored: emails cannot be verified without SMTP_URL.');
        requireVerifiedEmailToVote = false;
      }
    } else {
      warnings.push('SMTP_URL is not set — emails will be printed to this console (dev only).');
    }
  }

  const domainsRaw = e.ALLOWED_EMAIL_DOMAINS ?? '.edu';
  const allowedEmailDomains = domainsRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return {
    databaseUrl: e.DATABASE_URL,
    databaseSsl: e.DATABASE_SSL ?? false,
    port: e.PORT,
    isProduction,
    appUrl: appOrigin,
    allowedOrigins,
    trustProxy: e.TRUST_PROXY,
    adminPassword,
    smtpUrl,
    mailFrom: e.MAIL_FROM?.trim() || 'Forge5 <no-reply@localhost>',
    allowedEmailDomains,
    requireVerifiedEmailToVote,
    warnings,
  };
}

/** True if the email's domain matches one of the allowed suffixes (or no restriction is configured). */
export function emailDomainAllowed(config: Pick<Config, 'allowedEmailDomains'>, email: string): boolean {
  if (config.allowedEmailDomains.length === 0) return true;
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return config.allowedEmailDomains.some((s) => {
    const bare = s.replace(/^\.+/, '');
    if (!bare) return false;
    if (s.startsWith('.')) return domain.endsWith('.' + bare) || domain === bare;
    return domain === bare || domain.endsWith('.' + bare);
  });
}
