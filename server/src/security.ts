import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Config } from './config.js';

export function securityHeaders(config: Pick<Config, 'isProduction'>): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    strictTransportSecurity: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginEmbedderPolicy: false,
  });
}

/**
 * CSRF defence for every non-GET/HEAD /api request: require a JSON content type (which cannot be
 * sent cross-site without a CORS preflight) AND an Origin header matching the app's origin.
 */
export function csrfGuard(allowedOrigins: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const ct = String(req.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase();
    const origin = req.headers.origin;
    if (ct !== 'application/json' || typeof origin !== 'string' || !allowedOrigins.includes(origin)) {
      res.status(403).json({ error: 'Request blocked (cross-site or malformed request).' });
      return;
    }
    next();
  };
}

const tooMany = (msg = 'Too many requests — please wait a few minutes and try again.') => ({ error: msg });

export interface Limiters {
  api: RequestHandler;
  /** Backstop for the (cached, generally exempt) public GET /api/state. */
  state: RequestHandler;
  register: RequestHandler;
  authLink: RequestHandler;
  authRedeem: RequestHandler;
  adminLogin: RequestHandler;
  /** Returns true if this email may receive another sign-in link now (3 per 15 min). */
  emailLinkAllowed(email: string): boolean;
}

/** All limiters are created per app instance so tests get fresh counters with each createApp(). */
export function createLimiters(): Limiters {
  const mk = (windowMs: number, limit: number, msg?: string, skip?: (req: Request) => boolean) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: tooMany(msg),
      ...(skip ? { skip } : {}),
    });

  // Campus NAT: every attendee may share one public IP, and every open tab polls /api/state every 15 s,
  // so the cheap public reads are exempt from the general limiter.
  const isPublicPoll = (req: Request) =>
    (req.method === 'GET' || req.method === 'HEAD') && (req.path === '/state' || req.path === '/health');

  const EMAIL_WINDOW = 15 * 60 * 1000;
  const EMAIL_LIMIT = 3;
  const perEmail = new Map<string, number[]>();

  return {
    api: mk(60 * 1000, 1200, undefined, isPublicPoll),
    state: mk(60 * 1000, 3000),
    register: mk(10 * 60 * 1000, 200, 'Too many registrations from this network — try again in a few minutes.'),
    authLink: mk(15 * 60 * 1000, 60, 'Too many sign-in link requests — try again in 15 minutes.'),
    authRedeem: mk(15 * 60 * 1000, 100, 'Too many sign-in attempts — try again in 15 minutes.'),
    adminLogin: mk(15 * 60 * 1000, 5, 'Too many admin sign-in attempts — try again in 15 minutes.'),
    emailLinkAllowed(email: string) {
      const now = Date.now();
      if (perEmail.size > 50_000) {
        for (const [k, ts] of perEmail) if (ts.every((t) => now - t > EMAIL_WINDOW)) perEmail.delete(k);
      }
      const recent = (perEmail.get(email) ?? []).filter((t) => now - t < EMAIL_WINDOW);
      if (recent.length >= EMAIL_LIMIT) {
        perEmail.set(email, recent);
        return false;
      }
      recent.push(now);
      perEmail.set(email, recent);
      return true;
    },
  };
}
