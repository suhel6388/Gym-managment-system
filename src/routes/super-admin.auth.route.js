// Platform-owner login, mounted at /api/v1/auth alongside the existing auth
// router. src/routes/auth.route.js stays untouched; this path is additive.

import { Router } from "express";

import { superAdminLogin } from "../controllers/super-admin.auth.controller.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.post(
  "/super-admin/login",
  // The limiter buckets in src/middleware/rateLimit.js are global, so the key
  // is prefixed to keep this budget separate from the bootstrap endpoint.
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many sign-in attempts. Try again later.",
    keyFn: (req) => `super-admin-login:${req.ip ?? "unknown"}`,
  }),
  superAdminLogin,
);

export default router;
