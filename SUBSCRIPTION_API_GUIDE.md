# Gym CRM SaaS Subscription — API Usage Guide

This guide walks through the complete subscription and billing flow for a gym owner
and the SaaS super-admin, with real cURL examples you can run against a local
backend (`http://localhost:5000`).

All prices are stored in **integer paise** (₹499 = 49900). Authentication uses the
Better Auth session cookie — always send `credentials: "include"` (browser) or
`-c cookies.txt -b cookies.txt` (cURL).

---

## 0. Prerequisites

```bash
# 1. Install dependencies
npm install

# 2. Generate Prisma client
npx prisma generate

# 3. Run migrations (already applied to your Supabase DB, safe to re-run)
npx prisma migrate dev

# 4. Seed the four default plans + trial settings (idempotent — safe to repeat)
npm run seed

# 5. Start the server
npm run dev
```

Expected seed output:
```
Seed complete: 4 SaaS plan(s) in database, subscription settings ready.
```

Plans seeded:

| Code | Name | Price | Duration |
|------|------|-------|----------|
| MONTHLY | Monthly | ₹499 (49900 paise) | 1 month |
| QUARTERLY | Quarterly | ₹1,399 (139900 paise) | 3 months |
| HALF_YEARLY | Half-yearly | ₹2,799 (279900 paise) | 6 months |
| ANNUAL | Annual | ₹4,699 (469900 paise) | 12 months |

---

## 1. Gym owner flow (end to end)

### Step A: Sign up, verify email, create gym

```bash
# Signup
curl -X POST http://localhost:5000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"name":"Aarav Patel","email":"owner@example.com","password":"password123"}'

# Verify email (use the 6-digit OTP from the email/console)
curl -X POST http://localhost:5000/api/v1/auth/verify-email \
  -H "Content-Type: application/json" \
  -c cookies.txt -b cookies.txt \
  -d '{"email":"owner@example.com","otp":"123456"}'

# Create the gym (this also auto-starts the 14-day free trial if trials are enabled)
curl -X POST http://localhost:5000/api/v1/auth/setup-gym \
  -H "Content-Type: application/json" \
  -c cookies.txt -b cookies.txt \
  -d '{"name":"Downtown Fitness","phone":"+91 98765 43210","email":"hello@example.com"}'
```

Response from `setup-gym` (201):
```json
{
  "data": { "id": "gym_abc123", "name": "Downtown Fitness", "phone": "+91 98765 43210" },
  "message": "Gym created. You can now use the gym management APIs."
}
```

### Step B: Check the gym's subscription (trial)

```bash
curl http://localhost:5000/api/v1/subscription/me \
  -b cookies.txt
```

Response (200) — trial active:
```json
{
  "data": {
    "subscription": {
      "id": "sub_xyz",
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

- `entitled: true` → gym can use paid features (members, plans, attendance, etc.)
- `remainingDays: 14` → whole days until the trial expires (calculated server-side)
- When `entitled` becomes `false`, protected gym APIs return `402 SUBSCRIPTION_REQUIRED`

### Step C: List available plans

```bash
curl http://localhost:5000/api/v1/subscription/plans \
  -b cookies.txt
```

Response (200):
```json
{
  "data": [
    { "id": "...", "code": "MONTHLY", "name": "Monthly", "pricePaise": 49900, "currency": "INR", "durationMonths": 1, "isActive": true, "features": ["Unlimited members", ...], "maxStaff": 2, "maxBranches": 1 },
    { "id": "...", "code": "QUARTERLY", "name": "Quarterly", "pricePaise": 139900, "currency": "INR", "durationMonths": 3, ... },
    { "id": "...", "code": "HALF_YEARLY", "name": "Half-yearly", "pricePaise": 279900, "currency": "INR", "durationMonths": 6, ... },
    { "id": "...", "code": "ANNUAL", "name": "Annual", "pricePaise": 469900, "currency": "INR", "durationMonths": 12, ... }
  ]
}
```

### Step D: Create a payment order (checkout)

Pick a `planId` from the plan list above.

```bash
PLAN_ID="<paste-the-monthly-plan-id>"

curl -X POST http://localhost:5000/api/v1/subscription/checkout \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d "{\"planId\":\"$PLAN_ID\"}"
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

- `keyId` is the **public** Razorpay key id — safe to pass to the frontend Razorpay Checkout.
- `amount` comes from the database (never trust a client-supplied price).

### Step E: Pay via Razorpay (frontend)

On the frontend, open Razorpay Checkout with:

```js
const options = {
  key: "rzp_test_...",           // keyId from checkout response
  amount: 49900,                 // paise
  currency: "INR",
  order_id: "order_rAz123",      // orderId from checkout response
  handler: async (response) => {
    // response.razorpay_payment_id, response.razorpay_order_id, response.razorpay_signature
    await fetch("/api/v1/subscription/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: response.razorpay_order_id,
        paymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
      }),
    });
  },
};
const rzp = new Razorpay(options);
rzp.open();
```

> ⚠️ Never activate a subscription from the browser success callback alone. Always call `POST /api/v1/subscription/verify`, which verifies the signature **and** checks the payment against Razorpay server-side.

### Step F: Verify payment and activate subscription

```bash
curl -X POST http://localhost:5000/api/v1/subscription/verify \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"orderId":"order_rAz123","paymentId":"pay_xyz","signature":"..."}'
```

Response (200):
```json
{
  "data": {
    "subscription": {
      "id": "sub_xyz",
      "status": "ACTIVE",
      "plan": { "id": "...", "name": "Monthly", "pricePaise": 49900, ... },
      "pricePaise": 49900,
      "currency": "INR",
      "currentPeriodStart": "2026-10-18T10:00:00.000Z",
      "currentPeriodEnd": "2026-11-18T10:00:00.000Z",
      "paymentProvider": "razorpay"
    },
    "payment": { "id": "payord_abc", "status": "SUCCESS", "verifiedAt": "2026-10-18T10:05:00.000Z" },
    "alreadyVerified": false
  },
  "message": "Subscription activated"
}
```

The gym is now `ACTIVE` until `currentPeriodEnd`. Re-calling verify is idempotent (`alreadyVerified: true`).

### Step G: View subscription and payment history

```bash
curl http://localhost:5000/api/v1/subscription/history \
  -b cookies.txt
```

Response (200):
```json
{
  "data": {
    "subscription": { ... },
    "payments": [
      {
        "id": "payord_abc",
        "planId": "plan_m",
        "amountPaise": 49900,
        "currency": "INR",
        "status": "SUCCESS",
        "provider": "razorpay",
        "orderId": "order_rAz123",
        "paymentId": "pay_xyz",
        "verifiedAt": "2026-10-18T10:05:00.000Z",
        "createdAt": "2026-10-18T10:00:00.000Z"
      }
    ]
  }
}
```

### Step H: Cancel subscription

Default policy: cancel at end of the paid period — access continues until `currentPeriodEnd`.

```bash
curl -X POST http://localhost:5000/api/v1/subscription/cancel \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{}'
```

Response (200):
```json
{
  "data": {
    "subscriptionId": "sub_xyz",
    "status": "CANCELLED",
    "cancelAtPeriodEnd": true,
    "currentPeriodEnd": "2026-11-18T10:00:00.000Z",
    "cancelledAt": "2026-10-18T10:30:00.000Z",
    "alreadyCancelled": false
  },
  "message": "Subscription will end at the end of the current billing period"
}
```

---

## 2. Super-admin flow

Promote yourself first (out-of-band — the role cannot be assigned from the frontend):

```bash
tsx scripts/make-super-admin.mjs superadmin@example.com
```

All admin endpoints require `authenticate` + `SUPER_ADMIN`.

### List all plans (including inactive)

```bash
curl http://localhost:5000/api/v1/admin/subscription/plans \
  -b admin-cookies.txt
```

### Create a plan

```bash
curl -X POST http://localhost:5000/api/v1/admin/subscription/plans \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{
    "code": "MONTHLY",
    "name": "Monthly",
    "pricePaise": 49900,
    "currency": "INR",
    "durationMonths": 1,
    "features": ["Unlimited members", "Attendance tracking"],
    "maxStaff": 2,
    "maxBranches": 1,
    "isActive": true
  }'
```

### Deactivate a plan (existing subscriptions keep their terms)

```bash
curl -X PATCH http://localhost:5000/api/v1/admin/subscription/plans/<plan-id>/status \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"isActive":false}'
```

### Search gyms

```bash
curl "http://localhost:5000/api/v1/admin/subscription/gyms?q=downtown&page=1&limit=20" \
  -b admin-cookies.txt
```

### View a gym's subscription + payment + trial history

```bash
curl http://localhost:5000/api/v1/admin/subscription/gyms/<gym-id> \
  -b admin-cookies.txt
```

### Extend a trial (audited)

```bash
curl -X POST http://localhost:5000/api/v1/admin/subscription/gyms/<gym-id>/extend-trial \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"additionalDays":7,"reason":"Customer support issue"}'
```

### Grant manual time-limited access (audited)

```bash
curl -X POST http://localhost:5000/api/v1/admin/subscription/gyms/<gym-id>/grant-access \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"expiresAt":"2026-12-31T00:00:00Z","reason":"Promotional grace period"}'
```

### Read / update trial & billing settings

```bash
# Read
curl http://localhost:5000/api/v1/admin/subscription/settings \
  -b admin-cookies.txt

# Update
curl -X PATCH http://localhost:5000/api/v1/admin/subscription/settings \
  -H "Content-Type: application/json" \
  -b admin-cookies.txt \
  -d '{"trialDurationDays":30,"trialEnabled":true,"cancellationPolicy":"END_OF_PERIOD"}'
```

---

## 3. Error responses

All errors use a consistent shape:

```json
{ "error": "Human readable message", "code": "MACHINE_CODE" }
```

Common codes:

| Status | Code | Meaning |
|--------|------|---------|
| 401 | — | Authentication required |
| 403 | `SUPER_ADMIN_REQUIRED` | Gym user tried an admin-only endpoint |
| 403 | `TRIALS_DISABLED` | Platform has disabled free trials |
| 402 | `SUBSCRIPTION_REQUIRED` | Trial/paid subscription expired; pay to continue |
| 404 | `PLAN_NOT_FOUND` / `SUBSCRIPTION_NOT_FOUND` | Record missing |
| 409 | `TRIAL_ALREADY_USED` / `TRIAL_ALREADY_STARTED` | Duplicate trial attempt |
| 429 | `RATE_LIMITED` | Too many requests on a sensitive endpoint |
| 400 | `SIGNATURE_INVALID` / `AMOUNT_MISMATCH` | Payment verification failed |

Expired-state example (`402`):
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

---

## 4. Entitlement & protected features

These gym-management routes check the subscription on **every request** (not just a background job):

- `GET/POST/PATCH/DELETE /api/v1/members`
- `GET/POST/PATCH /api/v1/plans` (gym's own membership plans)
- `GET/POST /api/v1/memberships`
- `POST /api/v1/attendence/check-in`, `/check-out`, ...
- `GET/POST/PATCH/DELETE /api/v1/expenses`
- `GET /api/v1/reports/dashboard`, `/due-memberships`
- `GET/POST/DELETE /api/v1/staff/receptionists`

When the trial or paid period expires, these routes return `402 SUBSCRIPTION_REQUIRED`.

Always accessible (even when expired):
- Login, `/api/v1/auth/me`, gym setup
- `GET /api/v1/subscription/plans`, `/me`, `/history`
- `POST /api/v1/subscription/trial`, `/checkout`, `/verify`, `/cancel`

A `CANCELLED` subscription with `cancelAtPeriodEnd: true` keeps access until `currentPeriodEnd` (not immediately revoked).

---

## 5. Webhook (Razorpay)

Register this URL in the Razorpay dashboard:

```
POST https://your-backend.com/api/v1/subscription/webhooks/razorpay
```

Required env vars:
```
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
```

The webhook:
- Verifies `X-Razorpay-Signature` against the **raw request body**
- Deduplicates events via `SubscriptionWebhookEvent` (re-deliveries are skipped)
- `payment.captured` / `payment.authorized` → verifies amount & currency against Razorpay, then activates the subscription
- `payment.failed` → marks payment `FAILED`
- `refund.processed` → marks payment `REFUNDED`, subscription `PAST_DUE`
- `charge.disputed` → marks payment `DISPUTED`

---

## 6. Running tests

```bash
npm test
```

Covers: trial eligibility, concurrency-safe duplicate-trial prevention, plan super-admin permissions, tenant isolation, checkout using DB price, and server-side expiry/entitlement calculation.

Expected:
```
✔ tests 25
✔ pass 25
✔ fail 0
```

---

## 7. Quick cURL cheat sheet

```bash
# Cookie jar for a gym owner
API=http://localhost:5000/api/v1

# 1. Plans
curl $API/subscription/plans -b c.txt

# 2. My subscription (shows remainingDays + expiresAt)
curl $API/subscription/me -b c.txt

# 3. Start trial
curl -X POST $API/subscription/trial -b c.txt -d '{}'

# 4. Checkout (replace PLAN_ID)
curl -X POST $API/subscription/checkout -b c.txt -H "Content-Type: application/json" -d "{\"planId\":\"PLAN_ID\"}"

# 5. Verify (replace values from Razorpay handler)
curl -X POST $API/subscription/verify -b c.txt -H "Content-Type: application/json" -d '{"orderId":"...","paymentId":"...","signature":"..."}'

# 6. History
curl $API/subscription/history -b c.txt

# 7. Cancel
curl -X POST $API/subscription/cancel -b c.txt -d '{}'

# Admin (requires SUPER_ADMIN cookie)
curl $API/admin/subscription/plans -b admin.txt
curl -X PATCH $API/admin/subscription/settings -b admin.txt -H "Content-Type: application/json" -d '{"trialDurationDays":14}'
```
