// Mounted at /api/v1/auth alongside the existing auth router. Keeping this in
// its own file means src/routes/auth.route.js is untouched; the new path is
// purely additive.

import { Router } from "express";
import {
  bootstrapSuperAdmin,
  requireBootstrapAccess,
} from "../controllers/super-admin.bootstrap.controller.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.post(
  "/bootstrap-super-admin",
  // Caps secret guessing and accidental retry storms. Keyed by IP because the
  // caller has no session yet.
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: "Too many bootstrap attempts. Try again later.",
  }),
  requireBootstrapAccess,
  bootstrapSuperAdmin,
);

export default router;
