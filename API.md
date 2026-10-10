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
