# Gym CRM API guide

This guide describes the backend routes mounted by `src/app.js` and the request validation currently present in the controllers.

## Contents

- [Setup and getting started](#setup-and-getting-started)
- [Super Admin API — end-to-end flow](#super-admin-api-end-to-end-flow)
- [Base URL and requests](#base-url-and-requests)
- [Authentication](#authentication)
  - [`POST /api/v1/auth/signup`](#post-apiv1authsignup)
  - [`POST /api/v1/auth/verify-email`](#post-apiv1authverify-email)
  - [`POST /api/v1/auth/resend-otp`](#post-apiv1authresend-otp)
  - [`POST /api/v1/auth/google`](#post-apiv1authgoogle)
  - [`POST /api/v1/auth/bootstrap-super-admin`](#post-apiv1authbootstrap-super-admin)
  - [`POST /api/v1/auth/super-admin/login`](#post-apiv1authsuper-admin-login)
  - [`POST /api/v1/auth/login`](#post-apiv1authlogin)
  - [`POST /api/v1/auth/logout`](#post-apiv1authlogout)
  - [`GET /api/v1/auth/me`](#get-apiv1authme)
  - [`POST /api/v1/auth/setup-gym`](#post-apiv1authsetup-gym)
  - [`POST /api/v1/auth/forgot-password`](#post-apiv1authforgot-password)
  - [`GET /api/v1/auth/reset-password/verify`](#get-apiv1authreset-passwordverify)
  - [`POST /api/v1/auth/reset-password`](#post-apiv1authreset-password)
- [Health](#health)
- [Add Member API](#add-member-api)
- [Membership plans](#membership-plans)
- [Memberships](#memberships)
- [Attendance](#attendance)
  - [Search members for check-in](#search-members-for-check-in)
  - [Check in](#check-in)
  - [Check out](#check-out)
  - [Typical reception flow](#typical-reception-flow)
  - [Open session](#open-session)
  - [Member history](#member-history)
  - [Today's summary](#todays-summary)
  - [Attendance errors](#attendance-errors)
- [Expenses](#expenses)
- [Staff and receptionists](#staff-and-receptionists)
  - [Staff login](#staff-login)
- [Schedule Call API](#schedule-call-api)
  - [Create a scheduled call](#create-a-scheduled-call-post-apiv1schedule)
  - [List all scheduled calls](#list-all-scheduled-calls-get-apiv1schedule)
  - [Update a scheduled call](#update-a-scheduled-call-patch-apiv1scheduleid)
  - [Delete a scheduled call](#delete-a-scheduled-call-delete-apiv1scheduleid)
- [Role permissions](#role-permissions)
  - [Gym data isolation (`gymId`)](#gym-data-isolation-gymid)
- [Payment receipts](#payment-receipts)
  - [`POST /api/v1/payments`](#post-apiv1payments)
  - [Receipt endpoints](#receipt-endpoints)
  - [Receipt settings](#receipt-settings)
  - [Receipt environment variables](#receipt-environment-variables)
- [Dashboard and reports](#dashboard-and-reports)
  - [`GET /api/v1/reports/dashboard`](#get-apiv1reportsdashboard)
  - [`GET /api/v1/reports/due-memberships`](#get-apiv1reportsdue-memberships)
- [Error responses](#error-responses)
- [SaaS Subscription & Billing](#saas-subscription--billing)
- [Platform administration (super admin)](#platform-administration-super-admin)
  - [Authorization and bootstrap](#authorization-and-bootstrap)
  - [Dashboard and gym directory](#dashboard-and-gym-directory)
  - [Subscription and access actions](#subscription-and-access-actions)
  - [Audit trail](#audit-trail)
  - [Platform admin errors](#platform-admin-errors)
- [Subscription API usage guide](#subscription-api-usage-guide)
- [Subscription Implementation Guide](#subscription-implementation-guide)
- [Current integration blockers](#current-integration-blockers)

## Setup and getting started

### 1. Prerequisites

- Node.js 20+ and npm
- A PostgreSQL database (the default `.env` points at a hosted Supabase Postgres)

### 2. Configure `.env`

| Variable | Required | Purpose / default |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (pooler URL) |
| `DIRECT_URL` | For migrations | Direct (non-pooler) connection string |
| `BETTER_AUTH_SECRET` | Yes | Min 32 chars; signs sessions (server refuses to start without it) |
| `BETTER_AUTH_URL` | Yes | Public **API** origin, e.g. `http://localhost:5000` or `https://gym-managment-system-7yiu.onrender.com`. Never the Vercel frontend origin — Better Auth builds the Google callback from it. |
| `CLIENT_ORIGIN` | Yes | Comma-separated frontend origins allowed by CORS and OAuth redirects, e.g. `http://localhost:3000` or `https://client-gym-iota.vercel.app`. No trailing slash needed. |
| `PUBLIC_API_URL` | No | Explicit API origin override (custom domain). When unset, `BETTER_AUTH_URL` is used; on Render the service falls back to `RENDER_EXTERNAL_URL` if `BETTER_AUTH_URL` is local or points at a frontend origin. |
| `PORT` | No | Defaults to `5000` when unset |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For Google sign-in | From Google Cloud Console → APIs & Services → Credentials (OAuth client, Web application) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | For real OTP emails | Until set, OTPs are logged to the backend console (`[email:dev]`) instead of emailed. **Render free web services block outbound SMTP ports 25/465/587** — use a provider that supports port `2525`, upgrade the service, or send through an HTTP email API. |
| `EMAIL_SEND_TIMEOUT_MS` | No | Hard cap for one email delivery (default `12000`). Signup never waits longer than this for SMTP. |
| `SMTP_CONNECTION_TIMEOUT_MS` / `SMTP_GREETING_TIMEOUT_MS` / `SMTP_SOCKET_TIMEOUT_MS` / `SMTP_DNS_TIMEOUT_MS` | No | Fail-fast SMTP timeouts (defaults `8000` / `8000` / `15000` / `5000`). |
| `SUPER_ADMIN_EMAIL` | Bootstrap only | Email for the one-time platform-owner bootstrap. Never read by the running API. |
| `SUPER_ADMIN_PASSWORD` | Bootstrap only | New-account password, minimum 12 characters. Required when creating; ignored when promoting an existing account. |
| `SUPER_ADMIN_NAME` | Bootstrap only | Display name for a newly created platform owner (default `Platform Owner`). |
| `SUPER_ADMIN_BOOTSTRAP_SECRET` | No | Shared secret for `POST /api/v1/auth/bootstrap-super-admin`. When set, that endpoint requires a matching `x-bootstrap-secret` header. When unset, the endpoint still works in first-run mode (only while no `SUPER_ADMIN` exists). |
| `RECEIPT_PUBLIC_BASE_URL` | Recommended | Public API origin used inside receipt PDF links, e.g. `https://darkgoldgym.duckdns.org`. Falls back to `PUBLIC_API_URL`, then the request origin. |
| `RECEIPT_LINK_SECRET` | Recommended | Secret used to sign temporary public receipt links. Falls back to `BETTER_AUTH_SECRET`. |
| `RECEIPT_LINK_TTL_DAYS` | No | Lifetime of a public receipt link in days (default `7`). |
| `RECEIPT_PDF_FONT` / `RECEIPT_PDF_FONT_BOLD` | No | Absolute paths to TTF files for PDF text. Default to the bundled PDFKit fonts (which is why the PDF prints `Rs.` instead of `₹`). |
| `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_API_VERSION` | No | Enable WhatsApp Business Cloud API delivery of the receipt PDF. Server-side only; the browser never sees these values. |

### 3. Install, migrate, run

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev        # nodemon + tsx, serves on http://localhost:5000
```

Sanity check: `GET http://localhost:5000/api/v1/health` → `{ "status": "ok" }`.

### 4. Google sign-in setup (one time)

1. In Google Cloud Console, add the authorized redirect URI
   `{BETTER_AUTH_URL}/api/auth/callback/google`. Locally that is
   `http://localhost:5000/api/auth/callback/google`; in production it is the
   **API** host, for example
   `https://darkgoldgym.duckdns.org/api/auth/callback/google` (or
   `https://gym-managment-system-7yiu.onrender.com/api/auth/callback/google`).
   Do not add the Vercel URL — the static frontend has no `/api/auth` route.
   Register every API host you actually serve from: a missing entry produces
   `Error 400: redirect_uri_mismatch` ("Access blocked: This app's request is
   invalid") at Google.
2. Put the client ID/secret in `.env` and restart the backend.
3. Frontend calls `POST /api/v1/auth/google` with `callbackURL` and
   `errorCallbackURL` on its own origin, then redirects the browser to the
   returned `url`.
4. The backend completes the code exchange, sets the session cookie, and
   redirects to `callbackURL` (`/auth/callback` by default). OAuth failures
   redirect to `errorCallbackURL` with `?error=<code>`.

### 5. Create the first platform administrator (one time)

`SUPER_ADMIN` is never assignable from client input, there is no public
registration route, and `POST /auth/setup-gym` refuses platform accounts. Use the
bootstrap script with database access:

```bash
# Create a new, already-verified platform owner (password min 12 chars)
SUPER_ADMIN_EMAIL=owner@platform.com \
SUPER_ADMIN_PASSWORD='a-strong-12+-char-password' \
SUPER_ADMIN_NAME='Platform Owner' \
npm run bootstrap-super-admin

# Or promote an existing verified account without changing its password
npm run bootstrap-super-admin -- owner@platform.com
```

Environment variables can also be placed in `.env`. The script:

- never logs the password;
- creates the account with `emailVerified: true`, `gymId: null` and a normal
  Better Auth credential row, so email/password sign-in works immediately;
- refuses to promote an account that already belongs to a gym unless you pass
  `--detach-gym` after confirming it is not a gym owner;
- is the only supported way to grant platform privileges. Signing in at
  `/login` sends a `SUPER_ADMIN` to `/super-admin`.

## Super Admin API — end-to-end flow

Maximum **two** platform owner accounts. Each is created already verified (`emailVerified: true`, `gymId: null`) with a normal credential row, so no OTP email is ever needed. Every call uses only `name`, `email`, `password`.

### Step 1 — Create the first platform owner

`POST /api/v1/auth/bootstrap-super-admin` is open only while no `SUPER_ADMIN` exists. After the first successful call it answers `409 SUPER_ADMIN_ALREADY_EXISTS` and stays closed (use the CLI script for any later platform owner).

```bash
curl -X POST https://gym-managment-system-7yiu.onrender.com/api/v1/auth/bootstrap-super-admin \
  -H "Content-Type: application/json" \
  -d '{"name":"Suhel Ali","email":"sogiw19883@agaexpress.com","password":"Etrglobal@967606"}'
```

Success (`201`):
```json
{
  "message": "Existing account promoted to SUPER_ADMIN. Sign in with the password you just supplied.",
  "promoted": true,
  "user": { "id": "...", "name": "Suhel Ali", "email": "...", "role": "SUPER_ADMIN", "emailVerified": true, "gymId": null },
  "login": { "method": "POST", "path": "/api/v1/auth/super-admin/login", "body": { "email": "...", "password": "..." } }
}
```

Optional security: set `SUPER_ADMIN_BOOTSTRAP_SECRET` on Render and send `-H "x-bootstrap-secret: <value>"` on every call.

### Step 2 — Sign in as a platform owner

`POST /api/v1/auth/super-admin/login` authenticates **only** `SUPER_ADMIN` accounts and never sends an OTP:

```bash
curl -X POST https://gym-managment-system-7yiu.onrender.com/api/v1/auth/super-admin/login \
  -H "Content-Type: application/json" -c admin-cookies.txt \
  -d '{"email":"sogiw19883@agaexpress.com","password":"Etrglobal@967606"}'
```

Success (`200`) sets the session cookie and returns `user.role = "SUPER_ADMIN"` plus `"redirect": "/super-admin"`. Gym owners (`ADMIN`), staff (`RECEPTIONIST`) and unknown emails receive `401 INVALID_CREDENTIALS` and **no cookie**.

### Step 3 — Create the second (final) platform owner

`POST /api/v1/super-admin/admins` requires an existing `SUPER_ADMIN` session:

```bash
curl -X POST https://gym-managment-system-7yiu.onrender.com/api/v1/super-admin/admins \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"name":"Co Owner","email":"co-owner@platform.com","password":"another-strong-password"}'
```

Hard cap: **two** platform accounts total. At the cap → `409 SUPER_ADMIN_LIMIT_REACHED`. Refuses accounts attached to a gym (`409 ACCOUNT_BELONGS_TO_GYM`). No OTP — the new owner signs in with `POST /api/v1/auth/super-admin/login` immediately.

### Step 4 — Call platform APIs

With the cookie jar from step 2:

```bash
curl https://gym-managment-system-7yiu.onrender.com/api/v1/super-admin/stats -b admin-cookies.txt
curl https://gym-managment-system-7yiu.onrender.com/api/v1/super-admin/gyms -b admin-cookies.txt
```

Every `/api/v1/super-admin/*` request re-checks `role === "SUPER_ADMIN"` from the database; nothing is trusted from the client.

### 6. Recommended frontend integration order

1. `POST /api/v1/auth/signup` → read the OTP from the user's email (or the backend console in dev). If the response has `requiresEmailVerification: true`, the email already existed unverified and a new OTP was sent — go straight to step 2.
2. `POST /api/v1/auth/verify-email` → user is now signed in (session cookie set).
3. `GET /api/v1/auth/me` → if `user.gymId` is `null`, call `POST /api/v1/auth/setup-gym`.
4. Use the gym APIs (members, plans, memberships, attendance, expenses, reports) with `credentials: "include"`.
5. On app load, call `GET /api/v1/auth/me`: `401` → show login; `emailVerified: false` → show the OTP screen; `gymId: null` → show gym setup; otherwise → show the dashboard.

> **Note:** login and every gym-data endpoint are blocked until the email is verified (`403` + a fresh OTP is sent on login). Google sign-in skips OTP because Google verifies the email.

## Base URL and requests

Local base URL: `http://localhost:5000`

Versioned API prefix: `/api/v1`

Send JSON with `Content-Type: application/json`. Authentication uses the Better Auth session cookie; frontend requests to the API should include credentials:

```js
const response = await fetch(`${API_BASE}${path}`, {
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  ...options
});
```

Set `API_BASE` to `http://localhost:5000/api/v1`. The frontend origin must be allowed by the backend's `CLIENT_ORIGIN` CORS setting.

## Authentication

Simple cookie-session auth under `/api/v1/auth` (backed by Better Auth; raw Better Auth endpoints also remain at `/api/auth`). Always send `credentials: "include"` so the session cookie is stored and returned.

Email OTP delivery uses SMTP (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` in `.env`, via nodemailer). Until those are set, OTPs are logged to the backend console for development. Every send is bounded by `EMAIL_SEND_TIMEOUT_MS`, so an unreachable SMTP server returns `emailSent: false` instead of hanging the request. Render free web services cannot reach SMTP ports 25/465/587; use port 2525 with a provider that supports it, upgrade the Render service, or use an HTTP email API.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/signup` | Create an account (sends a 6-digit OTP to the email) |
| `POST` | `/api/v1/auth/verify-email` | Verify the OTP (also signs the user in) |
| `POST` | `/api/v1/auth/resend-otp` | Send a fresh OTP |
| `POST` | `/api/v1/auth/google` | Start Google sign-in (returns the Google URL to redirect to) |
| `POST` | `/api/v1/auth/bootstrap-super-admin` | One-time platform-owner creation/promotion; `409` once a `SUPER_ADMIN` exists |
| `POST` | `/api/v1/auth/super-admin/login` | Platform-owner sign-in (no OTP; `SUPER_ADMIN` accounts only) |
| `POST` | `/api/v1/auth/login` | Sign in with email and password (requires a verified email) |
| `POST` | `/api/v1/auth/logout` | Sign out (clears the session cookie) |
| `GET` | `/api/v1/auth/me` | Current user + gym info (`401` when signed out) |
| `POST` | `/api/v1/auth/setup-gym` | Create the user's gym (once per account) |
| `POST` | `/api/v1/auth/forgot-password` | Email a reset link (`method: "link"`) or 6-digit code (`method: "otp"`) |
| `GET` | `/api/v1/auth/reset-password/verify` | Check whether a link token is still valid |
| `POST` | `/api/v1/auth/reset-password` | Reset with a link token or an email OTP |

### `POST /api/v1/auth/signup`

```json
{
  "name": "Aarav Patel",
  "email": "owner@example.com",
  "phone": "+919876543210",
  "password": "password123"
}
```

- `name` 2–100 chars, valid `email`, valid mobile `phone`, `password` 8–128 chars.
- Success (`201`) returns `{ "message", "emailSent": true, "user": { "id", "name", "email", ... } }`. No session cookie yet — a 6-digit OTP is emailed and must be verified first.
- If the account is created but the OTP email cannot be delivered (SMTP down/blocked), the response is still `201` with `"emailSent": false`. Send the user to the verify-email screen and surface the Resend button; resend will report the delivery failure.
- **Already registered and verified:** `409` with `{ "code": "EMAIL_ALREADY_REGISTERED", "error": "An account with this email already exists" }`. The client should offer sign-in.
- **Already registered but not verified:** `200` with
  `{ "code": "EMAIL_NOT_VERIFIED", "requiresEmailVerification": true, "email", "emailSent", "message" }`.
  The backend re-sends a fresh OTP; the client must continue on the verify-email screen. No duplicate account is created.
- Unverified accounts still holding a session are rejected by every protected API with
  `403 { "code": "EMAIL_NOT_VERIFIED", "error": "Email not verified. Verify your email to continue." }`.

```bash
curl -X POST http://localhost:5000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"name":"Aarav Patel","email":"owner@example.com","phone":"+919876543210","password":"password123"}'
```

```js
const res = await fetch(`${API_BASE}/auth/signup`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Aarav Patel",
    email: "owner@example.com",
    phone: "+919876543210",
    password: "password123"
  })
});
const result = await res.json();
if (result.requiresEmailVerification) {
  // Existing unverified account: show the OTP screen for result.email.
}
```

### `POST /api/v1/auth/verify-email`

```json
{
  "email": "owner@example.com",
  "otp": "482916"
}
```

- `otp` is the 6-digit code from the email (expires after 5 minutes, 3 attempts per code).
- Success (`200`) returns `{ "status": true, "token", "user": ... }` **and sets the session cookie** — the user is signed in, proceed to `setup-gym` (or the app if `gymId` is set).
- Wrong code returns `400`; expired code returns `400` with `{ "error": "Code expired. Request a new one." }`; too many attempts returns `403`.

```bash
curl -X POST http://localhost:5000/api/v1/auth/verify-email \
  -H "Content-Type: application/json" \
  -c cookies.txt -b cookies.txt \
  -d '{"email":"owner@example.com","otp":"482916"}'
```

### `POST /api/v1/auth/resend-otp`

```json
{
  "email": "owner@example.com"
}
```

- Sends a fresh code (invalidates the previous one). Returns `200` with a generic message so accounts can't be enumerated. If the code was generated but the email could not be delivered, returns `502 { "error": "Could not send the verification code right now. Please try again in a moment." }` so the UI can show the real problem.

### `POST /api/v1/auth/google`

```json
{
  "callbackURL": "http://localhost:3000/auth/callback",
  "errorCallbackURL": "http://localhost:3000/auth/callback"
}
```

- Both URLs are optional and must belong to an allowed `CLIENT_ORIGIN`.
  `callbackURL` defaults to the first client origin plus `/auth/callback`;
  `errorCallbackURL` defaults to the callback's origin plus `/auth/callback`.
- Success (`200`) returns `{ "url": "https://accounts.google.com/...", "redirect": ... }`. Redirect the browser to `url`:

```js
const res = await fetch(`${API_BASE}/auth/google`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    callbackURL: `${window.location.origin}/auth/callback`,
    errorCallbackURL: `${window.location.origin}/auth/callback`
  })
});
const { url } = await res.json();
window.location.href = url; // Google consent -> back to callbackURL with a session
```

- On OAuth failure the backend redirects to
  `errorCallbackURL?error=<code>` instead of Better Auth's error page on the
  API host. Failures that happen before the state is available (for example a
  blocked state cookie) go to the first `CLIENT_ORIGIN`'s `/auth/callback`
  through `onAPIError.errorURL`. The frontend callback page maps known codes to
  readable messages.
- Google verifies the email itself, so Google users skip the OTP step.
- Google Cloud Console must list the **API** callback:
  `{BETTER_AUTH_URL}/api/auth/callback/google`. Locally:
  `http://localhost:5000/api/auth/callback/google`. Production:
  `https://darkgoldgym.duckdns.org/api/auth/callback/google` (and
  `https://gym-managment-system-7yiu.onrender.com/api/auth/callback/google`
  if that host is still served). The backend logs this exact URI on startup.
- The Vercel frontend and Render API are different sites. The backend sets
  `SameSite=None; Secure` cookies automatically for that layout; see
  `DEPLOYMENT.md` for browser third-party-cookie caveats.

### `POST /api/v1/auth/bootstrap-super-admin`

One-time creation (or promotion) of the platform owner. This is the HTTP
equivalent of `npm run bootstrap-super-admin`; it is **not** a general
registration route and stops working once a `SUPER_ADMIN` exists.

```json
{
  "name": "Platform Owner",
  "email": "owner@platform.com",
  "password": "a-strong-12+-char-password"
}
```

- `name` 2–100 characters, `email` must be valid, `password` 12–128 characters.
  Any `role` field is ignored — the account is always `SUPER_ADMIN`.
- Success (`201`):
  ```json
  {
    "message": "Platform administrator created. Sign in with the password you supplied.",
    "promoted": false,
    "user": {
      "id": "...",
      "name": "Platform Owner",
      "email": "owner@platform.com",
      "role": "SUPER_ADMIN",
      "emailVerified": true,
      "gymId": null
    },
    "login": { "method": "POST", "path": "/api/v1/auth/super-admin/login", "body": { "...": "..." } }
  }
  ```
  The account is created already verified with `gymId: null`, so no OTP email is
  needed and `POST /api/v1/auth/login` works immediately. There is no separate
  login change: login already returns `role`, and the client routes
  `SUPER_ADMIN` to `/super-admin`.
- If the email already exists and belongs to no gym, that account is promoted:
  `role` becomes `SUPER_ADMIN`, `emailVerified` becomes `true`, the name is
  updated and the password is set to the one supplied (`promoted: true`).
- `409 SUPER_ADMIN_ALREADY_EXISTS` — a platform administrator already exists.
  Use the CLI script for additional platform owners.
- `409 ACCOUNT_BELONGS_TO_GYM` — the email is already a gym user. Platform
  administrators must be separate accounts.
- `401 BOOTSTRAP_SECRET_REQUIRED` — `SUPER_ADMIN_BOOTSTRAP_SECRET` is set and the
  `x-bootstrap-secret` header is missing or wrong. When the variable is unset the
  endpoint runs in first-run mode, still limited to the "no `SUPER_ADMIN` yet"
  window.
- Limited to 5 attempts per 15 minutes per IP (`429 RATE_LIMITED`).

```bash
curl -X POST http://localhost:5000/api/v1/auth/bootstrap-super-admin \
  -H "Content-Type: application/json" \
  -d '{"name":"Platform Owner","email":"owner@platform.com","password":"a-strong-12+-char-password"}'

# Then use the platform-owner login (no OTP):

```bash
curl -X POST http://localhost:5000/api/v1/auth/super-admin/login \
  -H "Content-Type: application/json" -c admin-cookies.txt \
  -d '{"email":"owner@platform.com","password":"a-strong-12+-char-password"}'

curl http://localhost:5000/api/v1/auth/me -b admin-cookies.txt
```

```

### `POST /api/v1/auth/super-admin/login`

Platform-owner sign-in. Same `User`/`Account` rows and the same password check
as `POST /auth/login`, with two differences:

- only accounts whose database `role` is `SUPER_ADMIN` can obtain a session.
  Gym owners (`ADMIN`), staff (`RECEPTIONIST`) and unknown emails all get
  `401 { "error": "Invalid email or password", "code": "INVALID_CREDENTIALS" }`
  and **no session cookie is set**;
- it never generates or sends an OTP, so it works even when SMTP is blocked.

```json
{ "email": "owner@platform.com", "password": "a-strong-12+-char-password" }
```

Optional `rememberMe` boolean (defaults to `true`).

Success (`200`) sets the session cookie and returns the Better Auth payload plus
the resolved user and console path:

```json
{
  "token": "...",
  "user": {
    "id": "...",
    "name": "Platform Owner",
    "email": "owner@platform.com",
    "role": "SUPER_ADMIN",
    "emailVerified": true,
    "gymId": null
  },
  "redirect": "/super-admin"
}
```

- `400 VALIDATION_FAILED` — missing/invalid email or password.
- `401 INVALID_CREDENTIALS` — wrong password, unknown email, or a non-platform
  account.
- `429 RATE_LIMITED` — 10 attempts per 15 minutes per IP.

```bash
curl -X POST http://localhost:5000/api/v1/auth/super-admin/login \
  -H "Content-Type: application/json" \
  -c admin-cookies.txt \
  -d '{"email":"owner@platform.com","password":"a-strong-12+-char-password"}'

curl http://localhost:5000/api/v1/auth/me -b admin-cookies.txt
```

### `POST /api/v1/auth/login`

```json
{
  "email": "owner@example.com",
  "password": "password123"
}
```

- Optional `rememberMe` boolean (defaults to `true`).
- Success (`200`) returns the session payload and sets the cookie; wrong credentials return `401` with `{ "error": "Invalid email or password" }`.
- Unverified email returns `403` with
  `{ "code": "EMAIL_NOT_VERIFIED", "error": "Email not verified. A new 6-digit code was sent to your email.", "emailSent": true }`.
  A fresh OTP is sent automatically; redirect the user to `/verify-email?email=...&reason=login`. When `emailSent` is `false`, tell the user to use Resend on that screen.

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt -b cookies.txt \
  -d '{"email":"owner@example.com","password":"password123"}'
```

### `POST /api/v1/auth/logout`

No body. Clears the session cookie. Send the cookie jar (`-b cookies.txt` / `credentials: "include"`).

### `GET /api/v1/auth/me`

```json
{
  "data": {
    "user": {
      "id": "...",
      "name": "...",
      "email": "...",
      "emailVerified": true,
      "gymId": null,
      "role": "ADMIN"
    },
    "session": { "...": "..." }
  }
}
```

- `401` when there is no session. `gymId: null` means the user still needs `setup-gym`.
- `emailVerified: false` means the client must send the user to the verify-email (OTP) screen.
  That session can call `/auth/me` but every gym-data endpoint will reject it with
  `403 { "code": "EMAIL_NOT_VERIFIED" }` until verification completes.

After signing in, create a gym:

### `POST /api/v1/auth/setup-gym`

Requires an authenticated **and verified** session. Unverified accounts receive
`403 { "code": "EMAIL_NOT_VERIFIED" }`; a user who already belongs to a gym receives `409`.

```json
{
  "name": "Downtown Fitness",
  "phone": "+1 555 0100",
  "email": "hello@example.com"
}
```

`name` is required (2–120 characters); `phone` and `email` are optional.

Success (`201`):

```json
{
  "data": {
    "id": "gym-id",
    "name": "Downtown Fitness",
    "phone": "+1 555 0100"
  },
  "message": "Gym created. You can now use the gym management APIs."
}
```

### `POST /api/v1/auth/forgot-password`

Starts a password reset. The response is always neutral, so the endpoint cannot be
used to discover which emails have accounts.

```json
{
  "email": "owner@example.com",
  "method": "link"
}
```

- `email` — required, valid email address.
- `method` — `"link"` (default) emails a reset URL; `"otp"` emails a 6-digit code.
- Success (`200`): `{ "message": "...", "method": "link" }` (or `"otp"`).
- `400` for an invalid email address.
- The reset link points at the frontend origin of the requesting app (when that
  origin is in `CLIENT_ORIGIN`), falling back to the first configured origin.
- Links expire in 1 hour; codes expire in 5 minutes and allow 3 attempts.

### `GET /api/v1/auth/reset-password/verify`

Checks a link token before the reset form is shown.

```
GET /api/v1/auth/reset-password/verify?token=<token>
```

- `200` `{ "valid": true, "expiresAt": "..." }` when the token is usable.
- `400` `{ "code": "INVALID_TOKEN", "error": "..." }` when it is missing, used or expired.

### `POST /api/v1/auth/reset-password`

Completes the reset. Send one of the two shapes below.

Link flow:

```json
{ "token": "reset-token", "newPassword": "new-password-123" }
```

Code flow:

```json
{
  "method": "otp",
  "email": "owner@example.com",
  "otp": "123456",
  "newPassword": "new-password-123"
}
```

- `newPassword` is required, 8–128 characters.
- Success (`200`): `{ "message": "Password updated. Sign in with your new password." }`.
- Errors include `INVALID_TOKEN` (link used/expired), `OTP_EXPIRED`,
  `INVALID_OTP` and `TOO_MANY_ATTEMPTS`.

## Health

### `GET /api/v1/health`

Does not require authentication.

```json
{ "status": "ok" }
```
# Add Member API

Creates a new member inside the logged-in user's gym.

## Endpoint

```
POST /api/v1/members
```

## Authentication

Requires a Better Auth session cookie (`credentials: "include"`). The `gymId`
comes from the authenticated user, never from the body.

## Headers

| Header         | Value              |
| -------------- | ------------------ |
| `Content-Type` | `application/json` |

## Request Body

| Field              | Type           | Required | Rules |
| ------------------ | -------------- | -------- | ----- |
| `name`             | string         | **Yes**  | 1-100 chars, trimmed |
| `phone`            | string         | **Yes**  | 7-20 chars, trimmed |
| `gender`           | string         | **Yes**  | 1-40 chars, e.g. `male`, `female`, `other`, `prefer-not-to-say` |
| `dateOfBirth`      | date string    | **Yes**  | ISO date, not in the future, e.g. `1998-04-21` |
| `memberCode`       | string         | No       | 1-50 chars, unique within the gym. Auto-generated (`MEM-0001`) when omitted |
| `email`            | string         | No       | Valid email, max 191 chars |
| `address`          | string or null | No       | Max 500 chars |
| `emergencyContact` | string or null | No       | Max 120 chars |
| `emergencyPhone`   | string or null | No       | Max 30 chars |
| `joinedAt`         | date string    | No       | ISO date; defaults to now |
| `timing`           | enum `Timing`  | **Yes**  | `MORNING`, `AFTERNOON` or `EVENING` (batch timing) |
| `notes`            | string or null | No       | Max 2000 chars |

### Example body

```json
{
  "name": "Rahul Sharma",
  "phone": "9876543210",
  "gender": "male",
  "dateOfBirth": "1998-04-21",
  "email": "rahul@example.com",
  "joinedAt": "2026-10-13",
  "timing": "MORNING",
  "notes": "Prefers trainer in the morning batch"
}
```

Minimal body (only the five required fields):

```json
{
  "name": "Aman Verma",
  "phone": "9123456780",
  "gender": "male",
  "dateOfBirth": "2000-01-15",
  "timing": "MORNING"
}
```

## Responses

### 201 Created

```json
{
  "data": {
    "id": "cm2abc123xyz",
    "gymId": "cm1gym456",
    "memberCode": "MEM-0001",
    "name": "Rahul Sharma",
    "phone": "9876543210",
    "email": "rahul@example.com",
    "dateOfBirth": "1998-04-21T00:00:00.000Z",
    "gender": "male",
    "address": null,
    "emergencyContact": null,
    "emergencyPhone": null,
    "joinedAt": "2026-10-13T00:00:00.000Z",
    "timing": "MORNING",
    "notes": null,
    "archivedAt": null,
    "createdAt": "2026-10-13T08:15:22.000Z",
    "updatedAt": "2026-10-13T08:15:22.000Z"
  }
}
```

### 400 Bad Request (validation failed)

The response names the first failing field so the client can show it inline:

```json
{
  "error": "Gender is required",
  "field": "gender",
  "details": [{ "field": "gender", "message": "Gender is required" }]
}
```

### 401 Unauthorized

Missing or expired session (`authenticate` middleware).

### 409 Conflict (duplicate member code)

A member with the same `memberCode` already exists in this gym.

```json
{ "error": "A member with this member code already exists" }
```

Archived members still hold their `memberCode`, so reusing a code from an
archived member also returns `409`.

## Related Endpoints

| Method   | Path                    | Purpose |
| -------- | ----------------------- | ------- |
| `GET`    | `/api/v1/members`       | List members (`from`, `to`, `search`, `includeArchived` query params) |
| `PATCH`  | `/api/v1/members/:id`   | Update a member (partial body allowed) |
| `DELETE` | `/api/v1/members/:id`   | Archive a member (soft delete) |

## Quick Checklist

- Send the session cookie (`credentials: "include"`)
- Include `name`, `phone`, `gender`, `dateOfBirth` and `timing`
- Omit `memberCode` to let the server generate a unique one
- Do not send `gymId`
- Read the created member from `response.data`

## Membership plans

All plan routes require an authenticated user with a gym.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/plans` | List active plans |
| `POST` | `/api/v1/plans` | Create a plan |
| `PATCH` | `/api/v1/plans/:id` | Update a plan |
| `DELETE` | `/api/v1/plans/:id` | Deactivate a plan |

Create body:

```json
{
  "name": "Monthly",
  "pricePaise": 250000,
  "durationMonths": 1,
  "isActive": true
}
```

`name` must be 2–120 characters, `pricePaise` a non-negative integer, `durationMonths` an integer from 1 to 60, and `isActive` an optional boolean. `PATCH` accepts any subset of these fields. List/create/update responses use `{ "data": ... }`; create returns `201`. Deactivation returns `{ "message": "Plan deactivated" }`.

## Memberships

All membership routes require an authenticated user with a gym.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/memberships` | List memberships; optional `?status=ACTIVE` |
| `POST` | `/api/v1/memberships` | Create a membership |
| `POST` | `/api/v1/memberships/:id/freeze` | Freeze an active membership |
| `POST` | `/api/v1/memberships/:id/cancel` | Cancel an active or frozen membership |

The list status filter recognizes `ACTIVE`, `EXPIRED`, `FROZEN`, and `CANCELLED`. Each result includes its member, plan, and `effectiveStatus`.

Create body:

```json
{
  "memberId": "member-id",
  "planId": "plan-id",
  "startDate": "2026-10-10T00:00:00.000Z",
  "discountPaise": 0
}
```

`startDate` and `discountPaise` are required. Use `0` when there is no discount. The end date is derived from the selected plan's duration. A successful create returns `201` and `{ "data": ... }`. Freeze and cancel return a message; missing/ineligible records return `404`.

## Attendance

> **Path spelling:** the router is mounted as `/api/v1/attendence` (with an `e`), matching `src/app.js`. Use that exact spelling in requests.

All attendance routes require an authenticated session with a gym (`requireAuth`). Send requests with `credentials: "include"`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/attendence/members/search?q=<text>` | Search gym members by name, phone, or member code |
| `POST` | `/api/v1/attendence/check-in` | Check a member in (one open session per member) |
| `POST` | `/api/v1/attendence/check-out` | Close the member's open session |
| `GET` | `/api/v1/attendence/open/:memberId` | Get the member's open session (`null` if none) |
| `GET` | `/api/v1/attendence/members/:memberId/history?page=1&limit=20` | Paginated attendance history, newest first |
| `GET` | `/api/v1/attendence/summary/today` | Today's counts for the gym |

### Search members for check-in

### `GET /api/v1/attendence/members/search?q=rah`

- `q` shorter than 2 characters returns `{ "data": [] }` without querying.
- Searches `name`, `phone`, and `memberCode` within the logged-in user's gym (max 20 results, ordered by name).
- Returns `{ "id", "memberCode", "name", "phone" }` per member.

```bash
curl "http://localhost:5000/api/v1/attendence/members/search?q=rah" \
  -b cookies.txt
```

```js
const res = await fetch(
  `${API_BASE}/attendence/members/search?q=rah`,
  { credentials: "include" }
);
const { data } = await res.json(); // member list
```

### Check in

### `POST /api/v1/attendence/check-in`

```json
{
  "memberId": "member-id",
  "attendanceDate": "2026-10-14",
  "notes": "Morning batch",
  "markingMethod": "MANUAL"
}
```

- `memberId` is required and must belong to your gym (archived members are rejected with `404`).
- `attendanceDate` is required in `YYYY-MM-DD` format and must be a real calendar date.
- `notes` is optional, trimmed, max 500 chars.
- `markingMethod` is optional: `MANUAL` (default), `QR_CODE`, or `BIOMETRIC`.
- Success returns `201`:

```json
{
  "data": {
    "id": "attendance-id",
    "memberId": "member-id",
    "attendanceDate": "2026-10-14T00:00:00.000Z",
    "checkInAt": "2026-10-14T06:30:00.000Z",
    "checkOutAt": null,
    "markingMethod": "MANUAL"
  },
  "message": "Member checked in successfully"
}
```

- Fails with `409` if the member already has an open session (`checkOutAt: null`).

```bash
curl -X POST http://localhost:5000/api/v1/attendence/check-in \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"memberId":"member-id","attendanceDate":"2026-10-14"}'
```

### Check out

### `POST /api/v1/attendence/check-out`

```json
{
  "memberId": "member-id",
  "notes": "Left early"
}
```

- Only `memberId` is required; `notes` is optional (max 500 chars).
- Closes the member's latest open session and returns it with `checkOutAt` set.
- Fails with `409` when there is no open session.

```bash
curl -X POST http://localhost:5000/api/v1/attendence/check-out \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"memberId":"member-id"}'
```

### Typical reception flow

```js
// 1. Find the member
const { data: members } = await (
  await fetch(`${API_BASE}/attendence/members/search?q=98765`, { credentials: "include" })
).json();

// 2. Check whether they are already inside
const { data: open } = await (
  await fetch(`${API_BASE}/attendence/open/${members[0].id}`, { credentials: "include" })
).json();

// 3. Check in or out
const action = open ? "check-out" : "check-in";
const body = open
  ? { memberId: members[0].id }
  : { memberId: members[0].id, attendanceDate: new Date().toISOString().slice(0, 10) };
await fetch(`${API_BASE}/attendence/${action}`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
```

### Open session

### `GET /api/v1/attendence/open/:memberId`

Returns `{ "data": <attendance | null> }`. Use it to decide whether the button should say "Check in" or "Check out".

### Member history

### `GET /api/v1/attendence/members/:memberId/history?page=1&limit=20`

- `page` defaults to `1`, `limit` defaults to `20` (max `100`).
- Success shape:

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

### Today's summary

### `GET /api/v1/attendence/summary/today`

```json
{
  "data": {
    "totalCheckIns": 0,
    "currentlyCheckedIn": 0,
    "completedSessions": 0
  }
}
```

Counts are scoped to the gym and the current UTC day.

### Attendance errors

| Status | Meaning |
|---|---|
| `400` | Validation failed (`attendanceDate` wrong format/invalid date, missing `memberId`, `notes` too long, bad `markingMethod`/`page`/`limit`) |
| `401` | Missing session |
| `403` | Session has no gym |
| `404` | Member not found in your gym |
| `409` | Already checked in, no open session to close, or concurrent conflicting operation |

## Expenses

All expense routes require an authenticated user with a gym. Creating is allowed for staff; `PATCH` and `DELETE` are owner-only (`ADMIN`), so a `RECEPTIONIST` gets `403`.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/expenses` | List expenses; optional `?from=YYYY-MM-DD&to=YYYY-MM-DD` |
| `POST` | `/api/v1/expenses` | Create an expense |
| `PATCH` | `/api/v1/expenses/:id` | Update an expense |
| `DELETE` | `/api/v1/expenses/:id` | Delete an expense |

The current request validator accepts these fields:

```json
{
  "title": "Equipment repair",
  "category": "Maintenance",
  "amountPaise": 50000,
  "expenseDate": "2026-10-10T00:00:00.000Z",
  "notes": "Treadmill service"
}
```

`title`, `category` and `amountPaise` are required; `amountPaise` must be a non-negative integer (minor units). `expenseDate` and `notes` are optional. `PATCH` accepts a partial body. Successful list/create/update responses use `{ "data": ... }` with `title`, `category`, `amountPaise`, `expenseDate`, `notes` and `createdAt`; create returns `201`; delete returns `{ "message": "Expense deleted" }`.

## Staff and receptionists

A gym owner (`ADMIN`) can create login accounts for reception staff. Staff accounts are stored with `role: "RECEPTIONIST"` and the owner's `gymId`, so they can only ever see that gym's data. Staff sign in with the normal login endpoint and use the same dashboard routes as the owner, minus every update/delete operation.

| Method | Path | Who | Description |
|---|---|---|---|
| `POST` | `/api/v1/staff/receptionists` | Owner (`ADMIN`) only | Create a staff login |
| `GET` | `/api/v1/staff/receptionists` | Owner (`ADMIN`) only | List staff in your gym |
| `DELETE` | `/api/v1/staff/receptionists/:id` | Owner (`ADMIN`) only | Remove a staff account |

All three routes need an authenticated session with a gym (`credentials: "include"`). A `RECEPTIONIST` calling them gets `403`; the guard is `requirePermission(PERMISSION.MANAGE_STAFF)` in `src/routes/staff.route.js`.

### `POST /api/v1/staff/receptionists`

Create the account, then the staff member logs in with `POST /api/v1/auth/login` like anyone else. No OTP step — the account is created already verified and can sign in immediately.

```json
{
  "name": "Front Desk",
  "email": "desk@example.com",
  "password": "password123",
  "phone": "9876543210"
}
```

- `name` 2–100 chars, valid `email`, `password` 8–128 chars, `phone` optional (10–16 digits).
- `gymId` is taken from the owner's session and cannot be supplied in the body.
- Success (`201`):

```json
{
  "message": "Receptionist account created. They can now log in.",
  "data": {
    "id": "user-id",
    "name": "Front Desk",
    "email": "desk@example.com",
    "phone": "9876543210",
    "role": "RECEPTIONIST",
    "gymId": "gym-id",
    "createdAt": "2026-10-16T00:00:00.000Z"
  }
}
```

- Duplicate email/phone returns `409`.
- Non-owner callers get `403`.
- The password hash is never returned, and the staff account's session cookie is not forwarded to the owner.

### Staff login

Staff use the same endpoint and cookie flow as owners. The session response includes the role, and `GET /api/v1/auth/me` returns it too, so the frontend can hide write actions for `RECEPTIONIST`.

```http
POST /api/v1/auth/login
Content-Type: application/json
```

```json
{
  "email": "desk@example.com",
  "password": "password123"
}
```

Success (`200`) sets the session cookie and returns the Better Auth session:

```json
{
  "token": "session-token",
  "user": {
    "id": "user-id",
    "name": "Front Desk",
    "email": "desk@example.com",
    "role": "RECEPTIONIST",
    "gymId": "gym-id",
    "emailVerified": true
  }
}
```

Invalid credentials return `401` with `{ "error": "Invalid email or password" }`.

```bash
# 1. Owner creates the staff account (owner cookies)
curl -X POST http://localhost:5000/api/v1/staff/receptionists \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"name":"Front Desk","email":"desk@example.com","password":"password123"}'

# 2. Staff logs in (own cookie jar)
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -c desk-cookies.txt \
  -d '{"email":"desk@example.com","password":"password123"}'

# 3. Staff daily work: allowed (GET + POST)
curl http://localhost:5000/api/v1/members -b desk-cookies.txt
curl -X POST http://localhost:5000/api/v1/attendence/check-in \
  -H "Content-Type: application/json" \
  -b desk-cookies.txt \
  -d '{"memberId":"member-id","attendanceDate":"2026-10-16"}'

# 4. Blocked for staff (403)
curl -X PATCH http://localhost:5000/api/v1/members/some-id \
  -H "Content-Type: application/json" \
  -b desk-cookies.txt \
  -d '{"phone":"9999999999"}'
```

```js
// Owner creates a staff account
const res = await fetch(`${API_BASE}/staff/receptionists`, {
  method: "POST",
  credentials: "include", // owner session
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Front Desk", email: "desk@example.com", password: "password123" })
});
const { data } = await res.json(); // data.role === "RECEPTIONIST"
```

### `GET /api/v1/staff/receptionists`

Returns `{ "data": [...] }` with `{ id, name, email, phone, role, gymId, createdAt }` per staff member, newest first. The query is scoped to `req.user.gymId`, so it never returns another gym's users.

### `DELETE /api/v1/staff/receptionists/:id`

Removes a `RECEPTIONIST` from the owner's gym. Returns `{ "message": "Receptionist removed" }`. Admins cannot delete themselves or other admins (`400`/`403`); unknown ids, or ids belonging to another gym, return `404`.

## Schedule Call API

Scheduled-call routes are mounted at `/api/v1/schedule` in `src/app.js`:

```js
app.use("/api/v1/schedule", scheduleCallRoutes)
```

| Method | Path | Handler | Auth | Description |
|---|---|---|---|---|
| `POST` | `/api/v1/schedule/` | `AddCall` | none | Create a new scheduled call (request body required) |
| `GET` | `/api/v1/schedule/` | `GetAllCall` | `authenticate` + `requireSuperAdmin` | List all scheduled calls |
| `PATCH` | `/api/v1/schedule/:id` | `PatchCall` | `authenticate` + `requireSuperAdmin` | Update a scheduled call by ID |
| `DELETE` | `/api/v1/schedule/:id` | `DeleteCall` | `authenticate` + `requireSuperAdmin` | Delete a scheduled call by ID |

> **IP address:** the create endpoint never accepts `ipAddress` from the client. The server resolves it from the connection (respecting the one trusted proxy hop configured with `app.set("trust proxy", 1)`) and stores that value. The same detected address is used for the 24-hour rate limit, so a forged body cannot bypass it.


### Create a scheduled call

#### `POST /api/v1/schedule/`

Handler: `AddCall` (`src/controllers/schedule.call.controller.js`). No session is required.

Request body:

| Field | Type | Required | Rules |
|---|---|---|---|
| `clientName` | string | Yes | Trimmed, 1–40 characters |
| `mob` | string | Yes | Trimmed; 10–13 digits with an optional leading `+` (max 13 characters) |
| `callTime` | string | Yes | Valid ISO 8601 date-time in the future (`Date.parse` must succeed) |
| `note` | string or null | No | Max 50 characters; omitted, `null` and `""` are stored as `null` |
| `ipAddress` | — | No | **Do not send.** The server determines and stores the client IP. |

Rate limit: at most **one scheduled call per detected client IP per 24 hours**. A recent call for the same IP returns `429`:

```json
{
  "success": false,
  "message": "Only one call can be scheduled per IP every 24 hours.",
  "nextAllowedAt": "2026-10-28T10:00:00.000Z"
}
```

Example body:

```json
{
  "clientName": "Rahul Sharma",
  "mob": "9876543210",
  "callTime": "2026-10-27T10:00:00.000Z",
  "note": "Interested in morning batch"
}
```

Success (`201`):

```json
{
  "success": true,
  "message": "Call scheduled successfully",
  "data": {
    "id": 1,
    "clientName": "Rahul Sharma",
    "Mob": "9876543210",
    "callTime": "2026-10-27T10:00:00.000Z",
    "note": "Interested in morning batch",
    "ipAddress": "127.0.0.1",
    "createdAt": "2026-10-27T09:30:00.000Z"
  }
}
```

Errors: `400` (missing/invalid `clientName`, `mob`, `callTime`, `note`, or `callTime` in the past), `429` (rate limit), `500` (server error).

```bash
curl -X POST http://localhost:5000/api/v1/schedule/ \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Rahul Sharma","mob":"9876543210","callTime":"2026-10-27T10:00:00.000Z","note":"Interested in morning batch"}'
```

```js
const res = await fetch(`${API_BASE}/schedule/`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientName: "Rahul Sharma",
    mob: "9876543210",
    callTime: "2026-10-27T10:00:00.000Z",
    note: "Interested in morning batch"
    // ipAddress is intentionally omitted — the server records it.
  })
});
const result = await res.json(); // result.data is the created call
```

### List all scheduled calls

#### `GET /api/v1/schedule/`

Handler: `GetAllCall`. Returns every scheduled call, newest first.

Requires an authenticated `SUPER_ADMIN` session (`authenticate` + `requireSuperAdmin`).

Optional query parameters (used by the Super Admin console):

| Query | Type | Description |
|---|---|---|
| `q` | string | Case-insensitive match on customer name, mobile, IP address or note. A numeric value also matches the call `id`. |
| `status` | `upcoming` \| `today` \| `past` | Derived from `callTime` in whole calendar days: `today` is any time on the current day, `past` is any earlier day, `upcoming` is any later day. |
| `page` | integer ≥ 1 | Page number. Defaults to `1` when paginating. |
| `limit` | integer 1–100 | Rows per page. Defaults to `20` when paginating. |

When none of these parameters are supplied, the response keeps the original shape: every row with `count` equal to the array length.

When at least one is supplied, `data` contains the requested page and the response adds `pagination` and `filters`:

```json
{
  "success": true,
  "message": "All call details fetch sucessfully!",
  "count": 42,
  "data": [
    {
      "id": 3,
      "clientName": "Rahul Sharma",
      "Mob": "9876543210",
      "callTime": "2026-10-27T10:00:00.000Z",
      "note": "Interested in morning batch",
      "ipAddress": "127.0.0.1",
      "createdAt": "2026-10-27T09:30:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 },
  "filters": { "q": "rahul", "status": "upcoming" }
}
```

Use an admin cookie jar:

```bash
curl http://localhost:5000/api/v1/schedule/ \
  -b admin-cookies.txt
```

Success (`200`):

```json
{
  "success": true,
  "message": "All call details fetch sucessfully!",
  "count": 3,
  "data": [
    {
      "id": 3,
      "clientName": "Rahul Sharma",
      "Mob": "9876543210",
      "callTime": "2026-10-27T10:00:00.000Z",
      "note": "...",
      "ipAddress": "127.0.0.1",
      "createdAt": "2026-10-27T10:00:00.000Z"
    }
  ]
}
```

Errors: `401` (no session), `403 SUPER_ADMIN_REQUIRED`, `500`.

```js
const res = await fetch(`${API_BASE}/schedule/`, {
  method: "GET",
  credentials: "include",
  headers: { "Content-Type": "application/json" }
});
const { count, data } = await res.json();
```

### Update a scheduled call

#### `PATCH /api/v1/schedule/:id`

Handler: `PatchCall`. Requires an authenticated `SUPER_ADMIN` session (`authenticate` + `requireSuperAdmin`).

The controller reads the target call id from `req.params.id`, so address a specific call:

```bash
curl -X PATCH http://localhost:5000/api/v1/schedule/3 \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"clientName":"Rahul Sharma","note":"Updated note"}'
```

Request body (partial — at least one field is required):

| Field | Type | Rules |
|---|---|---|
| `clientName` | string | Trimmed, 1–100 characters |
| `callTime` | string | Parseable date |
| `note` | string or null | Max 50 characters; `null` clears it |

Success (`200`):

```json
{
  "success": true,
  "message": "Scheduled call updated successfully",
  "data": { "id": 3, "clientName": "Rahul Sharma", ... }
}
```

Errors: `400` (invalid id, no fields to update, or invalid field value), `404` ("Scheduled call not found"), `500`.

```js
const res = await fetch(`${API_BASE}/schedule/3`, {
  method: "PATCH",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ clientName: "Rahul Sharma", note: "Updated note" })
});
```

### Delete a scheduled call

#### `DELETE /api/v1/schedule/:id`

Handler: `DeleteCall`. Requires an authenticated `SUPER_ADMIN` session (`authenticate` + `requireSuperAdmin`).

```bash
curl -X DELETE http://localhost:5000/api/v1/schedule/3 \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt
```

Success (`200`):

```json
{
  "success": true,
  "message": "Scheduled call deleted successfully"
}
```

Errors: `400` (invalid id), `404` ("Scheduled call not found"), `500`.

```js
const res = await fetch(`${API_BASE}/schedule/3`, {
  method: "DELETE",
  credentials: "include",
  headers: { "Content-Type": "application/json" }
});
```

### Errors

| Status | Meaning |
|---|---|
| `400` | Validation failed (missing/invalid `clientName`, `mob`, `callTime`, `note`, or call id) |
| `401` | Authentication required (`authenticate` middleware) |
| `403` | `SUPER_ADMIN_REQUIRED` — caller is not a platform admin |
| `404` | Scheduled call not found |
| `429` | One call per IP per 24 hours (create endpoint) |
| `500` | Server error |

## Role permissions

| Capability | `ADMIN` (owner) | `RECEPTIONIST` (staff) |
|---|---|---|
| `GET` any gym data (members, plans, attendance, payments, expenses, reports) | Yes | Yes |
| `POST` create records (add member, create payment, membership, expense, plan, check-in/out) | Yes | Yes |
| `PATCH` / `PUT` edit an existing record | Yes | No — `403` |
| `DELETE` (archive member, deactivate plan, delete expense) | Yes | No — `403` |
| Freeze / cancel a membership (`POST /memberships/:id/*` changes an existing row) | Yes | No — `403` |
| Manage staff (`/api/v1/staff/*`) | Yes | No — `403` |
| Manage billing (`/subscription/trial`, `/checkout`, `/verify`, `/cancel`, `/history`) | Yes | No — `403` |
| Read subscription status (`GET /subscription/me`) | Yes | Yes |

> **Attendance check-out note:** `POST /attendence/check-out` closes the session that check-in opened. It is treated as part of the attendance workflow (like check-in) rather than a general record edit. Staff still cannot `PATCH`/`DELETE` attendance rows, and every other update/delete on members, plans, memberships, payments, expenses, and staff accounts is owner-only.

The rules live in `src/middleware/permissions.js`:

- `ROLE_PERMISSIONS` maps each role to `records:read`, `records:create`, `records:update`, `records:delete`, `staff:manage`, and `subscription:manage`.
- `allowReadAndCreateOnly` enforces the staff rule by HTTP method and is applied to the member, plan, membership, payment, expense, report, and attendance routers.
- `requirePermission(...)` guards endpoints whose method does not describe the change (membership freeze/cancel, staff management, billing).
- `authenticate` loads `role` and `gymId` from the database on every request — never from the request body — and rejects stale sessions with `401`.

```json
{
  "error": "Receptionists can only view (GET) and add (POST) data",
  "code": "FORBIDDEN",
  "requiredPermission": "records:update"
}
```

### Gym data isolation (`gymId`)

Every gym-data query is scoped by the `gymId` stored on the authenticated user. The client cannot override it:

- `authenticate` / `requireAuth` set `req.user.gymId` from `User.gymId`.
- List, aggregate, and report queries use `where: { gymId: req.user.gymId }`.
- Create operations write `gymId: req.user.gymId`, ignoring any body value.
- Updates and deletes use `findFirst`/`updateMany`/`deleteMany` with both the record id **and** `gymId`, so a guessed id from another gym behaves as not found.
- Staff records are additionally constrained to `role: RECEPTIONIST` and the owner's gym.

Example — staff in gym A requesting a member id that belongs to gym B:

```http
PATCH /api/v1/members/member-from-gym-b
```

```json
{ "error": "Member not found" }
```

Status: `404` (not `403`), so the API does not reveal that the record exists in another gym.

Attendance uses the same rule through `requireAuth`, which sets `req.gymId` from the user row; the attendance service filters every query by that value.

## Dashboard and reports

All report routes require an authenticated user with a gym.

### `GET /api/v1/reports/dashboard`

Returns counts and today's totals:

```json
{
  "data": {
    "totalMembers": 0,
    "activeMemberships": 0,
    "membershipsExpiringIn7Days": 0,
    "collectedTodayPaise": 0,
    "expensesTodayPaise": 0
  }
}
```

### `GET /api/v1/reports/due-memberships`

Returns up to 200 memberships past their end date, including member and plan data:

```json
{ "data": [] }
```

## Error responses

Validation errors return `400`:

```json
{
  "error": "Validation failed",
  "details": []
}
```

Other common responses include `401` for a missing session, `403` when gym setup or permissions are required, `404` for a missing route/record, and `409` for conflicts. Unhandled server errors return `500`.

## SaaS Subscription & Billing

Platform-level subscription and billing for gyms. These are separate from the
membership plans that gym owners sell to their own customers.

All prices are stored in integer paise (₹499 = 49900). The gym `gymId` is always
derived from the authenticated session — never accepted from the request body.

### Base path
`/api/v1/subscription` (gym-owner), `/api/v1/super-admin` (platform console),
and `/api/v1/admin/subscription` (legacy plan/settings admin, still supported).

Authentication: Better Auth session cookie (`credentials: "include"`). The
`/super-admin` group is SUPER_ADMIN-only; see
[Platform administration](#platform-administration-super-admin).

---

### Quick usage guide (bulletin)

- **Gym owner flow**
  - Sign up → verify email → `POST /api/v1/auth/setup-gym` (auto-starts the 14-day free trial if trials are enabled)
  - `GET /api/v1/subscription/plans` — list active plans with public features
  - `GET /api/v1/subscription/me` — view your subscription, plan, status, `trialEndsAt`, `currentPeriodEnd`, and `remainingDays` (calculated server-side)
  - `POST /api/v1/subscription/trial` — start a free trial (idempotent; one trial per gym)
  - `POST /api/v1/subscription/checkout` — create a Razorpay order using the plan's database price (never trust client-supplied price)
  - Pay via Razorpay on the frontend, then `POST /api/v1/subscription/verify` — verifies signature + provider status and activates the subscription
  - `GET /api/v1/subscription/history` — view subscription and payment history
  - `POST /api/v1/subscription/cancel` — cancel at end of paid period (access continues until `currentPeriodEnd`)
- **Super-admin flow** (requires `SUPER_ADMIN`; maximum **two** platform
  accounts. Create the first with `POST /api/v1/auth/bootstrap-super-admin` or
  `npm run bootstrap-super-admin`; the second is created by an already-signed-in
  platform owner via `POST /api/v1/super-admin/admins`. Never from `/signup`)
  - `POST /api/v1/auth/super-admin/login` — platform-owner sign-in, no OTP step
  - `POST /api/v1/super-admin/admins` — create the second platform owner (`409` at the cap of two)
  - `GET /api/v1/super-admin/stats` — platform totals, revenue and recent activity
  - `GET /api/v1/super-admin/gyms?q=...&status=...` — searchable cross-gym directory
  - `GET /api/v1/super-admin/gyms/:gymId` — owner, subscription, payments, trials, audit log
  - `POST /api/v1/super-admin/gyms/:gymId/plan` — assign or change a plan
  - `POST /api/v1/super-admin/gyms/:gymId/extend-expiry` — extend a period or trial
  - `POST /api/v1/super-admin/gyms/:gymId/trial` — start or extend a trial
  - `POST /api/v1/super-admin/gyms/:gymId/trial/end` — end a trial immediately
  - `PATCH /api/v1/super-admin/gyms/:gymId/access` — suspend or reactivate access
  - `GET /api/v1/super-admin/plans` — plan catalog (read-only here)
  - `GET /api/v1/super-admin/activity` — recent audit entries
  - Legacy plan editing/settings remain at `/api/v1/admin/subscription/*`
- **Security rules**
  - `gymId` is always derived from the authenticated session — never accepted from the request body
  - Only `SUPER_ADMIN` can query across gyms, edit plans, or change entitlements; gym owners cannot
  - Only `src/services/super-admin.service.js` performs cross-gym queries, and it re-checks the role on every call
  - Every administrative mutation requires a reason and writes a `SubscriptionAuditLog` row in the same transaction
  - Existing subscriptions preserve their original price when a plan price changes
  - Deactivating a plan does not cancel existing subscriptions
  - Expired trials/paid subscriptions return `402 SUBSCRIPTION_REQUIRED` on protected gym-management routes
  - `CANCELLED` with `cancelAtPeriodEnd` keeps access until the period ends
  - `SUSPENDED` blocks access immediately even if the paid period has not ended

---

### `GET /api/v1/subscription/plans`
Public. Returns active SaaS plans with their public features.

Response (`200`):
```json
{
  "data": [
    {
      "id": "cm...",
      "code": "MONTHLY",
      "name": "Monthly",
      "description": "Full access for one month.",
      "pricePaise": 49900,
      "currency": "INR",
      "durationMonths": 1,
      "isActive": true,
      "displayOrder": 1,
      "features": ["Unlimited members", "Attendance tracking", "Payments & expenses", "Reports dashboard"],
      "maxStaff": 2,
      "maxBranches": 1
    }
  ]
}
```

---

### `GET /api/v1/subscription/me`
Authenticated. Returns the authenticated gym's subscription, plan, status,
start/expiry dates, and remaining trial days.

Response (`200`):
```json
{
  "data": {
    "subscription": {
      "id": "cm...",
      "status": "TRIALING",
      "plan": null,
      "planNameSnapshot": "Free trial",
      "pricePaise": 0,
      "currency": "INR",
      "trialStartsAt": "2026-10-18T10:00:00.000Z",
      "trialEndsAt": "2026-11-01T10:00:00.000Z",
      "currentPeriodStart": null,
      "currentPeriodEnd": null,
      "cancelAtPeriodEnd": false,
      "cancelledAt": null,
      "paymentProvider": null
    },
    "entitled": true,
    "expiresAt": "2026-11-01T10:00:00.000Z",
    "remainingDays": 14,
    "reason": "TRIAL_ACTIVE"
  }
}
```

`remainingDays` is the whole-day count until the trial or paid period ends
(`0` when expired). `expiresAt` is the trial end or period end date.

---

### `POST /api/v1/subscription/trial`
Authenticated gym owner. Starts a free trial if the gym is eligible and trials
are enabled. Idempotent — returns the existing trial if already started.

Rate-limited (10 per hour per user).

Request body: `{}`

Response (`201`):
```json
{
  "data": {
    "subscriptionId": "cm...",
    "status": "TRIALING",
    "trialStartsAt": "2026-10-18T10:00:00.000Z",
    "trialEndsAt": "2026-11-01T10:00:00.000Z",
    "alreadyStarted": false
  },
  "message": "Free trial started"
}
```

Errors: `400 TRIALS_DISABLED`, `409 TRIAL_ALREADY_USED`.

---

### `POST /api/v1/subscription/checkout`
Authenticated gym owner. Creates a Razorpay payment order for a plan using the
plan's database price (client-supplied prices are ignored).

Rate-limited (20 per hour per user).

Request body:
```json
{ "planId": "cm..." }
```

Response (`201`):
```json
{
  "data": {
    "paymentId": "cm...",
    "orderId": "order_...",
    "amount": 49900,
    "currency": "INR",
    "keyId": "rzp_test_...",
    "status": "CREATED",
    "reused": false
  },
  "message": "Payment order created"
}
```

`keyId` is the public Razorpay key id for the frontend checkout. Never send
the secret key to the frontend.

---

### `POST /api/v1/subscription/verify`
Authenticated gym owner. Verifies a Razorpay payment (signature + provider
status) and activates the subscription. Never trusts the browser alone.

Request body:
```json
{ "orderId": "order_...", "paymentId": "pay_...", "signature": "..." }
```

Response (`200`):
```json
{
  "data": {
    "subscription": {
      "id": "cm...",
      "status": "ACTIVE",
      "plan": { "id": "...", "name": "Monthly", ... },
      "pricePaise": 49900,
      "currency": "INR",
      "currentPeriodStart": "2026-10-18T10:00:00.000Z",
      "currentPeriodEnd": "2026-11-18T10:00:00.000Z",
      "paymentProvider": "razorpay"
    },
    "payment": { "id": "...", "status": "SUCCESS", "verifiedAt": "..." },
    "alreadyVerified": false
  },
  "message": "Subscription activated"
}
```

---

### `GET /api/v1/subscription/history`
Authenticated gym owner. Returns the gym's subscription and payment history.

Response (`200`):
```json
{
  "data": {
    "subscription": { ... },
    "payments": [
      {
        "id": "cm...",
        "planId": "cm...",
        "amountPaise": 49900,
        "currency": "INR",
        "status": "SUCCESS",
        "provider": "razorpay",
        "orderId": "order_...",
        "paymentId": "pay_...",
        "verifiedAt": "2026-10-18T10:00:00.000Z",
        "createdAt": "2026-10-18T10:00:00.000Z"
      }
    ]
  }
}
```

---

### `POST /api/v1/subscription/cancel`
Authenticated gym owner. Cancels according to the configured billing policy
(default: cancel at end of paid period; access continues until `currentPeriodEnd`).

Response (`200`):
```json
{
  "data": {
    "subscriptionId": "cm...",
    "status": "CANCELLED",
    "cancelAtPeriodEnd": true,
    "currentPeriodEnd": "2026-11-18T10:00:00.000Z",
    "cancelledAt": "2026-10-18T10:00:00.000Z",
    "alreadyCancelled": false
  },
  "message": "Subscription will end at the end of the current billing period"
}
```

---

### Super-admin: plan management
All require the `SUPER_ADMIN` role (never assignable from client input; create or
promote via `npm run bootstrap-super-admin` — see
[Authorization and bootstrap](#authorization-and-bootstrap)).

> The dashboard, gym directory and subscription/access actions live at
> `/api/v1/super-admin/*`. The endpoints in this section remain the canonical
> place to create/edit plans and change platform settings.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/subscription/plans` | List all plans (incl. inactive) |
| `POST` | `/api/v1/admin/subscription/plans` | Create a plan |
| `PATCH` | `/api/v1/admin/subscription/plans/:id` | Update a plan |
| `PATCH` | `/api/v1/admin/subscription/plans/:id/status` | Activate/deactivate (`{ "isActive": bool }`) |

Create body:
```json
{
  "code": "MONTHLY",
  "name": "Monthly",
  "pricePaise": 49900,
  "durationMonths": 1,
  "features": ["Unlimited members"],
  "maxStaff": 2,
  "maxBranches": 1,
  "isActive": true
}
```

Deactivating a plan does **not** cancel existing subscriptions (purchase terms
are snapshotted).

---

### Super-admin: gym subscription management
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/subscription/gyms?q=...&page=1&limit=20` | Search gyms by name/email/phone |
| `GET` | `/api/v1/admin/subscription/gyms/:gymId` | View a gym's subscription + payment + trial history |
| `POST` | `/api/v1/admin/subscription/gyms/:gymId/extend-trial` | Extend trial (`{ "additionalDays": 7, "reason": "..." }`) |
| `POST` | `/api/v1/admin/subscription/gyms/:gymId/grant-access` | Grant time-limited access (`{ "expiresAt": "2026-12-31T00:00:00Z", "reason": "..." }`) |

---

### Super-admin: settings
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/subscription/settings` | Read trial/billing settings |
| `PATCH` | `/api/v1/admin/subscription/settings` | Update settings |

```json
{
  "trialEnabled": true,
  "trialDurationDays": 14,
  "trialPricePaise": 0,
  "trialRequiresPaymentMethod": false,
  "cancellationPolicy": "END_OF_PERIOD",
  "reminderDaysBefore": 3
}
```

---

### Webhook: Razorpay
`POST /api/v1/subscription/webhooks/razorpay`

Server-side signature verification using `X-Razorpay-Signature` and the raw
request body. Events are deduplicated. Handles `payment.captured`,
`payment.authorized`, `payment.failed`, `refund.processed`,
`refund.failed`, and `charge.disputed`.

---

### Subscription entitlement middleware
Protected gym-management routes (`members`, `plans`, `memberships`,
`attendence`, `expenses`, `reports`, `staff`) check the gym's subscription on
every request. When a trial or paid subscription expires, they return `402`
with a `SUBSCRIPTION_REQUIRED` error:

```json
{
  "error": "Subscription required",
  "code": "SUBSCRIPTION_REQUIRED",
  "reason": "TRIAL_EXPIRED",
  "expiresAt": "2026-11-01T10:00:00.000Z",
  "remainingDays": 0,
  "message": "Your free trial has expired. Please subscribe to continue using gym management features."
}
```

Login, account access, billing, plan listing, payment history, and renewal
flows remain accessible when expired. A `CANCELLED` subscription scheduled at
period end retains access until `currentPeriodEnd`.

---

## Platform administration (super admin)

Dedicated platform-owner API mounted at `/api/v1/super-admin`. It is the only
route group allowed to query across gyms. Every gym-scoped route still derives
`gymId` from the authenticated session and cannot see another tenant.

Frontend routes (static export):

| Route | Purpose |
|---|---|
| `/super-admin` | Platform KPIs, revenue, plan mix, expiring gyms, recent activity |
| `/super-admin/gyms` | Searchable/filterable cross-gym directory |
| `/super-admin/gyms/details?gymId=...` | Gym detail, owner, billing history, actions |
| `/super-admin/activity` | Administrative audit trail |

### Authorization and bootstrap

```js
// src/routes/super-admin.route.js
router.use(authenticate, requireSuperAdmin);
```

- `authenticate` loads `role` and `gymId` from the database on **every** request;
  nothing is trusted from the client.
- `requireSuperAdmin` returns `401` when no session exists and
  `403 SUPER_ADMIN_REQUIRED` for gym owners (`ADMIN`), staff (`RECEPTIONIST`) or
  any other role.
- `src/services/super-admin.service.js` re-checks `actor.role === "SUPER_ADMIN"`
  inside every exported function (defense in depth), so a service cannot be
  reused by a gym route to leak cross-tenant data.
- The only endpoint that can assign `SUPER_ADMIN` is
  `POST /api/v1/super-admin/admins`, it requires an existing platform session,
  and it is capped at **two** accounts. It refuses accounts attached to a gym
  (`409 ACCOUNT_BELONGS_TO_GYM`). `/signup` still can never pick a role, and
  `/auth/setup-gym` returns `403 SUPER_ADMIN_CANNOT_CREATE_GYM` for platform
  accounts.

Create or promote the first administrator (see
[setup step 5](#5-create-the-first-platform-administrator-one-time)):

```bash
SUPER_ADMIN_EMAIL=owner@platform.com \
SUPER_ADMIN_PASSWORD='a-strong-12+-char-password' \
SUPER_ADMIN_NAME='Platform Owner' \
npm run bootstrap-super-admin

# or promote an existing verified account
npm run bootstrap-super-admin -- owner@platform.com
```

Sign in at `/login` (or `POST /api/v1/auth/super-admin/login` for an OTP-free
sign-in); the client routes a `SUPER_ADMIN` to `/super-admin` and blocks
`/dashboard` and `/setup-gym`. Use a cookie jar for the examples:

```bash
API=http://localhost:5000/api/v1

curl -X POST $API/auth/super-admin/login \
  -H "Content-Type: application/json" \
  -c admin-cookies.txt \
  -d '{"email":"owner@platform.com","password":"a-strong-12+-char-password"}'

curl $API/super-admin/stats -b admin-cookies.txt
```

#### `POST /api/v1/super-admin/admins`

Creates (or promotes) the second and final platform owner. Requires an existing
`SUPER_ADMIN` session; gym owners and staff receive `403 SUPER_ADMIN_REQUIRED`.

```json
{
  "name": "Co Owner",
  "email": "co-owner@platform.com",
  "password": "a-strong-12+-char-password"
}
```

- `name` 2–100 characters, valid `email`, `password` 12–128 characters. Any
  `role` field is ignored — the account always becomes `SUPER_ADMIN`.
- No OTP is generated or sent. The account is created `emailVerified: true` with
  `gymId: null` and a normal credential row, so
  `POST /api/v1/auth/super-admin/login` works immediately.
- Cap: **two** platform accounts in total (the bootstrap/CLI account plus this
  one). At the cap:
  `409 { "code": "SUPER_ADMIN_LIMIT_REACHED", "details": { "max": 2, "current": 2 } }`.
- `409 ALREADY_SUPER_ADMIN` — the email is already a platform administrator.
- `409 ACCOUNT_BELONGS_TO_GYM` — the email is a gym user; platform owners must
  be separate accounts.
- An existing gym-less account is promoted, its name updated and its password
  set to the supplied one (`promoted: true`).
- Success (`201`):
  ```json
  {
    "message": "Platform administrator created. No OTP is required — sign in with the password you supplied.",
    "promoted": false,
    "remainingSlots": 0,
    "user": {
      "id": "...",
      "name": "Co Owner",
      "email": "co-owner@platform.com",
      "role": "SUPER_ADMIN",
      "emailVerified": true,
      "gymId": null
    },
    "login": { "method": "POST", "path": "/api/v1/auth/super-admin/login", "body": { "...": "..." } }
  }
  ```
- Audited with a console line (`[auth] super-admin created ... by <actor id>`);
  the password is never logged.

```bash
curl -X POST $API/super-admin/admins \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"name":"Co Owner","email":"co-owner@platform.com","password":"a-strong-12+-char-password"}'
```

All successful responses use the standard `{ "data": ... }` envelope. Errors are
`{ "error": "...", "code": "...", "details": ... }` with no stack traces.

### Dashboard and gym directory

#### `GET /api/v1/super-admin/stats`

Real database totals. Revenue is the sum of `SubscriptionPayment` rows with
`status: "SUCCESS"` only — trial grants and manual plan assignments never
create payment rows.

```bash
curl $API/super-admin/stats -b admin-cookies.txt
```

```json
{
  "data": {
    "totalGyms": 128,
    "activeSubscriptions": 84,
    "trialGyms": 22,
    "expiredSubscriptions": 17,
    "suspendedGyms": 3,
    "pastDueGyms": 2,
    "noSubscriptionGyms": 0,
    "subscriptionRevenuePaise": 1849200,
    "monthlyRevenuePaise": 349700,
    "successfulPayments": 96,
    "monthlySuccessfulPayments": 12,
    "planDistribution": [
      { "planId": "plan_monthly", "planName": "Monthly", "count": 41 },
      { "planId": null, "planName": "No plan / trial", "count": 22 }
    ],
    "expiringSoon": [
      {
        "gymId": "gym_x",
        "gymName": "Downtown Fitness",
        "status": "ACTIVE",
        "effectiveStatus": "ACTIVE",
        "planName": "Monthly",
        "expiresAt": "2026-10-29T10:00:00.000Z",
        "remainingDays": 4
      }
    ],
    "recentGyms": [],
    "recentActivity": [],
    "generatedAt": "2026-10-25T09:00:00.000Z"
  }
}
```

`effectiveStatus` is derived from both the stored status and the real dates, so a
lapsed period shows `EXPIRED` even before the background expiry job runs.

#### `GET /api/v1/super-admin/gyms`

Cross-gym directory with search and filters.

| Query | Rules | Default |
|---|---|---|
| `q` | Minimum 2 characters. Matches gym name, gym ID, gym email/phone, or owner name/email/phone | — |
| `status` | `ACTIVE` \| `TRIALING` \| `EXPIRED` \| `CANCELLED` \| `PAST_DUE` \| `SUSPENDED` \| `NO_SUBSCRIPTION` | all |
| `planId` | Exact plan id | — |
| `page` | ≥ 1 | `1` |
| `limit` | 1–100 | `20` |
| `sort` | `newest` \| `oldest` \| `name` | `newest` |

```bash
curl "$API/super-admin/gyms?q=downtown&status=ACTIVE&page=1&limit=20" \
  -b admin-cookies.txt
```

```json
{
  "data": {
    "gyms": [
      {
        "id": "gym_x",
        "name": "Downtown Fitness",
        "email": "hello@downtown.example",
        "phone": "+919876543210",
        "address": "12 MG Road",
        "registeredAt": "2026-08-14T09:12:00.000Z",
        "createdAt": "2026-08-14T09:12:00.000Z",
        "owner": {
          "id": "user_x",
          "name": "Aarav Patel",
          "email": "owner@example.com",
          "phone": "+919876543210",
          "emailVerified": true,
          "createdAt": "2026-08-14T09:10:00.000Z"
        },
        "owners": [],
        "effectiveStatus": "ACTIVE",
        "expiryDate": "2026-11-14T09:12:00.000Z",
        "memberCount": 412,
        "staffCount": 3,
        "subscription": {
          "id": "sub_x",
          "status": "ACTIVE",
          "effectiveStatus": "ACTIVE",
          "entitled": true,
          "entitlementReason": "ACTIVE",
          "plan": { "id": "plan_monthly", "name": "Monthly", "pricePaise": 49900 },
          "planId": "plan_monthly",
          "planNameSnapshot": "Monthly",
          "pricePaise": 49900,
          "currency": "INR",
          "trialStartsAt": null,
          "trialEndsAt": null,
          "currentPeriodStart": "2026-10-14T09:12:00.000Z",
          "currentPeriodEnd": "2026-11-14T09:12:00.000Z",
          "expiresAt": "2026-11-14T09:12:00.000Z",
          "remainingDays": 20,
          "cancelAtPeriodEnd": false,
          "cancelledAt": null,
          "paymentProvider": "razorpay",
          "createdAt": "2026-08-14T09:12:00.000Z",
          "updatedAt": "2026-10-14T09:12:00.000Z"
        }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
    "filters": { "q": "downtown", "status": "ACTIVE", "planId": null, "sort": "newest" }
  }
}
```

Search never returns another tenant's private records to a gym user, because
this route is SUPER_ADMIN-only.

#### `GET /api/v1/super-admin/gyms/:gymId`

Full tenant view: gym, owners, staff summary, subscription, real payments, trial
history and audit log. `404 GYM_NOT_FOUND` for an unknown id.

```bash
curl $API/super-admin/gyms/gym_x -b admin-cookies.txt
```

```json
{
  "data": {
    "gym": {
      "id": "gym_x",
      "name": "Downtown Fitness",
      "email": "hello@downtown.example",
      "phone": "+919876543210",
      "address": "12 MG Road",
      "registeredAt": "2026-08-14T09:12:00.000Z",
      "createdAt": "2026-08-14T09:12:00.000Z"
    },
    "owner": { "id": "user_x", "name": "Aarav Patel", "email": "owner@example.com" },
    "owners": [],
    "staff": [],
    "effectiveStatus": "ACTIVE",
    "subscription": { "id": "sub_x", "status": "ACTIVE", "expiresAt": "2026-11-14T09:12:00.000Z" },
    "expiryDate": "2026-11-14T09:12:00.000Z",
    "payments": [
      {
        "id": "pay_row_x",
        "planId": "plan_monthly",
        "subscriptionId": "sub_x",
        "amountPaise": 49900,
        "currency": "INR",
        "status": "SUCCESS",
        "provider": "razorpay",
        "orderId": "order_x",
        "paymentId": "pay_x",
        "failureReason": null,
        "verifiedAt": "2026-10-14T09:12:00.000Z",
        "createdAt": "2026-10-14T09:11:00.000Z"
      }
    ],
    "trialHistory": [
      {
        "id": "trial_x",
        "type": "INITIAL",
        "startsAt": "2026-08-14T09:12:00.000Z",
        "endsAt": "2026-08-28T09:12:00.000Z",
        "reason": "Signup trial",
        "grantedById": null,
        "grantedByRole": null,
        "source": "SIGNUP",
        "createdAt": "2026-08-14T09:12:00.000Z"
      }
    ],
    "subscriptionHistory": [],
    "auditLogs": [],
    "stats": {
      "members": 412,
      "owners": 1,
      "staff": 3,
      "totalUsers": 4,
      "attendanceRecords": 8123,
      "membershipPlans": 5,
      "activeMemberships": 318
    }
  }
}
```

#### `GET /api/v1/super-admin/plans`

Read-only plan catalog including inactive plans. Plan creation and editing remain
on `/api/v1/admin/subscription/plans`.

```bash
curl $API/super-admin/plans -b admin-cookies.txt
```

#### `GET /api/v1/super-admin/activity?limit=50`

Most recent `SubscriptionAuditLog` rows (1–100, default 20).

```json
{
  "data": [
    {
      "id": "audit_x",
      "action": "GYM_SUSPENDED",
      "gymId": "gym_x",
      "planId": "plan_monthly",
      "subscriptionId": "sub_x",
      "actorUserId": "user_admin",
      "actorEmail": "owner@platform.com",
      "actorRole": "SUPER_ADMIN",
      "reason": "Chargeback investigation #4412",
      "details": { "previousStatus": "ACTIVE" },
      "createdAt": "2026-10-25T09:30:00.000Z"
    }
  ]
}
```

### Subscription and access actions

Common rules for all five mutations:

- `reason` is **required** (3–500 characters) and is stored verbatim with the
  actor id, email and role.
- Every write runs inside a Prisma transaction with its audit row. A failure
  leaves no partial subscription change.
- Manual actions never create a `SubscriptionPayment` row. Revenue stays honest.
- Rate limit: **60 mutation requests per hour per admin user**.
- `404 GYM_NOT_FOUND` / `PLAN_NOT_FOUND` / `SUBSCRIPTION_NOT_FOUND` for missing rows.

#### `POST /api/v1/super-admin/gyms/:gymId/plan`

Assign or change the paid plan. Starts a fresh paid period from now unless an
explicit future `expiresAt` is supplied. Creates the subscription if the gym has
none. Audit action is `SUBSCRIPTION_PLAN_ASSIGNED` or
`SUBSCRIPTION_PLAN_CHANGED`.

```bash
curl -X POST $API/super-admin/gyms/gym_x/plan \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{
    "planId": "plan_annual",
    "expiresAt": "2027-10-25T00:00:00.000Z",
    "reason": "Annual plan paid offline, invoice #A-1042"
  }'
```

```json
{
  "data": {
    "subscription": {
      "id": "sub_x",
      "status": "ACTIVE",
      "effectiveStatus": "ACTIVE",
      "entitled": true,
      "entitlementReason": "ACTIVE",
      "planId": "plan_annual",
      "planNameSnapshot": "Annual",
      "pricePaise": 469900,
      "currentPeriodStart": "2026-10-25T09:30:00.000Z",
      "currentPeriodEnd": "2027-10-25T00:00:00.000Z",
      "expiresAt": "2027-10-25T00:00:00.000Z",
      "remainingDays": 365
    }
  },
  "message": "Subscription plan assigned"
}
```

`expiresAt` must be in the future (`400 INVALID_EXPIRY` otherwise). `planId` is
validated server-side; the client never supplies a price.

#### `POST /api/v1/super-admin/gyms/:gymId/extend-expiry`

Extend a trial or paid period. Provide `additionalDays` (1–3650) **or**
`expiresAt` (future date), not neither (`400 EXTENSION_REQUIRED`).

```bash
curl -X POST $API/super-admin/gyms/gym_x/extend-expiry \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"additionalDays": 7, "reason": "Outage goodwill credit"}'
```

```json
{
  "data": {
    "subscriptionId": "sub_x",
    "status": "ACTIVE",
    "expiresAt": "2026-11-21T09:12:00.000Z",
    "previousExpiry": "2026-11-14T09:12:00.000Z",
    "extendedByDays": 7
  },
  "message": "Subscription expiry updated"
}
```

Behavior:

- a trial in progress moves `trialEndsAt`;
- an expired paid subscription becomes `ACTIVE` again;
- a suspended subscription stays `SUSPENDED` until
  `PATCH .../access` activates it;
- the new expiry must be in the future (`400 INVALID_EXPIRY`).

#### `POST /api/v1/super-admin/gyms/:gymId/trial`

Start a trial or extend the current one. `days` defaults to 14 and must be an
integer 1–365. An active paid subscription cannot be overwritten:
`409 ACTIVE_SUBSCRIPTION_EXISTS` — suspend it or wait for expiry first.

```bash
curl -X POST $API/super-admin/gyms/gym_x/trial \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"days": 14, "reason": "Sales onboarding extension"}'
```

```json
{
  "data": {
    "subscriptionId": "sub_x",
    "status": "TRIALING",
    "trialStartsAt": "2026-10-25T09:30:00.000Z",
    "trialEndsAt": "2026-11-08T09:30:00.000Z",
    "extended": false
  },
  "message": "Trial started"
}
```

Creates a `TrialRecord` (`INITIAL` or `EXTENSION`, `source: ADMIN_TRIAL`) and an
audit row (`TRIAL_STARTED` / `TRIAL_EXTENDED`).

#### `POST /api/v1/super-admin/gyms/:gymId/trial/end`

End a trial immediately (`400 NOT_TRIALING` if the gym is not trialing).

```bash
curl -X POST $API/super-admin/gyms/gym_x/trial/end \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"reason": "Trial abuse — multiple accounts"}'
```

```json
{
  "data": {
    "subscriptionId": "sub_x",
    "status": "EXPIRED",
    "trialEndsAt": "2026-10-25T09:35:00.000Z"
  },
  "message": "Trial ended"
}
```

#### `PATCH /api/v1/super-admin/gyms/:gymId/access`

Suspend or reactivate a gym. `status` must be `SUSPENDED` or `ACTIVE`.

```bash
# Suspend immediately, preserving billing dates
curl -X PATCH $API/super-admin/gyms/gym_x/access \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"status": "SUSPENDED", "reason": "Chargeback investigation #4412"}'

# Reactivate; expiresAt is required only when the paid period already ended
curl -X PATCH $API/super-admin/gyms/gym_x/access \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"status": "ACTIVE", "expiresAt": "2026-11-24T00:00:00.000Z", "reason": "Investigation cleared"}'
```

Rules:

- `SUSPENDED` sets the subscription status and `computeEntitlement` denies access
  with reason `SUSPENDED`, even inside a paid period. Dates are preserved.
- Activation of a still-valid paid period resumes access without changing the
  expiry (`400 EXPIRY_REQUIRED` if the period ended and no `expiresAt` is given).
- A gym in `TRIALING` must be converted with a plan or the trial endpoints;
  activation returns `400 TRIAL_IN_PROGRESS`.
- Audit actions: `GYM_SUSPENDED`, `GYM_ACTIVATED`.

### Audit trail

Every mutation writes `SubscriptionAuditLog` with `action`, `gymId`, `planId`,
`subscriptionId`, `actorUserId`, `actorEmail`, `actorRole`, `reason`, `details`
and `createdAt` in the same transaction as the change.

| Action | Meaning |
|---|---|
| `SUBSCRIPTION_PLAN_ASSIGNED` | First paid plan assigned |
| `SUBSCRIPTION_PLAN_CHANGED` | Existing plan replaced |
| `SUBSCRIPTION_EXTENDED` | Paid expiry extended |
| `TRIAL_STARTED` / `TRIAL_EXTENDED` / `TRIAL_ENDED` | Trial lifecycle |
| `GYM_SUSPENDED` / `GYM_ACTIVATED` | Access control |

`GET /api/v1/super-admin/activity` returns the newest entries across all gyms;
`GET /api/v1/super-admin/gyms/:gymId` returns the newest entries for one gym.

### Platform admin errors

| Status | Code | Meaning |
|---|---|---|
| 400 | `REASON_REQUIRED` | Missing/short `reason` on a mutation |
| 400 | `INVALID_EXPIRY` | `expiresAt` is not a future date |
| 400 | `EXTENSION_REQUIRED` | Neither `additionalDays` nor `expiresAt` |
| 400 | `INVALID_TRIAL_DAYS` | Trial days outside 1–365 |
| 400 | `INVALID_ACCESS_STATUS` | Status not `ACTIVE`/`SUSPENDED` |
| 400 | `EXPIRY_REQUIRED` | Activating an ended period without a new expiry |
| 400 | `TRIAL_IN_PROGRESS` | Activating a trialing gym as a paid subscription |
| 400 | `NOT_TRIALING` | Ending a trial on a non-trialing gym |
| 401 | `Authentication required` | No/expired session |
| 403 | `SUPER_ADMIN_REQUIRED` | Gym owner or staff calling any super-admin route |
| 403 | `SUPER_ADMIN_CANNOT_CREATE_GYM` | Platform account calling `/auth/setup-gym` |
| 404 | `GYM_NOT_FOUND`, `PLAN_NOT_FOUND`, `SUBSCRIPTION_NOT_FOUND` | Missing resources |
| 409 | `ACTIVE_SUBSCRIPTION_EXISTS` | Starting a trial while a paid period is active |

> `SubscriptionStatus` includes `SUSPENDED`. Apply migration
> `20261025090000_add_suspended_subscription_status` with
> `npx prisma migrate deploy` before deploying this API.

---

## Subscription API usage guide

Usage guide for the three subscription route groups mounted in `src/app.js`:

```js
app.use("/api/v1/subscription", subscriptionRoutes);                  // Group 1 — gym-owner billing APIs
app.use("/api/v1/subscription/webhooks", subscriptionWebhookRoutes);  // Group 2 — Razorpay webhooks
app.use("/api/v1/admin/subscription", adminSubscriptionRoutes);       // Group 3 — super-admin APIs
```

All prices are integer paise (₹499 = `49900`). Authenticated endpoints use the
Better Auth session cookie — pass `-c cookies.txt -b cookies.txt` to cURL or
`credentials: "include"` from the browser.

### Usage guide contents

- [Usage conventions](#usage-conventions)
- [Group 1: gym-owner APIs (/api/v1/subscription)](#group-1-gym-owner-apis-apiv1subscription)
  - [GET /plans](#get-plans)
  - [GET /me](#get-me)
  - [POST /trial](#post-trial)
  - [POST /checkout](#post-checkout)
  - [POST /verify](#post-verify)
  - [GET /history](#get-history)
  - [POST /cancel](#post-cancel)
- [Group 2: Razorpay webhooks (/api/v1/subscription/webhooks)](#group-2-razorpay-webhooks-apiv1subscriptionwebhooks)
  - [POST /razorpay](#post-razorpay)
  - [Handled webhook events](#handled-webhook-events)
  - [Webhook response codes](#webhook-response-codes)
  - [Local webhook testing](#local-webhook-testing)
- [Group 3: super-admin APIs (/api/v1/admin/subscription)](#group-3-super-admin-apis-apiv1adminsubscription)
  - [GET /plans (admin)](#get-plans-admin)
  - [POST /plans (admin)](#post-plans-admin)
  - [PATCH /plans/:id](#patch-plansid)
  - [PATCH /plans/:id/status](#patch-plansidstatus)
  - [GET /gyms](#get-gyms)
  - [GET /gyms/:gymId](#get-gymsgymid)
  - [POST /gyms/:gymId/extend-trial](#post-gymsgymidextend-trial)
  - [POST /gyms/:gymId/grant-access](#post-gymsgymidgrant-access)
  - [GET /settings](#get-settings)
  - [PATCH /settings](#patch-settings)
- [Subscription error code reference](#subscription-error-code-reference)
- [Subscription end-to-end flow](#subscription-end-to-end-flow)

---

### Usage conventions

#### Authentication and roles

| Route group | Middleware | Who can call |
|---|---|---|
| `GET /api/v1/subscription/plans` | none | anyone (public catalog) |
| `GET /api/v1/subscription/me` | `authenticate` + `requireGym` | any gym member (owner or staff) — read-only status |
| Other `/api/v1/subscription/*` | `authenticate` + `requireGym` + `requirePermission(MANAGE_SUBSCRIPTION)` | gym owner (`ADMIN`) only; `RECEPTIONIST` gets `403` |
| `/api/v1/subscription/webhooks/razorpay` | HMAC signature only | Razorpay servers (no session) |
| `/api/v1/admin/subscription/*` | `authenticate` + `requireSuperAdmin` | SUPER_ADMIN only — gym roles get `403 SUPER_ADMIN_REQUIRED` |
| `/api/v1/super-admin/*` | `authenticate` + `requireSuperAdmin` | SUPER_ADMIN only; cross-gym queries live here |

`gymId` is always derived from the authenticated session server-side — never
from the request body — so a caller can never act on another gym. The `role`
field is not assignable from client input; create or promote a platform admin
out-of-band with `npm run bootstrap-super-admin`.

#### Success and error shape

Successful responses return `{ "data": ... }` (plus `message` where noted and
`pagination` on list endpoints). Errors return
`{ "error": "message", "code": "MACHINE_CODE" }` — never a stack trace.

#### 402 Subscription Required

Protected gym-management routers (`members`, `plans`, `memberships`,
`expenses`, `reports`, `staff`, `attendence`) apply
`requireActiveSubscription()` and return `402` on every request once the trial
or paid period ends:

```json
{
  "error": "Subscription required",
  "code": "SUBSCRIPTION_REQUIRED",
  "reason": "TRIAL_EXPIRED",
  "expiresAt": "2026-11-01T10:00:00.000Z",
  "remainingDays": 0,
  "message": "Your free trial has expired. Please subscribe to continue using gym management features."
}
```

`reason` ∈ `TRIAL_EXPIRED` | `SUBSCRIPTION_EXPIRED` | `CANCELLED_IMMEDIATE` |
`NO_SUBSCRIPTION`. Login, billing, plan listing, history, checkout, verify and
cancel stay reachable when expired, so a gym can always renew. See
[Subscription entitlement middleware](#subscription-entitlement-middleware).

#### Rate limits

| Endpoint | Limit |
|---|---|
| `POST /api/v1/subscription/trial` | 10 / hour / user |
| `POST /api/v1/subscription/checkout` | 20 / hour / user |
| `POST /api/v1/admin/subscription/plans` | 30 / hour / user |
| `POST .../gyms/:gymId/extend-trial` | 20 / hour / user |
| `POST .../gyms/:gymId/grant-access` | 20 / hour / user |

---

### Group 1: gym-owner APIs (/api/v1/subscription)

Router: `src/routes/subscription.route.js`. All endpoints below derive the gym
from the session and return `400 NO_GYM` when the account has no gym yet
(finish `POST /api/v1/auth/setup-gym` first).

#### GET /plans

Public plan catalog (active plans only, ordered by `displayOrder`).

```bash
curl http://localhost:5000/api/v1/subscription/plans
```

Response `200` — see the full shape in
[`GET /api/v1/subscription/plans`](#get-apiv1subscriptionplans).

#### GET /me

Current gym's subscription plus the computed entitlement — this is how the
frontend decides whether to show a paywall. Always reachable while
authenticated.

```bash
curl http://localhost:5000/api/v1/subscription/me -b cookies.txt
```

Response `200` (trial active):

```json
{
  "data": {
    "subscription": {
      "id": "sub_x", "status": "TRIALING", "plan": null,
      "planNameSnapshot": "Free trial", "pricePaise": 0, "currency": "INR",
      "trialStartsAt": "2026-10-18T10:00:00.000Z",
      "trialEndsAt": "2026-11-01T10:00:00.000Z",
      "remainingTrialDays": 14,
      "currentPeriodStart": null, "currentPeriodEnd": null,
      "cancelAtPeriodEnd": false, "cancelledAt": null, "paymentProvider": null
    },
    "entitled": true,
    "expiresAt": "2026-11-01T10:00:00.000Z",
    "remainingDays": 14,
    "reason": "TRIAL_ACTIVE"
  }
}
```

- `entitled: true` → paid features are usable.
- `subscription: null` + `reason: "NO_SUBSCRIPTION"` → start a trial or buy a plan.

#### POST /trial

Start the one-time free trial. Idempotent and transaction-safe — a second call
returns the existing trial with `alreadyStarted: true`. Rate-limited (10/hour).

```bash
curl -X POST http://localhost:5000/api/v1/subscription/trial \
  -H "Content-Type: application/json" -b cookies.txt -c cookies.txt -d '{}'
```

Response `201` (first call):

```json
{
  "data": {
    "subscriptionId": "sub_x", "status": "TRIALING",
    "trialStartsAt": "2026-10-18T10:00:00.000Z",
    "trialEndsAt": "2026-11-01T10:00:00.000Z",
    "alreadyStarted": false
  },
  "message": "Free trial started"
}
```

Errors: `400 TRIALS_DISABLED`, `409 TRIAL_ALREADY_USED`, `400 NO_GYM`.
`POST /api/v1/auth/setup-gym` also auto-starts the trial (best-effort), so a
new gym is usually already `TRIALING` — this endpoint is the fallback.

#### POST /checkout

Create a Razorpay order for a plan. The amount is read from the **database
plan row** — client-supplied prices are ignored. Rate-limited (20/hour).

```bash
curl -X POST http://localhost:5000/api/v1/subscription/checkout \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"planId":"plan_x"}'
```

Response `201`:

```json
{
  "data": {
    "paymentId": "paydb_x", "orderId": "order_xxxx",
    "amount": 49900, "currency": "INR",
    "keyId": "rzp_test_xxxx", "status": "CREATED", "reused": false
  },
  "message": "Payment order created"
}
```

Open Razorpay Checkout in the frontend with `keyId`, `orderId` and the amount
returned here — no secrets ever reach the client. Retries are idempotent: an
existing pending order for the same gym+plan comes back with `reused: true`.

Errors: `404 PLAN_NOT_FOUND`, `503 PAYMENT_NOT_CONFIGURED` (Razorpay env vars
not set — see `.env.example`).

#### POST /verify

Verify the checkout callback signature server-side and activate the
subscription (transactional, idempotent). Never activate on the browser's
"success" callback alone.

```bash
curl -X POST http://localhost:5000/api/v1/subscription/verify \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"orderId":"order_xxxx","paymentId":"pay_xxxx","signature":"hex_sig"}'
```

Response `200`:

```json
{
  "data": {
    "subscription": {
      "id": "sub_x", "status": "ACTIVE",
      "plan": { "code": "MONTHLY", "name": "Monthly", "pricePaise": 49900 },
      "pricePaise": 49900, "currency": "INR",
      "currentPeriodStart": "2026-10-18T10:00:00.000Z",
      "currentPeriodEnd": "2026-11-18T10:00:00.000Z",
      "paymentProvider": "razorpay"
    },
    "payment": { "id": "paydb_x", "status": "SUCCESS", "verifiedAt": "..." },
    "alreadyVerified": false
  },
  "message": "Subscription activated"
}
```

Errors: `400 SIGNATURE_INVALID`, `400 ORDER_MISMATCH`, `400 AMOUNT_MISMATCH`,
`400 CURRENCY_MISMATCH`, `400 PAYMENT_NOT_CAPTURED`, `404 PAYMENT_NOT_FOUND`.
A repeat call returns `alreadyVerified: true` with the existing subscription.

#### GET /history

Last 100 payments plus the current subscription snapshot.

```bash
curl http://localhost:5000/api/v1/subscription/history -b cookies.txt
```

Response `200`:

```json
{
  "data": {
    "subscription": { "id": "sub_x", "status": "ACTIVE", "pricePaise": 49900, "cancelAtPeriodEnd": false },
    "payments": [
      {
        "id": "paydb_x", "planId": "plan_x", "amountPaise": 49900,
        "currency": "INR", "status": "SUCCESS", "provider": "razorpay",
        "orderId": "order_xxxx", "paymentId": "pay_xxxx",
        "failureReason": null, "verifiedAt": "...", "createdAt": "..."
      }
    ]
  }
}
```

`payment.status` ∈ `CREATED | PENDING | SUCCESS | FAILED | REFUNDED | DISPUTED`.

#### POST /cancel

Cancel according to the configured `cancellationPolicy` (default
`END_OF_PERIOD`: access continues until `currentPeriodEnd`).

```bash
curl -X POST http://localhost:5000/api/v1/subscription/cancel \
  -H "Content-Type: application/json" -b cookies.txt -d '{}'
```

Response `200`:

```json
{
  "data": {
    "subscriptionId": "sub_x", "status": "CANCELLED",
    "cancelAtPeriodEnd": true,
    "currentPeriodEnd": "2026-11-18T10:00:00.000Z",
    "cancelledAt": "2026-10-18T10:00:00.000Z",
    "alreadyCancelled": false
  },
  "message": "Subscription will end at the end of the current billing period"
}
```

- `CANCELLED` + `cancelAtPeriodEnd: true` still returns `entitled: true` from
  `/me` until the period ends.
- With policy `IMMEDIATE`, `currentPeriodEnd` is set to now and access stops.
- Errors: `404 SUBSCRIPTION_NOT_FOUND`, `400 SUBSCRIPTION_NOT_ACTIVE`
  (expired / past-due); repeat calls return `alreadyCancelled: true`.

---

### Group 2: Razorpay webhooks (/api/v1/subscription/webhooks)

Router: `src/routes/subscription.webhook.route.js`.

#### POST /razorpay

```
POST http://localhost:5000/api/v1/subscription/webhooks/razorpay
Content-Type: application/json
X-Razorpay-Signature: <hex hmac>
```

This router applies `express.raw()` so the **raw body** is preserved for HMAC
verification against `RAZORPAY_WEBHOOK_SECRET`. No session cookie — the
signature *is* the authentication. Flow:

1. Verify `X-Razorpay-Signature` over the raw body → `401` if invalid.
2. Parse the event → `400` if malformed.
3. Insert `SubscriptionWebhookEvent` by event `id` → duplicate deliveries
   return `200 { received: true, duplicate: true }` without reprocessing.
4. Verify the payment **server-side against Razorpay**, then activate the
   subscription in a transaction.
5. Mark `processedAt` → `200 { received: true, event, duplicate: false }`.

Activation never happens before signature verification — neither here nor in
`POST /subscription/verify`.

#### Handled webhook events

| Event | Effect |
|---|---|
| `payment.captured`, `payment.authorized` | Server-side verification → activate/extend subscription (idempotent) |
| `payment.failed` | Pending/created payment rows → `FAILED` with reason |
| `refund.processed` | Payments → `REFUNDED`; related subscription → `PAST_DUE` |
| `refund.failed` | Payments → `FAILED` |
| `charge.disputed` | Payments → `DISPUTED` |

#### Webhook response codes

| Status | Meaning |
|---|---|
| 200 | Accepted (processed or duplicate) |
| 400 | Missing signature/raw body, invalid JSON, malformed event |
| 401 | Invalid signature |
| 503 | `WEBHOOK_SECRET_NOT_CONFIGURED` (secret missing from env) |

#### Local webhook testing

```bash
BODY='{"id":"evt_test_1","event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_x","order_id":"order_x"}}},"order":{"entity":{"id":"order_x"}}}'
SIG=$(node -e "const c=require('crypto');process.stdout.write(c.createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(process.argv[1]).digest('hex'))" "$BODY")
curl -X POST http://localhost:5000/api/v1/subscription/webhooks/razorpay \
  -H "Content-Type: application/json" -H "X-Razorpay-Signature: $SIG" \
  -d "$BODY"
```

Point the Razorpay dashboard webhook at
`https://<your-host>/api/v1/subscription/webhooks/razorpay` and copy the
generated secret into `RAZORPAY_WEBHOOK_SECRET`.

---

### Group 3: super-admin APIs (/api/v1/admin/subscription)

Router: `src/routes/admin.subscription.route.js`. Every route runs
`authenticate` + `requireSuperAdmin`; every mutation writes a
`SubscriptionAuditLog` entry. Create or promote a platform admin first with
`npm run bootstrap-super-admin` and use `admin-cookies.txt` for all calls below.

#### GET /plans (admin)

All plans **including inactive** ones.

```bash
curl http://localhost:5000/api/v1/admin/subscription/plans -b admin-cookies.txt
```

#### POST /plans (admin)

Create a plan (prices in paise). Rate-limited (30/hour).

```bash
curl -X POST http://localhost:5000/api/v1/admin/subscription/plans \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{
    "code": "ENTERPRISE",
    "name": "Enterprise",
    "pricePaise": 99900,
    "currency": "INR",
    "durationMonths": 12,
    "displayOrder": 5,
    "features": ["Unlimited staff", "Multi-branch"],
    "maxStaff": null,
    "maxBranches": null
  }'
```

| Field | Rules |
|---|---|
| `code` | 2–40 chars, uppercased, unique |
| `name` | 2–120 chars |
| `pricePaise` | integer ≥ 0 |
| `durationMonths` | integer 1–60 |
| `currency` | 3 chars, default `INR` |
| `isActive` | optional bool (default true) |
| `displayOrder`, `features`, `maxStaff`, `maxBranches` | optional |

Response `201` — `{ "data": <public plan> }`. Existing subscriptions keep
their **price snapshot**: editing a plan never re-prices active subscribers.

#### PATCH /plans/:id

Partial update with the same field rules (all optional). Deactivating never
cancels existing subscriptions — it only hides the plan from
`GET /subscription/plans` and blocks new checkouts (`404 PLAN_NOT_FOUND`).
Errors: `404 PLAN_NOT_FOUND`.

#### PATCH /plans/:id/status

```bash
curl -X PATCH http://localhost:5000/api/v1/admin/subscription/plans/plan_x/status \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"isActive":false}'
```

Response `200` — `{ "data": { "id", "code", "name", "isActive" } }`.

#### GET /gyms

Search gyms by name/email/phone (`q` ≥ 2 chars).

```bash
curl "http://localhost:5000/api/v1/admin/subscription/gyms?q=downtown&page=1&limit=20" \
  -b admin-cookies.txt
```

Response `200`:

```json
{
  "data": [{ "id": "gym_x", "name": "Downtown Fitness", "email": "...", "phone": "..." }],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

#### GET /gyms/:gymId

Full billing detail for one gym: subscription, last 50 payments, and the
complete trial history (`type`, `startsAt`, `endsAt`, `reason`,
`grantedById/Role`, `source`).

```bash
curl http://localhost:5000/api/v1/admin/subscription/gyms/gym_x -b admin-cookies.txt
```

Errors: `404` when the gym does not exist.

#### POST /gyms/:gymId/extend-trial

Push `trialEndsAt` forward; audited with a mandatory reason.
Rate-limited (20/hour).

```bash
curl -X POST http://localhost:5000/api/v1/admin/subscription/gyms/gym_x/extend-trial \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"additionalDays":7,"reason":"Onboarding delay reported by gym owner"}'
```

Response `200`:

```json
{
  "data": {
    "subscriptionId": "sub_x", "status": "TRIALING",
    "trialEndsAt": "2026-11-08T10:00:00.000Z", "extendedByDays": 7
  },
  "message": "Trial extended by 7 day(s)"
}
```

Errors: `400 INVALID_EXTENSION_DAYS` (not 1–365), `400 REASON_REQUIRED`.

#### POST /gyms/:gymId/grant-access

Manual time-boxed entitlement (comp, outage goodwill, …). Creates or updates
the subscription as `ACTIVE` with `cancelAtPeriodEnd: true` until the given
expiry — audited as `ACCESS_GRANTED`. Rate-limited (20/hour).

```bash
curl -X POST http://localhost:5000/api/v1/admin/subscription/gyms/gym_x/grant-access \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"expiresAt":"2026-11-30","reason":"Payment gateway outage goodwill"}'
```

`expiresAt` accepts an ISO datetime with offset or a plain date, and must be
in the future — otherwise `400 INVALID_EXPIRY`.

Response `200`:

```json
{
  "data": {
    "subscriptionId": "sub_x", "status": "ACTIVE",
    "currentPeriodEnd": "2026-11-30T00:00:00.000Z",
    "expiresAt": "2026-11-30T00:00:00.000Z"
  },
  "message": "Manual access granted until 2026-11-30T00:00:00.000Z"
}
```

#### GET /settings

Read the singleton subscription settings row.

```bash
curl http://localhost:5000/api/v1/admin/subscription/settings -b admin-cookies.txt
```

Response `200`:

```json
{
  "data": {
    "trialEnabled": true,
    "trialDurationDays": 14,
    "trialPricePaise": 0,
    "trialRequiresPaymentMethod": false,
    "cancellationPolicy": "END_OF_PERIOD",
    "reminderDaysBefore": 3,
    "updatedAt": "2026-10-18T10:00:00.000Z"
  }
}
```

#### PATCH /settings

Partial update (all fields optional), audited as `SETTINGS_UPDATED`.

```bash
curl -X PATCH http://localhost:5000/api/v1/admin/subscription/settings \
  -H "Content-Type: application/json" -b admin-cookies.txt \
  -d '{"trialDurationDays":30,"cancellationPolicy":"IMMEDIATE"}'
```

| Field | Rules |
|---|---|
| `trialEnabled` | boolean |
| `trialDurationDays` | integer 1–365 (`400 INVALID_TRIAL_DURATION`) |
| `trialPricePaise` | integer ≥ 0 (paid-trial extension point) |
| `trialRequiresPaymentMethod` | boolean |
| `cancellationPolicy` | `END_OF_PERIOD` \| `IMMEDIATE` (`400 INVALID_CANCELLATION_POLICY`) |
| `reminderDaysBefore` | integer ≥ 0 |

---

### Subscription error code reference

| Status | Code | Where |
|---|---|---|
| 400 | `NO_GYM` | Any owner endpoint when the account has no gym |
| 400 | `TRIALS_DISABLED`, `INVALID_EXTENSION_DAYS`, `REASON_REQUIRED`, `INVALID_EXPIRY`, `SUBSCRIPTION_NOT_ACTIVE`, `INVALID_TRIAL_DURATION`, `INVALID_CANCELLATION_POLICY` | Trial / cancel / admin validation |
| 400 | `SIGNATURE_INVALID`, `ORDER_MISMATCH`, `AMOUNT_MISMATCH`, `CURRENCY_MISMATCH`, `PAYMENT_NOT_CAPTURED` | `POST /subscription/verify` |
| 400 | `INVALID_WEBHOOK`, `INVALID_PAYLOAD`, `MALFORMED_EVENT` | Webhook (missing/broken payload) |
| 401 | `INVALID_SIGNATURE` | Webhook signature mismatch |
| 402 | `SUBSCRIPTION_REQUIRED` | Any protected gym route while not entitled |
| 403 | `SUPER_ADMIN_REQUIRED` | Non-super-admin calling `/admin/subscription/*` |
| 404 | `PLAN_NOT_FOUND`, `PAYMENT_NOT_FOUND`, `SUBSCRIPTION_NOT_FOUND` | Missing resources |
| 409 | `TRIAL_ALREADY_USED` | Second trial for the same gym |
| 503 | `PAYMENT_NOT_CONFIGURED` | Checkout before `RAZORPAY_KEY_ID/SECRET` are set |
| 503 | `WEBHOOK_SECRET_NOT_CONFIGURED` | Webhook before `RAZORPAY_WEBHOOK_SECRET` is set |

---

### Subscription end-to-end flow

```text
signup → verify-email → setup-gym (auto-trial)
   │
   ├─ GET  /api/v1/subscription/me            → entitled: true (trial)
   ├─ GET  /api/v1/subscription/plans         → pick a plan
   ├─ POST /api/v1/subscription/checkout      → { planId } → orderId + keyId
   │     └─ frontend opens Razorpay Checkout (public key only)
   ├─ POST /api/v1/subscription/verify        → { orderId, paymentId, signature } → ACTIVE
   │     └─ Razorpay also POSTs /subscription/webhooks/razorpay (fallback, idempotent)
   ├─ GET  /api/v1/subscription/history       → payments + subscription
   └─ POST /api/v1/subscription/cancel        → CANCELLED at period end (access kept)
        │
        └─ trial/period ends → protected routes return 402 SUBSCRIPTION_REQUIRED
              ├─ renew via /checkout + /verify, or
              └─ SUPER_ADMIN: POST /admin/subscription/gyms/:id/grant-access
```

Setup checklist: `npm install` → `npx prisma generate` →
`npx prisma migrate dev` → `npm run seed` → set Razorpay vars from
`.env.example` → `npm run dev`.

---

## Subscription Implementation Guide

This is a step-by-step guide to the complete subscription and billing flow.

### Prerequisites

```bash
npm install
npx prisma generate
npx prisma migrate dev   # subscription migrations already applied
npm run seed             # idempotent: 4 plans + trial settings
npm run dev              # server on http://localhost:5000
```

Seed output:
```
Seed complete: 4 SaaS plan(s) in database, subscription settings ready.
```

| Plan | Price | Duration |
|------|-------|----------|
| Monthly | ₹499 (49900 paise) | 1 month |
| Quarterly | ₹1,399 (139900 paise) | 3 months |
| Half-yearly | ₹2,799 (279900 paise) | 6 months |
| Annual | ₹4,699 (469900 paise) | 12 months |

---

### 1. Gym owner: signup → verify → create gym (auto-starts trial)

Using a cookie jar (`cookies.txt`):

```bash
API=http://localhost:5000/api/v1

# Signup
curl -X POST $API/auth/signup \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"name":"Aarav Patel","email":"owner@example.com","password":"password123"}'

# Verify email (6-digit OTP from email/console)
curl -X POST $API/auth/verify-email \
  -H "Content-Type: application/json" \
  -c cookies.txt -b cookies.txt \
  -d '{"email":"owner@example.com","otp":"123456"}'

# Create gym — this also auto-starts the 14-day free trial (if trials enabled)
curl -X POST $API/auth/setup-gym \
  -H "Content-Type: application/json" \
  -c cookies.txt -b cookies.txt \
  -d '{"name":"Downtown Fitness","phone":"+91 98765 43210","email":"hello@example.com"}'
```

### 2. Gym owner: check subscription & remaining trial days

```bash
curl $API/subscription/me -b cookies.txt
```

Response (200) — trial active:
```json
{
  "data": {
    "subscription": {
      "id": "sub_xyz",
      "status": "TRIALING",
      "planNameSnapshot": "Free trial",
      "pricePaise": 0,
      "currency": "INR",
      "trialStartsAt": "2026-10-18T10:00:00.000Z",
      "trialEndsAt": "2026-11-01T10:00:00.000Z",
      "currentPeriodStart": null,
      "currentPeriodEnd": null,
      "cancelAtPeriodEnd": false,
      "cancelledAt": null,
      "paymentProvider": null
    },
    "entitled": true,
    "expiresAt": "2026-11-01T10:00:00.000Z",
    "remainingDays": 14,
    "reason": "TRIAL_ACTIVE"
  }
}
```

- `remainingDays` = whole days until expiry (calculated server-side, `0` when expired).
- When `entitled` is `false`, protected gym routes (members, plans, attendance, expenses, reports, staff) return `402 SUBSCRIPTION_REQUIRED`.

---

### 3. Gym owner: list plans, checkout, pay, verify

```bash
# List active plans
curl $API/subscription/plans -b cookies.txt

# Create a Razorpay order (replace PLAN_ID)
curl -X POST $API/subscription/checkout \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"planId":"PLAN_ID"}'
```

Response (201):
```json
{
  "data": {
    "paymentId": "payord_abc",
    "orderId": "order_rAz123",
    "amount": 49900,
    "currency": "INR",
    "keyId": "rzp_test_...",
    "status": "CREATED",
    "reused": false
  },
  "message": "Payment order created"
}
```

- `keyId` is the **public** Razorpay key for frontend checkout. Never send `RAZORPAY_KEY_SECRET` to the frontend.
- `amount` comes from the database — client-supplied prices are ignored.

**Frontend (Razorpay Checkout)** — after payment, call verify:
```js
await fetch(`${API}/subscription/verify`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    orderId: response.razorpay_order_id,
    paymentId: response.razorpay_payment_id,
    signature: response.razorpay_signature,
  }),
});
```

```bash
# Verify payment and activate subscription (server verifies signature + provider)
curl -X POST $API/subscription/verify \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"orderId":"order_rAz123","paymentId":"pay_xyz","signature":"..."}'
```

Response (200): subscription becomes `ACTIVE` until `currentPeriodEnd`. Re-verifying is idempotent (`alreadyVerified: true`).

---

### 4. Gym owner: history & cancel

```bash
# Subscription + payment history
curl $API/subscription/history -b cookies.txt

# Cancel (default: at end of paid period; access continues until currentPeriodEnd)
curl -X POST $API/subscription/cancel \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{}'
```

---

### 5. Super-admin (create the first account out of band)

Create a verified platform owner, or promote an existing verified account:

```bash
SUPER_ADMIN_EMAIL=owner@platform.com \
SUPER_ADMIN_PASSWORD='a-strong-12+-char-password' \
SUPER_ADMIN_NAME='Platform Owner' \
npm run bootstrap-super-admin

# or promote an existing verified account
npm run bootstrap-super-admin -- owner@platform.com
```

Then sign in and use `admin-cookies.txt` for every `/api/v1/super-admin/*`
endpoint. Every endpoint in the group requires the `SUPER_ADMIN` role; gym
`OWNER`/`ADMIN`/`RECEPTIONIST` sessions receive `403 SUPER_ADMIN_REQUIRED`.

| Action | Example |
|--------|---------|
| Platform stats + revenue | `GET /api/v1/super-admin/stats` |
| Search / filter gyms | `GET /api/v1/super-admin/gyms?q=downtown&status=ACTIVE&page=1&limit=20` |
| Gym subscription + history | `GET /api/v1/super-admin/gyms/:gymId` |
| Assign or change plan | `POST /api/v1/super-admin/gyms/:gymId/plan` `{planId, expiresAt?, reason}` |
| Extend expiry | `POST /api/v1/super-admin/gyms/:gymId/extend-expiry` `{additionalDays?, expiresAt?, reason}` |
| Start / extend trial | `POST /api/v1/super-admin/gyms/:gymId/trial` `{days?, reason}` |
| End trial now | `POST /api/v1/super-admin/gyms/:gymId/trial/end` `{reason}` |
| Suspend / activate access | `PATCH /api/v1/super-admin/gyms/:gymId/access` `{status, expiresAt?, reason}` |
| Create second platform owner (max 2) | `POST /api/v1/super-admin/admins` `{name, email, password}` |
| Read plans (incl. inactive) | `GET /api/v1/super-admin/plans` |
| Read audit trail | `GET /api/v1/super-admin/activity?limit=50` |
| Create / edit plans and settings | Legacy `/api/v1/admin/subscription/*` (still supported) |

Example — extend a trial:
```bash
curl -X POST $API/admin/subscription/gyms/GYM_ID/extend-trial \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"additionalDays":7,"reason":"Support issue"}'
```

---

### 6. Razorpay webhook

Register in Razorpay dashboard:
```
POST https://your-backend.com/api/v1/subscription/webhooks/razorpay
```

Required env vars (never commit real values):
```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

The webhook verifies `X-Razorpay-Signature` against the **raw request body**, deduplicates events, and:
- `payment.captured` / `payment.authorized` → activates the subscription (after server-side amount/currency check)
- `payment.failed` → marks payment `FAILED`
- `refund.processed` → marks payment `REFUNDED`, subscription `PAST_DUE`
- `charge.disputed` → marks payment `DISPUTED`

---

### 7. Entitlement middleware (402 on expiry)

Protected gym-management routes check the subscription on every request:

- `members`, `plans` (gym's own membership plans), `memberships`, `attendence`, `expenses`, `reports`, `staff`

Expired → `402 SUBSCRIPTION_REQUIRED`:
```json
{
  "error": "Subscription required",
  "code": "SUBSCRIPTION_REQUIRED",
  "reason": "TRIAL_EXPIRED",
  "expiresAt": "2026-11-01T10:00:00.000Z",
  "remainingDays": 0,
  "message": "Your free trial has expired. Please subscribe to continue using gym management features."
}
```

Always accessible when expired: login, `/auth/me`, `/subscription/plans`, `/me`, `/history`, `/trial`, `/checkout`, `/verify`, `/cancel`.

A `CANCELLED` subscription with `cancelAtPeriodEnd: true` keeps access until `currentPeriodEnd` (not revoked immediately).

---

### 8. Tests

```bash
npm test
```

Covers trial eligibility, concurrency-safe duplicate-trial prevention, plan super-admin permissions, tenant isolation, checkout using DB price, server-side expiry/entitlement calculation, and the `/api/v1/super-admin` authorization, isolation, stats, plan/extend/trial/suspension flows.

Expected: `✔ pass 66  ✔ fail 0`.

---

## Payment receipts

Every successful membership payment creates an immutable receipt snapshot in
the same transaction as the payment. Receipts cover membership fees and related
charges only — not products, equipment, lockers or personal training.

### `POST /api/v1/payments`

Records one membership payment. This is the only write path the client uses for
Add Member and Pay Bill.

Headers:

```
Authorization: Cookie session
Content-Type: application/json
Idempotency-Key: rcpt-<uuid>      # optional but recommended
```

Body:

```json
{
  "memberId": "mem_123",
  "membershipId": "ms_456",
  "amount": 150000,
  "paymentMode": "UPI",
  "reference": "UPI-8842199",
  "paymentDate": "2026-11-01T10:42:00.000Z",
  "status": "SUCCESS"
}
```

`amount` is in **paise**. `membershipId` is optional for older callers; when it
is omitted the member's latest membership is used.

`201 Created` (or `200` when the idempotency key already exists):

```json
{
  "data": { "id": "pay_789", "receiptNumber": "DG-0042", "...": "..." },
  "duplicate": false,
  "receipt": { "receiptNumber": "DG-0042", "fees": {}, "links": {} },
  "whatsapp": {
    "phone": "919876543210",
    "url": "https://wa.me/919876543210?text=...",
    "message": "Hello Priya Sharma!...",
    "cloudAvailable": false
  },
  "receiptError": null
}
```

- A retried `Idempotency-Key` returns the original payment with
  `duplicate: true`; it never charges twice.
- The payment commits even when receipt assembly fails. In that case
  `receipt` is `null` and `receiptError` explains how to retry from Payments.
- Failed payments (`status !== "SUCCESS"`) never return a receipt.

Errors:

| Status | Code | Meaning |
|---|---|---|
| `400` | validation | Amount/mode/member payload invalid |
| `403` | — | No gym context for the session |
| `404` | `MEMBER_NOT_FOUND` / `MEMBERSHIP_NOT_FOUND` | Row is missing **or belongs to another gym** |
| `409` | `RECEIPT_NUMBER_CONFLICT` | Number allocation raced repeatedly; safe to retry |

### Receipt endpoints

All require a gym session and are scoped to `req.user.gymId`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/v1/payments/:id/receipt` | JSON payload. `409 PAYMENT_NOT_SUCCESSFUL` for a non-success payment, `404 RECEIPT_NOT_FOUND` for another gym's payment. |
| `GET` | `/api/v1/payments/:id/receipt/pdf` | PDF stream (`application/pdf`, `no-store`). Same guards. |
| `POST` | `/api/v1/payments/:id/receipt/whatsapp` | Renders the PDF, uploads it to the WhatsApp Cloud API media endpoint and sends it as a document to the member's registered number. Falls back to the signed public link if the upload fails. `501 WHATSAPP_NOT_CONFIGURED` when credentials are absent; `502 WHATSAPP_DELIVERY_FAILED` on provider errors. The payment is never modified. |
| `GET` | `/api/v1/receipts/public/:id/pdf?token=...` | **No session.** The HMAC token (payment id + expiry, default 7 days) is the only credential. Invalid → `401 LINK_INVALID`, expired → `401 LINK_EXPIRED`, token for another id → `403 LINK_SCOPE_MISMATCH`. Rate-limited per IP. |

### Receipt settings

One `GymReceiptSettings` row per gym (unique `gymId`), created on first save.

`GET /api/v1/receipt-settings` returns the raw saved overrides, the effective
branding after gym-profile fallbacks, and defaults:

```json
{
  "data": {
    "gym": { "id": "gym_1", "name": "DarkGold Gym", "phone": "...", "email": "...", "address": "..." },
    "settings": { "gymName": null, "tagline": null, "logoDataUrl": null, "qrEnabled": true, "receiptPrefix": "RCPT", "...": "..." },
    "branding": { "gymName": "DarkGold Gym", "tagline": "Premium Fitness Club", "footerMessage": "Thank you for choosing {gymName}!...", "...": "..." },
    "defaults": { "tagline": "Premium Fitness Club", "footerMessage": "...", "receiptPrefix": "RCPT", "paymentModes": { "CASH": "Cash" } }
  }
}
```

`PUT /api/v1/receipt-settings` upserts the row. Owners/settings managers only;
staff receive `403`.

```json
{
  "gymName": "DarkGold Gym",
  "tagline": "Premium Fitness Club",
  "address": "12 MG Road, Bengaluru",
  "phone": "+91 98765 43210",
  "email": "hello@darkgoldgym.com",
  "website": "www.darkgoldgym.com",
  "footerMessage": "Thank you for choosing {gymName}, {memberName}!",
  "authorizedSignatory": "Arjun Mehta",
  "logoDataUrl": "data:image/png;base64,...",
  "signatureDataUrl": "data:image/png;base64,...",
  "qrEnabled": true,
  "receiptPrefix": "DG"
}
```

Images must be PNG/JPEG data URLs under ~2 MB encoded. `footerMessage`
supports `{gymName}` / `{memberName}` (also `{{...}}` and `snake_case`).
Receipt numbers are `<prefix>-0001`, unique per gym. Existing receipts keep
their snapshot, so editing branding or plan prices never rewrites history.

### Receipt environment variables

```dotenv
RECEIPT_PUBLIC_BASE_URL=https://darkgoldgym.duckdns.org
RECEIPT_LINK_SECRET=<long random string>
RECEIPT_LINK_TTL_DAYS=7
# Optional custom fonts for ₹ support in the PDF:
# RECEIPT_PDF_FONT=/absolute/path/Regular.ttf
# RECEIPT_PDF_FONT_BOLD=/absolute/path/Bold.ttf
# Optional WhatsApp Business Cloud API document delivery:
# WHATSAPP_ACCESS_TOKEN=...
# WHATSAPP_PHONE_NUMBER_ID=...
# WHATSAPP_API_VERSION=v21.0
```

`RECEIPT_PUBLIC_BASE_URL` falls back to `PUBLIC_API_URL`, then the request
origin. The fallback is fine for local testing but must be the public API origin
in production, otherwise the QR code and the link fallback point at
`localhost`.

#### WhatsApp Cloud API setup

1. Create a Meta app at <https://developers.facebook.com/apps> and add the
   **WhatsApp** product.
2. Copy the **Phone number ID** and a permanent **System User access token**
   (not the 24-hour test token) into `WHATSAPP_PHONE_NUMBER_ID` and
   `WHATSAPP_ACCESS_TOKEN`.
3. Add the member's number as a test recipient while the app is in development,
   or submit the app for review to message arbitrary numbers.
4. Set `WHATSAPP_API_VERSION` to the Graph API version shown in the dashboard
   (default `v21.0`).
5. Restart the API. `POST /payments/:id/receipt/whatsapp` now uploads the PDF
   with `POST /{phone-number-id}/media` and sends it with
   `POST /{phone-number-id}/messages` as a `document` by media id. The file is
   given a `.pdf` filename and the receipt caption. If the upload fails, the
   server retries with the signed public link, so a temporary media outage does
   not block delivery.
6. WhatsApp failures are isolated: the endpoint returns `501`/`502` and leaves
   the payment and receipt untouched. The UI keeps the manual `wa.me` share and
   local PDF download available.

The PDF is generated on the server before the WhatsApp call; the browser never
receives the access token. All receipts are scoped by `gymId`, and both the
media upload and message send use the member's normalized phone number
(`+91` is assumed for bare 10-digit Indian numbers).

---

## Receipt UI surfaces

- **Settings → Receipt branding** edits the gym logo, name, tagline, address,
  phone, email, website, receipt prefix, authorised signatory, signature image,
  QR toggle and footer copy. The live preview uses the same payload as the PDF.
- **Add member** and **Pay bill** show the receipt dialog after a successful
  payment. It provides an on-screen preview, a rendered PDF preview tab,
  download, print, copy link and WhatsApp share. The dedicated
  `/members/add` page and the membership assign/renew drawer use the same
  dialog.
- **Payments** exposes **View receipt** for any historical successful payment.
- The receipt dialog is read-only: a payment is never edited from it, and a
  failed WhatsApp or PDF request never rolls back the payment.
