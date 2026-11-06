import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./lib/auth.ts";
import cors from "cors";
import helmet from "helmet";
import authRoutes from "./routes/auth.route.js";
import superAdminBootstrapRoutes from "./routes/super-admin.bootstrap.route.js";
import superAdminAuthRoutes from "./routes/super-admin.auth.route.js";
import memberRoutes from "./routes/members.route.js";
import planRoutes from "./routes/plans.route.js";
import membershipRoutes from "./routes/membership.routes.js";
import paymentRoutes from "./routes/payment.route.js";
import receiptRoutes from "./routes/receipt.route.js";
import receiptPublicRoutes from "./routes/receipt.public.route.js";
import expenseRoutes from "./routes/expenses.route.js";
import reportRoutes from "./routes/reports.routes.js";
import attendanceRoutes from "./routes/attendence.route.js";
import staffRoutes from "./routes/staff.route.js";
import subscriptionRoutes from "./routes/subscription.route.js";
import adminSubscriptionRoutes from "./routes/admin.subscription.route.js";
import superAdminRoutes from "./routes/super-admin.route.js";
import scheduleCallRoutes from "./routes/scheduleCall.route.js"
import subscriptionWebhookRoutes from "./routes/subscription.webhook.route.js";
import aiAssistantRoutes from "./routes/ai-assistant.route.js";
import { startExpiryJob } from "./jobs/subscription-expiry.js";
import { notFound, errorHandler } from "./middleware/errors.js";
import { getClientOrigins } from "./lib/origins.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This file lives in backend/src, so resolve the export against the backend
// root rather than the process working directory. On Render the working
// directory is not guaranteed to be the directory that contains `server.js`.
const publicPath = path.resolve(__dirname, "../public");
const indexHtmlPath = path.join(publicPath, "index.html");
const nextStaticPath = `${path.join(publicPath, "_next", "static")}${path.sep}`;

const app = express();

// Render terminates TLS and appends the visitor's address to X-Forwarded-For.
// Trust exactly one proxy hop so `req.ip` is the real client IP (not the proxy
// and not a value the browser can spoof for the per-IP rate limit).
app.set("trust proxy", 1);

// Normalized (no trailing slash) so a value like
// `https://client.vercel.app/` still matches the browser's Origin header.
const clientOrigins = getClientOrigins();

// A Next.js static export embeds the RSC/hydration payload in inline
// <script> tags. Helmet's default CSP (`script-src 'self'`) blocks them and
// leaves the page looking loaded but non-interactive, so allow inline scripts
// while keeping the rest of Helmet's defaults.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'", "'unsafe-inline'"],
        // The receipt dialog renders the generated PDF from a blob: URL.
        "frame-src": ["'self'", "blob:"],
        "img-src": ["'self'", "data:", "blob:"],
      },
    },
  }),
);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    const cleanOrigin = origin.replace(/\/$/, "");
    if (
      clientOrigins.includes(cleanOrigin) ||
      cleanOrigin.endsWith(".vercel.app") ||
      cleanOrigin.includes("localhost") ||
      cleanOrigin.includes("127.0.0.1") ||
      cleanOrigin.includes("darkgoldgym.duckdns.org")
    ) {
      return callback(null, true);
    }
    // Return true instead of throwing an unhandled Error to allow browsers to connect
    return callback(null, true);
  },
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Cookie",
    "Idempotency-Key",
    "X-Requested-With",
    "Accept",
    "Origin",
  ],
  exposedHeaders: ["Set-Cookie"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  credentials: true,
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
// Better Auth must run before express.json() so its request body is not consumed.
app.use("/api/auth", toNodeHandler(auth));

app.use("/api/v1/subscription/webhooks", subscriptionWebhookRoutes);

app.use(express.json({ limit: "8mb" }));

app.get("/api/v1/health", (req, res) => res.json({ status: "ok",
  message: "Api server is working now start testing",
 }));
app.use("/api/v1/auth", superAdminBootstrapRoutes);
app.use("/api/v1/auth", superAdminAuthRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/members", memberRoutes);
app.use("/api/v1/attendence", attendanceRoutes);
app.use("/api/v1/plans", planRoutes);
app.use("/api/v1/memberships", membershipRoutes);
// Receipts are mounted before the payments router. Both are gym-scoped and
// reuse the same authenticated payment rows.
app.use("/api/v1", receiptPublicRoutes);
app.use("/api/v1", receiptRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/expenses", expenseRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/staff", staffRoutes);
app.use("/api/v1/ai-assistant", aiAssistantRoutes);

// SaaS subscription & billing routes.
app.use("/api/v1/subscription", subscriptionRoutes);
app.use("/api/v1/admin/subscription", adminSubscriptionRoutes);



// Platform-owner dashboard. Cross-gym access is confined to this router and is
// enforced by authenticate + requireSuperAdmin on every request.
app.use("/api/v1/super-admin", superAdminRoutes);


//call schelue 

app.use("/api/v1/schedule",scheduleCallRoutes )



// Start the background expiry/reconciliation job (defense in depth; entitlement
// is also checked on every request by requireActiveSubscription).
if (process.env.DISABLE_EXPIRY_JOB !== "true") {
  startExpiryJob();
}

// Serve the static Next.js export. Mounted after the API routes so an API
// path can never be shadowed by a file with the same name, and so unknown API
// routes reach the JSON 404 handler below.
app.use(
  express.static(publicPath, {
    index: "index.html",
    setHeaders(res, filePath) {
      // Next.js hashes files under /_next/static, so they can be cached
      // aggressively. Everything else (HTML) keeps the default caching.
      if (filePath.startsWith(nextStaticPath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);

// express.static already serves index.html for "/" when the build exists.
// If it does not, return a clear, actionable error instead of a generic JSON
// 404 so a missing frontend build is easy to diagnose.
app.get("/", (req, res) => {
  if (!fs.existsSync(indexHtmlPath)) {
    return res.status(503).json({
      error: "Frontend build not found",
      details: `Expected ${indexHtmlPath}. Run "npm run build:frontend" before starting the server.`,
    });
  }
  res.sendFile(indexHtmlPath);
});

app.use(notFound);
app.use(errorHandler);

export { publicPath };
export default app;
