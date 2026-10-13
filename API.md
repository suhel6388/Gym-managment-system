# Gym CRM API guide

This guide describes the backend routes mounted by `src/app.js` and the request validation currently present in the controllers.

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

Better Auth is mounted at `/api/auth/*` (outside the `/api/v1` prefix). It handles sign-up, sign-in, sign-out, and session operations. For a frontend application, use the Better Auth client configured with the backend URL and credentials rather than implementing its endpoints manually.

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
