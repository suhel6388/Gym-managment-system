# 🏋️ DarkGoldGym — Gym Management System (SaaS)

A multi-tenant **gym CRM backend** built with Node.js, Express and PostgreSQL. Gym owners can manage members, plans, memberships, attendance, payments and expenses. Platform owners can run the whole thing as a **SaaS business** with subscriptions, free trials and a super-admin console.

> **Prices are stored in paise** (₹499 = `49900`) to avoid floating-point errors.

---

## ✨ Features

### For gym owners and staff
- **Member management**: add, search, update and archive (soft delete) members, with auto-generated member codes (`MEM-0001`) and batch timing (morning / afternoon / evening)
- **Membership plans**: create plans with price and duration, then assign them to members
- **Memberships**: start, freeze and cancel, with automatic expiry tracking
- **Attendance**: reception check-in / check-out, one open session per member, history and today's summary (manual, QR code or biometric marking)
- **Payments and PDF receipts**: generate receipts with a QR code, share them through a short-lived public link, and optionally send them on **WhatsApp** (Meta Cloud API)
- **Expenses**: track gym expenses by category and date range
- **Dashboard and reports**: total members, active memberships, plans expiring in 7 days, today's collection and expenses, and a list of overdue memberships
- **Role-based access**: `ADMIN` (owner) has full access; `RECEPTIONIST` (staff) can only view and add data

### For the platform owner (SaaS)
- **Subscriptions and billing** with **Razorpay** (order creation, signature verification, webhooks)
- **14-day free trial** (configurable)
- **Super-admin console**: platform KPIs, searchable gym directory, assign plans, extend or end trials, suspend or reactivate gyms
- **Audit trail**: every admin action requires a reason and is logged in the same transaction
- **Schedule-a-call** endpoint for demo requests, rate-limited to one per IP per 24 hours

### Security
- Cookie-session auth with **Better Auth**: email + OTP verification, Google sign-in, password reset by link or OTP
- Every query is scoped by `gymId` taken from the session, never from the request body, so tenants cannot see each other's data
- Role and gym are re-loaded from the database on every request
- `helmet`, CORS allow-list, request validation with **Zod**, rate limiting on sensitive endpoints

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20+, Express 5 |
| Database | PostgreSQL (works with Supabase), Prisma ORM 7 |
| Auth | Better Auth (sessions, Google OAuth, email OTP) |
| Validation | Zod |
| Payments | Razorpay |
| Email | Nodemailer (SMTP) |
| Receipts | PDFKit + qrcode, optional WhatsApp Business Cloud API |
| Process manager | PM2 (`ecosystem.config.cjs`) |
| Tests | Node test runner via `tsx --test` |

---

## 📁 Folder Structure

```
Gym-managment-system/
├── prisma/                  # Prisma schema, migrations and seed script
│   └── seed.mjs
├── public/                  # Static assets
├── scripts/
│   ├── build-frontend.mjs   # Builds the frontend into the backend's static folder
│   └── make-super-admin.mjs # Creates or promotes the platform owner (CLI)
├── src/
│   ├── app.js               # Express app: middleware + route mounting (/api/v1/*)
│   ├── routes/              # Route definitions (auth, members, plans, attendance, ...)
│   ├── controllers/         # Request handlers
│   ├── services/            # Business logic (e.g. super-admin.service.js)
│   └── middleware/          # authenticate, permissions.js (role checks), rate limits
├── tests/                   # Automated tests (*.test.js)
├── server.js                # Entry point
├── prisma7.config.ts        # Prisma 7 configuration
├── ecosystem.config.cjs     # PM2 config for production
├── .env.example             # Environment variable template
├── API.md                   # Full API reference with request/response examples
├── DEPLOYMENT.md            # Deployment guide
├── SUBSCRIPTION_API_GUIDE.md# Subscription and billing guide
├── package.json
└── tsconfig.json
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js 20+** and npm
- A **PostgreSQL** database (local, or a hosted one like Supabase)

### 2. Clone and install
```bash
git clone https://github.com/suhel6388/Gym-managment-system.git
cd Gym-managment-system
npm install
```

### 3. Configure environment
```bash
cp .env.example .env
```
Open `.env` and fill in the values:

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `DIRECT_URL` | ✅ for migrations | Direct (non-pooled) connection string |
| `BETTER_AUTH_SECRET` | ✅ | Min 32 chars. Generate one with `openssl rand -base64 48` |
| `BETTER_AUTH_URL` | ✅ | Public URL of **this API**, e.g. `http://localhost:5000` |
| `CLIENT_ORIGIN` | ✅ | Frontend origin(s) allowed by CORS, e.g. `http://localhost:3000` |
| `PORT` | ❌ | Defaults to `5000` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ❌ | Enables Google sign-in |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | ❌ | Real OTP emails. Without them, OTPs are printed in the server console |
| `RECEIPT_PUBLIC_BASE_URL` | ❌ | Public API origin used in receipt links and the receipt QR code |
| `RECEIPT_LINK_SECRET` | ❌ | Signs public receipt links (falls back to `BETTER_AUTH_SECRET`) |
| `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | ❌ | Auto-send receipt PDFs on WhatsApp |

Razorpay keys are needed only if you want to test subscription checkout.

> ⚠️ Never commit your real `.env` file.

### 4. Set up the database
```bash
npx prisma generate
npm run prisma:migrate     # creates tables
npm run seed               # optional: loads seed data (e.g. subscription plans)
```

### 5. Run the server
```bash
npm run dev                # development (auto-reload)
# or
npm start                  # plain start
```

Check it is running:
```bash
curl http://localhost:5000/api/v1/health
# → { "status": "ok" }
```

### 6. Create the platform owner (one time)
```bash
SUPER_ADMIN_EMAIL=owner@yourdomain.com \
SUPER_ADMIN_PASSWORD='use-a-strong-12+-char-password' \
SUPER_ADMIN_NAME='Platform Owner' \
npm run bootstrap-super-admin
```
Then sign in at `POST /api/v1/auth/super-admin/login`. A maximum of **two** platform owner accounts is allowed.

---

## 📖 How to Use

### Gym owner flow
1. **Sign up**: `POST /api/v1/auth/signup`. A 6-digit OTP is emailed (or logged in the console in dev).
2. **Verify**: `POST /api/v1/auth/verify-email`. You are now signed in.
3. **Create your gym**: `POST /api/v1/auth/setup-gym`. The free trial starts automatically.
4. **Add plans**: `POST /api/v1/plans`
5. **Add members**: `POST /api/v1/members`
6. **Assign a membership**: `POST /api/v1/memberships`
7. **Record a payment** and get a PDF receipt: `POST /api/v1/payments`
8. **Daily attendance**: search a member, then check in / check out
9. **View reports**: `GET /api/v1/reports/dashboard`
10. **Add reception staff**: `POST /api/v1/staff/receptionists` (staff can view and add, but not edit or delete)

### Quick example
```bash
# Login and save the session cookie
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" -c cookies.txt \
  -d '{"email":"owner@example.com","password":"your-password"}'

# Add a member
curl -X POST http://localhost:5000/api/v1/members \
  -H "Content-Type: application/json" -b cookies.txt \
  -d '{"name":"Rahul Sharma","phone":"9876543210","gender":"male","dateOfBirth":"1998-04-21","timing":"MORNING"}'
```

From a browser app, always send `credentials: "include"` so the session cookie is used.

### Platform owner flow
Sign in with the super-admin login, then use `/api/v1/super-admin/*` to view platform stats, search gyms, assign or extend plans, manage trials and suspend or reactivate gyms.

---

## 🔌 API Overview

Base URL: `http://localhost:5000/api/v1`

| Area | Base path | Access |
|---|---|---|
| Auth | `/auth/*` | Public / session |
| Members | `/members` | Owner + staff (staff: view and add only) |
| Plans | `/plans` | Owner + staff |
| Memberships | `/memberships` | Owner + staff |
| Attendance | `/attendence/*` *(spelled with an "e" in the code)* | Owner + staff |
| Payments and receipts | `/payments` | Owner + staff |
| Expenses | `/expenses` | Owner + staff (edit/delete: owner only) |
| Reports | `/reports/*` | Owner + staff |
| Staff | `/staff/receptionists` | Owner only |
| Subscription / billing | `/subscription/*` | Owner |
| Razorpay webhook | `/subscription/webhooks/razorpay` | Razorpay |
| Schedule a call | `/schedule` | Public create; super-admin manage |
| Super admin | `/super-admin/*` | Super admin only |

👉 Full request/response details for every endpoint are in **[API.md](./API.md)**.

---

## 🧪 Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-reload (nodemon + tsx) |
| `npm start` | Start the server |
| `npm test` | Run the test suite |
| `npm run build` | Generate the Prisma client and build the frontend |
| `npm run prisma:migrate` | Create or apply migrations (dev) |
| `npm run prisma:studio` | Open Prisma Studio to browse data |
| `npm run seed` | Seed the database |
| `npm run bootstrap-super-admin` | Create or promote the platform owner |

---

## ☁️ Deployment

The backend runs well on **Render**, a VPS with **PM2**, or any Node host, with the frontend on **Vercel**. See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full guide. Key points:

- Set `BETTER_AUTH_URL` to the **API** origin, never the frontend origin
- Add every frontend origin to `CLIENT_ORIGIN`
- For Google sign-in, add `{BETTER_AUTH_URL}/api/auth/callback/google` as an authorized redirect URI
- Run `npx prisma migrate deploy` on production
- Some free hosts block outbound SMTP ports 25/465/587. Use port `2525` or an HTTP email API

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Commit using conventional commits: `feat(members): add bulk import`
4. Push and open a Pull Request

---

## 👤 Author

**Suhel** — [GitHub @suhel6388](https://github.com/suhel6388)

If this project helped you, consider giving it a ⭐
