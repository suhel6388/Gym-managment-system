# Deployment — Express API + Next.js frontend on one Render service

The Express API and the exported Next.js frontend are served by the same Render
web service, so the site and the API share one origin:
`https://gym-managment-system-7yiu.onrender.com/`.

## Architecture

- `backend/` (this repository) is the Render service. `src/app.js` serves the
  API and the static frontend from `backend/public`.
- The frontend source lives in the separate **public** repository
  `suhel6388/client-gym` and is built as a static export
  (`output: "export"` in `client/next.config.ts`). Static export is compatible:
  the app uses the App Router with `generateStaticParams`, and no server
  actions, route handlers, `next/headers`, or dynamic APIs.
- `npm run build:frontend` builds that export and replaces `backend/public`
  with it. The frontend is compiled with `NEXT_PUBLIC_API_URL=/api/v1` so it
  calls the API on its own origin instead of a hard-coded host.

## Render settings

| Setting       | Value                          |
| ------------- | ------------------------------ |
| Build Command | `npm install && npm run build` |
| Start Command | `npm start`                    |
| Health Check  | `/api/v1/health`               |

`npm run build` = `npm run build:backend` (`prisma generate`) +
`npm run build:frontend`.

`build:frontend` (`scripts/build-frontend.mjs`):

1. uses a local checkout when one exists (`../client`, `./client`, or `FRONTEND_DIR`);
2. otherwise shallow-clones `FRONTEND_REPO_URL`
   (default `https://github.com/suhel6388/client-gym.git`, branch `main`);
3. runs `npm ci` + `next build` with `NEXT_PUBLIC_API_URL`;
4. replaces `backend/public` and verifies `index.html`, `404.html`, and
   `_next/static` are present.

Build-time overrides: `FRONTEND_DIR`, `FRONTEND_REPO_URL`,
`FRONTEND_REPO_BRANCH`, `FRONTEND_API_URL` (defaults to `/api/v1`).

> If the service's Build Command cannot be changed (for example it stays at the
> default `npm install`), commit `backend/public` to this repository — it is
> intentionally **not** gitignored — so the export ships with the checkout.

## Environment variables

Required for the frontend + auth to work on the Render origin:

- `BETTER_AUTH_URL=https://gym-managment-system-7yiu.onrender.com` — base URL
  for Better Auth links/callbacks. It is also always added to
  `trustedOrigins` in `src/lib/auth.ts`, so same-origin auth requests are
  accepted even when `CLIENT_ORIGIN` only lists an external frontend.
- `CLIENT_ORIGIN=https://gym-managment-system-7yiu.onrender.com` — CORS and
  auth email links. Comma-separated; keep the Vercel URL too if that frontend
  stays in use.
- Google OAuth → Authorized redirect URI:
  `https://gym-managment-system-7yiu.onrender.com/api/auth/callback/google`

Existing service variables (unchanged): `DATABASE_URL`, `BETTER_AUTH_SECRET`,
SMTP settings, Razorpay keys, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

## Local development

- Backend: `npm run dev` (port 5000).
- Frontend dev server: `cd ../client && npm run dev`, with
  `NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1` in `client/.env.local`.
- Rebuild the frontend that the backend serves: `npm run build:frontend`.
- Tests: `npm test` (Node 21+; Node's test runner expands the glob).

## How requests are handled

- `/api/*` → API routes; unknown API paths return JSON
  `{"error":"Route not found"}`.
- `/`, `/login/`, `/members/add/`, … → exported HTML. `/login` (no trailing
  slash) 301-redirects to `/login/`.
- `/_next/static/*` → JS/CSS with `Cache-Control: immutable`.
- Unknown page paths → the exported `404.html` with status 404.
- Missing assets (`*.js`, `*.css`, images) → plain-text 404, never HTML.
- If `public/index.html` is missing (frontend not built/copied) → `/` returns
  a 503 JSON error naming the expected absolute path.
