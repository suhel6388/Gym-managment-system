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
- [Dashboard and reports](#dashboard-and-reports)
  - [`GET /api/v1/reports/dashboard`](#get-apiv1reportsdashboard)
  - [`GET /api/v1/reports/due-memberships`](#get-apiv1reportsdue-memberships)
- [Error responses](#error-responses)
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

1. `POST /api/v1/auth/signup` → read the OTP from the user's email (or the backend console in dev).
2. `POST /api/v1/auth/verify-email` → user is now signed in (session cookie set).
3. `GET /api/v1/auth/me` → if `user.gymId` is `null`, call `POST /api/v1/auth/setup-gym`.
4. Use the gym APIs (members, plans, memberships, attendance, expenses, reports) with `credentials: "include"`.
5. On app load, call `GET /api/v1/auth/me`: `401` → show login; `gymId: null` → show gym setup; otherwise → show the dashboard.

> **Note:** login is blocked until the email is verified (`403` + a fresh OTP is sent). Google sign-in skips OTP because Google verifies the email.

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
  "password": "password123"
}
```

- `name` 2–100 chars, valid `email`, `password` 8–128 chars.
- Success (`201`) returns `{ "message", "user": { "id", "name", "email", ... } }`. No session cookie yet — a 6-digit OTP is emailed and must be verified first.
- Duplicate email returns `409` with `{ "error": "An account with this email already exists" }`.

```bash
curl -X POST http://localhost:5000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"name":"Aarav Patel","email":"owner@example.com","password":"password123"}'
```

```js
const res = await fetch(`${API_BASE}/auth/signup`, {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Aarav Patel", email: "owner@example.com", password: "password123" })
});
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
- Unverified email returns `403` with `{ "error": "Email not verified. A new code was sent to your email." }` (a fresh OTP is sent automatically).

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
    "user": { "id": "...", "name": "...", "email": "...", "gymId": null, "role": "ADMIN" },
    "session": { "...": "..." }
  }
}
```

- `401` when there is no session. `gymId: null` means the user still needs `setup-gym`.

After signing in, create a gym:

### `POST /api/v1/auth/setup-gym`

Requires an authenticated session. A user who already belongs to a gym receives `409`.

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

`amountPaise` is required and must be a non-negative integer; other fields are optional. `PATCH` accepts a partial body. Successful list/create/update responses use `{ "data": ... }`; create returns `201`; delete returns `{ "message": "Expense deleted" }`.

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

## Current integration blockers

Do not build frontend flows against these routes until their backend handlers and Prisma schema are aligned:

- `/api/v1/members` currently invokes expense handlers and reads/writes expenses, not members.
- `/api/v1/payments` currently invokes membership handlers; it does not create or list payments.
- The expense validator uses `title` and `notes`, but the Prisma `Expense` model uses `name` and `description` and requires `name`, `category`, `paymentMode`, and `amountPaise`. Expense writes can therefore fail validation at the database layer.
- The membership controller uses `FROZEN` and `CANCELLED` statuses, but the Prisma `MembershipStatus` enum currently defines only `ACTIVE`, `EXPIRED`, and `INACTIVE`.
- The dashboard aggregates `amountPaise` on payments, while the Prisma `Payment` model currently defines `amount`.

These discrepancies are noted so the frontend does not mistake the existing route names for working member/payment APIs or assume the documented expense shape can currently be persisted.
