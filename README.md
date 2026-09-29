# forge5-web

Registration and team portal for **Forge5**, the Five Colleges of Ohio hackathon at Kenyon.
Students register, form cross-discipline teams, request equipment, cast a peer vote and see results.
Organizers run the event phases and the equipment desk from an admin view.

- **Web:** React 19 + Vite + TypeScript (`web/`) — the approved design, ported class-for-class.
- **API:** Express 5 + PostgreSQL (`server/`), one Node process serves `/api/*` and the built SPA.
- **Shared:** `shared/constants.ts` (fields, skills, institutions, phases) used by both.

## Local setup

Requirements: Node 22+, PostgreSQL 14+.

```sh
npm install
createdb forge5                 # and `createdb forge5_test` for tests
cp .env.example .env            # then set ADMIN_PASSWORD (≥ 16 chars)
npm run dev                     # API on :3000 (tsx watch) + Vite on :5173 (proxies /api)
npm run seed:demo               # optional: the six demo projects from the mock
```

Open http://localhost:5173. Without `SMTP_URL`, emails — including sign-in links — are printed to the
API console in development.

| Script | What it does |
|---|---|
| `npm run dev` | API + Vite dev servers |
| `npm run build` | Clean `dist/`, build the SPA to `dist/web`, compile the server to `dist/server`, copy migrations |
| `npm start` | Run the built server (`dist/server/src/index.js`, loads `.env` if present) |
| `npm run migrate` | Apply pending SQL migrations (also done automatically at startup) |
| `npm run seed:demo` | Dev only: insert demo projects/members if no projects exist (refuses in production) |
| `npm run typecheck` | Type-check web and server |

Migrations are plain SQL files in `server/migrations/NNN_name.sql`, applied in order at startup inside
a transaction under a Postgres advisory lock and recorded in `schema_migrations`.

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | `postgres://user:pass@host:5432/db` |
| `DATABASE_SSL` | no | `false` | `true` → TLS without certificate verification (managed Postgres) |
| `PORT` | no | `3000` | |
| `NODE_ENV` | no | — | `production` enables secure cookies, HSTS, redacted mailer, stricter checks |
| `APP_URL` | prod | `http://localhost:5173` in dev | Public origin; used for email links and the CSRF Origin check |
| `TRUST_PROXY` | no | `0` | Reverse-proxy hops (Render/Heroku/nginx: `1`) so rate limits see the real client IP |
| `ADMIN_PASSWORD` | no | — | ≥ 16 chars. Unset/short → admin sign-in disabled (production refuses a short one) |
| `SMTP_URL` | no | — | nodemailer URL, e.g. `smtps://user:pass@smtp.example.com:465` |
| `MAIL_FROM` | no | `Forge5 <no-reply@localhost>` | From header |
| `ALLOWED_EMAIL_DOMAINS` | no | `.edu` | Comma-separated domain suffixes allowed to register; empty = any |
| `REQUIRE_VERIFIED_EMAIL_TO_VOTE` | no | `true` if `SMTP_URL` set, else `false` | Voters must have clicked their email link |

Without `SMTP_URL` in production nothing is emailed (the log says "email disabled, would send to &lt;redacted&gt;"),
so returning users cannot get sign-in links — configure SMTP for a real event.

## How sign-in works

Email addresses must be plain printable ASCII — internationalized addresses (non-ASCII characters) are rejected by design.

There are no passwords for students. Registering creates the account and signs that browser in (30-day
session cookie). The confirmation email contains the rules and a link `APP_URL/signin#token=…` (valid 48 h)
that confirms the email and signs in on any device. "Email me a sign-in link" sends a 20-minute, single-use
link. The token lives in the URL fragment, so it never reaches server logs or `Referer`; the page redeems it
with a POST (mail scanners that prefetch GET links cannot burn it).

## Admin usage

1. Go to `/admin` and enter `ADMIN_PASSWORD` (12-hour admin session, separate from any student session).
2. The header then shows the phase control: **1 · Register → 2 · Build → 3 · Vote → 4 · Results**.
   - Register/Build: registration, creating/joining/leaving teams and equipment requests are open.
   - Vote: teams lock, each student casts up to 3 votes (not for their own team).
   - Results: the tally is revealed. Vote counts are never exposed before this phase.
3. The **Admin** tab lists equipment pick lists per team — **Print pick lists** prints them,
   **Mark returned** releases the stock. **Download registrations CSV** exports all registrations
   (formula-injection safe). **Admin sign-out** ends the admin session.

## Deploy

**Render (one click):** New → Blueprint → select this repo. `render.yaml` creates the web service and a
Postgres database, generates `ADMIN_PASSWORD`, and sets `TRUST_PROXY=1`. Then set `APP_URL` to the
service's public URL (and `SMTP_URL`/`MAIL_FROM`) and redeploy.

**Docker:**

```sh
docker build -t forge5 .
docker run -p 3000:3000 \
  -e NODE_ENV=production -e APP_URL=https://forge5.example.com \
  -e DATABASE_URL=postgres://… -e ADMIN_PASSWORD=… -e SMTP_URL=… -e MAIL_FROM=… \
  -e TRUST_PROXY=1 forge5
```

Put it behind HTTPS (cookies are `Secure` in production). Migrations run on boot.

## Security notes

- Session and sign-in tokens are 256-bit random values; only SHA-256 hashes are stored.
- Cookies: `HttpOnly`, `SameSite=Lax`, `Secure` in production. Admin and student sessions use separate cookies.
- CSRF: every non-GET `/api` request must be `Content-Type: application/json` with an `Origin` equal to `APP_URL`.
- Strict CSP (no inline scripts or styles), HSTS in production, `Referrer-Policy: no-referrer`.
- `GET /api/state` is public and contains only project titles/pitches and member names + colleges — never
  emails, diet, skills, majors, verification status or votes.
- Rate limits per IP on the API, registration, sign-in links (also per email), link redemption and admin login.
- Logs never contain request bodies, cookies, tokens or email addresses (the dev-only console mailer excepted).
