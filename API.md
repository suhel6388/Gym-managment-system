# Gym CRM API guide

This guide describes the backend routes mounted by `src/app.js` and the request validation currently present in the controllers.

## Contents

- [Setup and getting started](#setup-and-getting-started)
- [Base URL and requests](#base-url-and-requests)
- [Authentication](#authentication)
  - [`POST /api/v1/auth/signup`](#post-apiv1authsignup)
  - [`POST /api/v1/auth/verify-email`](#post-apiv1authverify-email)
  - [`POST /api/v1/auth/resend-otp`](#post-apiv1authresend-otp)
  - [`POST /api/v1/auth/google`](#post-apiv1authgoogle)
  - [`POST /api/v1/auth/login`](#post-apiv1authlogin)
  - [`POST /api/v1/auth/logout`](#post-apiv1authlogout)
  - [`GET /api/v1/auth/me`](#get-apiv1authme)
  - [`POST /api/v1/auth/setup-gym`](#post-apiv1authsetup-gym)
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
- [Role permissions](#role-permissions)
- [Dashboard and reports](#dashboard-and-reports)
  - [`GET /api/v1/reports/dashboard`](#get-apiv1reportsdashboard)
  - [`GET /api/v1/reports/due-memberships`](#get-apiv1reportsdue-memberships)
- [Error responses](#error-responses)
- [SaaS Subscription & Billing](#saas-subscription--billing)
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
| `BETTER_AUTH_URL` | Yes | Public backend URL, e.g. `http://localhost:5000` (used for OAuth callbacks) |
| `CLIENT_ORIGIN` | Yes | Comma-separated frontend origins allowed by CORS, e.g. `http://localhost:3000,http://localhost:5000` |
| `PORT` | No | Defaults to `5000` when unset |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For Google sign-in | From Google Cloud Console → APIs & Services → Credentials (OAuth client, Web application) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | For real OTP emails | Until set, OTPs are logged to the backend console (`[email:dev]`) instead of emailed |

### 3. Install, migrate, run

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev        # nodemon + tsx, serves on http://localhost:5000
```

Sanity check: `GET http://localhost:5000/api/v1/health` → `{ "status": "ok" }`.

### 4. Google sign-in setup (one time)

1. In Google Cloud Console, add the authorized redirect URI `{BETTER_AUTH_URL}/api/auth/callback/google` (locally: `http://localhost:5000/api/auth/callback/google`).
2. Put the client ID/secret in `.env` and restart the backend.
3. Frontend calls `POST /api/v1/auth/google`, then redirects the browser to the returned `url`.

### 5. Recommended frontend integration order

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

Email OTP delivery uses SMTP (`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` in `.env`, via nodemailer). Until those are set, OTPs are logged to the backend console for development.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/signup` | Create an account (sends a 6-digit OTP to the email) |
| `POST` | `/api/v1/auth/verify-email` | Verify the OTP (also signs the user in) |
| `POST` | `/api/v1/auth/resend-otp` | Send a fresh OTP |
| `POST` | `/api/v1/auth/google` | Start Google sign-in (returns the Google URL to redirect to) |
| `POST` | `/api/v1/auth/login` | Sign in with email and password (requires a verified email) |
| `POST` | `/api/v1/auth/logout` | Sign out (clears the session cookie) |
| `GET` | `/api/v1/auth/me` | Current user + gym info (`401` when signed out) |
| `POST` | `/api/v1/auth/setup-gym` | Create the user's gym (once per account) |

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
- Success (`201`) returns `{ "message", "user": { "id", "name", "email", ... } }`. No session cookie yet — a 6-digit OTP is emailed and must be verified first.
- **Already registered and verified:** `409` with `{ "code": "EMAIL_ALREADY_REGISTERED", "error": "An account with this email already exists" }`. The client should offer sign-in.
- **Already registered but not verified:** `200` with
  `{ "code": "EMAIL_NOT_VERIFIED", "requiresEmailVerification": true, "email", "message" }`.
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

- Sends a fresh code (invalidates the previous one). Always returns `200` with a generic message so accounts can't be enumerated.

### `POST /api/v1/auth/google`

```json
{
  "callbackURL": "http://localhost:3000/dashboard"
}
```

- `callbackURL` is optional (defaults to the first `CLIENT_ORIGIN`) and must belong to an allowed frontend origin.
- Success (`200`) returns `{ "url": "https://accounts.google.com/...", "redirect": ... }`. Redirect the browser to `url`:

```js
const res = await fetch(`${API_BASE}/auth/google`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ callbackURL: `${window.location.origin}/dashboard` })
});
const { url } = await res.json();
window.location.href = url; // Google consent -> back to callbackURL with a session
```

- Google verifies the email itself, so Google users skip the OTP step.
- Google Cloud Console must list this redirect URI: `http://localhost:5000/api/auth/callback/google` (i.e. `{BETTER_AUTH_URL}/api/auth/callback/google`).

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
  `{ "code": "EMAIL_NOT_VERIFIED", "error": "Email not verified. A new 6-digit code was sent to your email." }`.
  A fresh OTP is sent automatically; redirect the user to `/verify-email?email=...&reason=login`.

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

## Health

### `GET /api/v1/health`

Does not require authentication.

```json
{ "status": "ok" }
```
# Add Member API

Creates a new member inside the logged-in user's gym.

> **Note:** The route path below (`POST /api/members`) is an assumption. Change it to match however you mounted the router in your Express app.

---

## Endpoint

```
POST /api/members
```

## Authentication

Required. Send the auth token your app already uses (example assumes a Bearer JWT):

```
Authorization: Bearer <token>
```

The `gymId` is taken from the authenticated user (`req.user.gymId`). **Do not send `gymId` in the body.**

## Headers

| Header          | Value              |
| --------------- | ------------------ |
| `Content-Type`  | `application/json` |
| `Authorization` | `Bearer <token>`   |

## Request Body

| Field        | Type            | Required | Rules                                         |
| ------------ | --------------- | -------- | --------------------------------------------- |
| `memberCode` | string          | Yes      | 1-50 chars, trimmed, unique within the gym    |
| `name`       | string          | Yes      | 1-100 chars, trimmed                          |
| `phone`      | string          | Yes      | 7-20 chars, trimmed                           |
| `joinedAt`   | date string     | No       | ISO date, e.g. `2026-10-13`. Defaults to now  |
| `timing`     | enum `Timing`   | No       | Must be a value from your `Timing` enum. Defaults to `MORNING` |
| `notes`      | string or null  | No       | Max 2000 chars                                |

### Example body

```json
{
  "memberCode": "GYM-0101",
  "name": "Rahul Sharma",
  "phone": "9876543210",
  "joinedAt": "2026-10-13",
  "timing": "MORNING",
  "notes": "Prefers trainer in the morning batch"
}
```

Minimal body (only required fields):

```json
{
  "memberCode": "GYM-0102",
  "name": "Aman Verma",
  "phone": "9123456780"
}
```

---

## Examples

### cURL

```bash
curl -X POST http://localhost:5000/api/members \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "memberCode": "GYM-0101",
    "name": "Rahul Sharma",
    "phone": "9876543210",
    "timing": "MORNING"
  }'
```

### fetch (React / Vite / Next.js)

```javascript
async function addMember(token, member) {
  const res = await fetch("http://localhost:5000/api/members", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(member)
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.error || "Failed to add member");
  }

  return json.data;
}

// usage
const created = await addMember(token, {
  memberCode: "GYM-0101",
  name: "Rahul Sharma",
  phone: "9876543210"
});
```

### axios

```javascript
import axios from "axios";

const { data } = await axios.post(
  "http://localhost:5000/api/members",
  { memberCode: "GYM-0101", name: "Rahul Sharma", phone: "9876543210" },
  { headers: { Authorization: `Bearer ${token}` } }
);

console.log(data.data); // created member
```

---

## Responses

### 201 Created

```json
{
  "data": {
    "id": "cm2abc123xyz",
    "gymId": "cm1gym456",
    "memberCode": "GYM-0101",
    "name": "Rahul Sharma",
    "phone": "9876543210",
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

Happens when a required field is missing or breaks a rule (e.g. empty `name`, `phone` too short, invalid `timing`).

The exact error shape depends on your global error handler. A zod error typically looks like this if you pass `err.issues` through:

```json
{
  "error": "Validation failed",
  "issues": [
    { "path": ["phone"], "message": "String must contain at least 7 character(s)" }
  ]
}
```

### 401 Unauthorized

Missing or invalid token (returned by your auth middleware).

### 409 Conflict (duplicate member code)

A member with the same `memberCode` already exists in this gym.

```json
{
  "error": "A member with this member code already exists"
}
```

Archived members still hold their `memberCode`, so you also get a 409 if you reuse a code from an archived member.

### 500 Internal Server Error

Anything unexpected. Handled by your global error middleware.

---

## Related Endpoints

| Method   | Path               | Purpose                                          |
| -------- | ------------------ | ------------------------------------------------ |
| `GET`    | `/api/members`     | List members (`from`, `to`, `search`, `includeArchived` query params) |
| `PUT`    | `/api/members/:id` | Update a member (partial body allowed)           |
| `DELETE` | `/api/members/:id` | Archive a member (soft delete)                   |

---

## Quick Checklist

- Send a valid auth token
- Include `memberCode`, `name`, `phone`
- Keep `memberCode` unique per gym
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

`startDate` and `discountPaise` are optional. The end date is derived from the selected plan's duration. A successful create returns `201` and `{ "data": ... }`. Freeze and cancel return a message; missing/ineligible records return `404`.

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

All expense routes require an authenticated user with a gym. Deleting additionally requires the `OWNER`, `ADMIN`, or `ACCOUNTANT` role.

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

A gym `ADMIN` can create login accounts for reception staff. Receptionists belong to the same gym and can sign in with the normal login endpoint.

| Method | Path | Who | Description |
|---|---|---|---|
| `POST` | `/api/v1/staff/receptionists` | `ADMIN` only | Create a receptionist login |
| `GET` | `/api/v1/staff/receptionists` | `ADMIN` only | List staff in your gym |
| `DELETE` | `/api/v1/staff/receptionists/:id` | `ADMIN` only | Remove a receptionist |

All three routes need an authenticated session with a gym (`credentials: "include"`). A `RECEPTIONIST` calling them gets `403`.

### `POST /api/v1/staff/receptionists`

Create the account, then the receptionist logs in with `POST /api/v1/auth/login` like anyone else. No OTP step — the account is ready immediately.

```json
{
  "name": "Front Desk",
  "email": "desk@example.com",
  "password": "password123",
  "phone": "9876543210"
}
```

- `name` 2–100 chars, valid `email`, `password` 8–128 chars, `phone` optional (10–16 digits).
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
- Non-admin callers get `403`.

```bash
# 1. Admin creates the receptionist (admin cookies)
curl -X POST http://localhost:5000/api/v1/staff/receptionists \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"name":"Front Desk","email":"desk@example.com","password":"password123"}'

# 2. Receptionist logs in (own cookie jar)
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -c desk-cookies.txt \
  -d '{"email":"desk@example.com","password":"password123"}'

# 3. Receptionist daily work: allowed (GET + POST)
curl http://localhost:5000/api/v1/members -b desk-cookies.txt
curl -X POST http://localhost:5000/api/v1/attendence/check-in \
  -H "Content-Type: application/json" \
  -b desk-cookies.txt \
  -d '{"memberId":"member-id","attendanceDate":"2026-10-16"}'

# 4. Blocked for receptionists (403)
curl -X PATCH http://localhost:5000/api/v1/members/some-id \
  -H "Content-Type: application/json" \
  -b desk-cookies.txt \
  -d '{"phone":"9999999999"}'
```

```js
// Admin creates a receptionist
const res = await fetch(`${API_BASE}/staff/receptionists`, {
  method: "POST",
  credentials: "include", // admin session
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Front Desk", email: "desk@example.com", password: "password123" })
});
const { data } = await res.json(); // data.role === "RECEPTIONIST"
```

### `GET /api/v1/staff/receptionists`

Returns `{ "data": [...] }` with `{ id, name, email, phone, role, gymId, createdAt }` per staff member, newest first.

### `DELETE /api/v1/staff/receptionists/:id`

Removes a `RECEPTIONIST`. Returns `{ "message": "Receptionist removed" }`. Admins cannot delete themselves or other admins (`400`/`403`); unknown ids return `404`.

## Role permissions

| Capability | `ADMIN` | `RECEPTIONIST` |
|---|---|---|
| `GET` any gym data (members, plans, attendance, payments, expenses, reports) | Yes | Yes |
| `POST` (add member, check-in/out, create payment, membership, expense, plan) | Yes | Yes |
| `PATCH` / `PUT` (edit any record) | Yes | No — `403` |
| `DELETE` (archive member, deactivate plan, delete expense, remove receptionist) | Yes | No — `403` |
| Manage staff (`/api/v1/staff/*`) | Yes | No — `403` |

The rule lives in one place — `allowReadAndCreateOnly` in `src/middleware/auth.js` — and is applied to the member, plan, membership, payment, expense, and report routers. Enforcement is by HTTP method, so any future `PATCH`/`DELETE` added to those routers is blocked automatically.

```json
{ "error": "Receptionists can only view (GET) and add (POST) data" }
```

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
`/api/v1/subscription` (gym-owner) and `/api/v1/admin/subscription` (super-admin).

Authentication: Better Auth session cookie (`credentials: "include"`).

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
- **Super-admin flow** (requires `SUPER_ADMIN` role; promote via `tsx scripts/make-super-admin.mjs <email>`)
  - `GET /api/v1/admin/subscription/plans` — list all plans including inactive
  - `POST /api/v1/admin/subscription/plans` — create a plan
  - `PATCH /api/v1/admin/subscription/plans/:id` — update a plan
  - `PATCH /api/v1/admin/subscription/plans/:id/status` — activate or deactivate a plan (existing subscriptions keep their snapshotted terms)
  - `GET /api/v1/admin/subscription/gyms?q=...` — search gyms by name/email/phone
  - `GET /api/v1/admin/subscription/gyms/:gymId` — view a gym's subscription + payment + trial history
  - `POST /api/v1/admin/subscription/gyms/:gymId/extend-trial` — extend a trial with reason (audited)
  - `POST /api/v1/admin/subscription/gyms/:gymId/grant-access` — grant time-limited manual access with reason and expiry (audited)
  - `GET /api/v1/admin/subscription/settings` — read trial/billing settings
  - `PATCH /api/v1/admin/subscription/settings` — update trial duration, enabled status, cancellation policy, etc.
- **Security rules**
  - `gymId` is always derived from the authenticated session — never accepted from the request body
  - Only `SUPER_ADMIN` can create/edit/deactivate plans; gym owners cannot change prices or entitlements
  - Existing subscriptions preserve their original price when a plan price changes
  - Deactivating a plan does not cancel existing subscriptions
  - Expired trials/paid subscriptions return `402 SUBSCRIPTION_REQUIRED` on protected gym-management routes
  - `CANCELLED` with `cancelAtPeriodEnd` keeps access until the period ends

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
All require the `SUPER_ADMIN` role (never assignable from client input;
promote via `tsx scripts/make-super-admin.mjs <email>`).

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
| Other `/api/v1/subscription/*` | `authenticate` + `requireGym` | gym OWNER / ADMIN / RECEPTIONIST |
| `/api/v1/subscription/webhooks/razorpay` | HMAC signature only | Razorpay servers (no session) |
| `/api/v1/admin/subscription/*` | `authenticate` + `requireSuperAdmin` | SUPER_ADMIN only — gym roles get `403 SUPER_ADMIN_REQUIRED` |

`gymId` is always derived from the authenticated session server-side — never
from the request body — so a caller can never act on another gym. The `role`
field is not assignable from client input; promote an admin out-of-band with
`npx tsx scripts/make-super-admin.mjs admin@example.com`.

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
`SubscriptionAuditLog` entry. Promote first with
`npx tsx scripts/make-super-admin.mjs <email>` and use `admin-cookies.txt`
for all calls below.

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

### 5. Super-admin (promote first, out of band)

```bash
tsx scripts/make-super-admin.mjs superadmin@example.com
```

Then use `admin-cookies.txt` for all `/api/v1/admin/subscription/*` endpoints. Every admin endpoint requires the `SUPER_ADMIN` role (gym OWNER/ADMIN/RECEPTIONIST are rejected).

| Action | Example |
|--------|---------|
| List all plans (incl. inactive) | `GET /api/v1/admin/subscription/plans` |
| Create plan | `POST /api/v1/admin/subscription/plans` `{code, name, pricePaise, durationMonths, ...}` |
| Activate/deactivate plan | `PATCH /api/v1/admin/subscription/plans/:id/status` `{isActive: bool}` |
| Search gyms | `GET /api/v1/admin/subscription/gyms?q=downtown&page=1&limit=20` |
| View gym subscription + history | `GET /api/v1/admin/subscription/gyms/:gymId` |
| Extend trial (audited) | `POST /api/v1/admin/subscription/gyms/:gymId/extend-trial` `{additionalDays, reason}` |
| Grant manual access (audited) | `POST /api/v1/admin/subscription/gyms/:gymId/grant-access` `{expiresAt, reason}` |
| Read settings | `GET /api/v1/admin/subscription/settings` |
| Update settings | `PATCH /api/v1/admin/subscription/settings` `{trialDurationDays, trialEnabled, ...}` |

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

Covers trial eligibility, concurrency-safe duplicate-trial prevention, plan super-admin permissions, tenant isolation, checkout using DB price, and server-side expiry/entitlement calculation.

Expected: `✔ pass 25  ✔ fail 0`.

---

## Current integration blockers

Do not build frontend flows against these routes until their backend handlers and Prisma schema are aligned:

- `/api/v1/members` currently invokes expense handlers and reads/writes expenses, not members.
- `/api/v1/payments` currently invokes membership handlers; it does not create or list payments.
- The membership controller uses `FROZEN` and `CANCELLED` statuses, but the Prisma `MembershipStatus` enum currently defines only `ACTIVE`, `EXPIRED`, and `INACTIVE`.
- The dashboard aggregates `amountPaise` on payments, while the Prisma `Payment` model currently defines `amount`.

These discrepancies are noted so the frontend does not mistake the existing route names for working member/payment APIs or assume the documented expense shape can currently be persisted.
