import { existsSync } from 'node:fs';
import { join } from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler, type Express } from 'express';
import type pg from 'pg';
import type { Config } from './config.js';
import { HttpError, noStore } from './http.js';
import type { Mailer } from './mailer.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { publicRoutes } from './routes/public.js';
import { teamRoutes } from './routes/team.js';
import { csrfGuard, createLimiters, securityHeaders, type Limiters } from './security.js';
import { Sessions, getPhase } from './sessions.js';
import { createStateCache, type StateCache } from './state-cache.js';
import { loadPublicState, type PublicState } from './routes/public.js';

export interface AppDeps {
  pool: pg.Pool;
  config: Config;
  mailer: Mailer;
  /** Directory with the built SPA (index.html + assets/). Omit to serve the API only. */
  staticDir?: string | null;
}

/** Internal dependency bag handed to route modules. */
export interface Deps extends AppDeps {
  sessions: Sessions;
  limiters: Limiters;
  /** Per-app cache of the public GET /api/state payload; call invalidate() after mutations. */
  stateCache: StateCache<PublicState>;
}

/**
 * Build the Express app without listening, so tests can import it:
 *   const app = createApp({ pool, config: loadConfig({...}), mailer: { send: async (m) => sent.push(m) } });
 */
export function createApp({ pool, config, mailer, staticDir = null }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);

  const deps: Deps = {
    pool,
    config,
    mailer,
    staticDir,
    sessions: new Sessions(pool, config.isProduction),
    limiters: createLimiters(),
    stateCache: createPublicStateCache(pool),
  };

  app.use(securityHeaders(config));
  app.use(compression());

  // ------------------------------------------------------------------ API
  const api = express.Router();
  api.use(noStore);
  api.use(deps.limiters.api);
  api.use(csrfGuard(config.allowedOrigins));
  api.use(express.json({ limit: '16kb', strict: true }));
  api.use(cookieParser());

  api.use(publicRoutes(deps));
  api.use(authRoutes(deps));
  api.use(teamRoutes(deps));
  api.use('/admin', adminRoutes(deps));
  api.use((_req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });
  app.use('/api', api);

  // ------------------------------------------------------------ SPA/static
  if (staticDir && existsSync(join(staticDir, 'index.html'))) {
    const indexHtml = join(staticDir, 'index.html');
    app.use(
      express.static(staticDir, {
        index: false,
        redirect: false,
        dotfiles: 'ignore',
        setHeaders(res, filePath) {
          if (filePath.includes(`${join(staticDir, 'assets')}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=86400');
          }
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      // Missing hashed assets/fonts must 404 instead of returning the SPA shell.
      if (/^\/(assets|fonts)\//.test(req.path) || /\.[a-z0-9]{1,8}$/i.test(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use((_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });

  // --------------------------------------------------------------- errors
  const onError: ErrorRequestHandler = (err, req, res, _next) => {
    const isApi = req.originalUrl.startsWith('/api');
    let status = 500;
    let message = 'Something went wrong.';
    if (err instanceof HttpError) {
      status = err.status;
      message = err.message;
    } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.parse.failed') {
      status = 400;
      message = 'Malformed JSON body.';
    } else if (err && typeof err === 'object' && (err as { type?: string }).type === 'entity.too.large') {
      status = 413;
      message = 'Request body too large.';
    } else if (err && typeof err === 'object' && typeof (err as { status?: number }).status === 'number') {
      const s = (err as { status: number }).status;
      if (s >= 400 && s < 500) {
        status = s;
        message = 'Bad request.';
      }
    } else if ((err as { code?: string })?.code === '23505') {
      status = 409;
      message = 'That conflicts with existing data.';
    } else if (['23514', '22021', '22P02', '22001', '22003'].includes((err as { code?: string })?.code ?? '')) {
      // Safety net for input that slipped past validation: check violation, bad encoding (e.g. NUL),
      // invalid text representation, value too long, numeric out of range.
      status = 400;
      message = 'Invalid input.';
    }
    if (status >= 500) {
      // Log only what helps debugging: never bodies, cookies, tokens, emails or SQL parameters.
      const e = err as { code?: string; stack?: string; message?: string };
      console.error(`[error] ${req.method} ${req.path} code=${e?.code ?? '-'}\n${e?.stack ?? e?.message ?? String(err)}`);
    }
    if (res.headersSent) return;
    if (isApi) res.status(status).json({ error: message });
    else res.status(status).type('text/plain').send(message);
  };
  app.use(onError);

  return app;
}

/**
 * Cache for GET /api/state. The heavy part (counts, projects + members, equipment availability) is
 * cached for 2 s with single-flight loading; `phase` is a one-row primary-key read done per request
 * (also single-flight), so phase changes are visible immediately even if made outside the app.
 * Routes call invalidate() after every mutation that affects the payload.
 */
function createPublicStateCache(pool: pg.Pool): StateCache<PublicState> {
  const body = createStateCache(() => loadPublicState(pool), 2000);
  const phase = createStateCache(() => getPhase(pool), 0);
  return {
    async get() {
      const [p, b] = await Promise.all([phase.get(), body.get()]);
      return { phase: p, ...b };
    },
    invalidate() {
      body.invalidate();
      phase.invalidate();
    },
  };
}
