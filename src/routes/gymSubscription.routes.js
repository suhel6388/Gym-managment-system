// Gym subscription routes. Mounted at /api/v1/platform (and /api/platform).
//
// Owner reads are available to any authenticated gym session (so staff see the
// renewal banner). Money-moving and admin actions require the owner role or the
// platform SUPER_ADMIN role.

import { Router } from "express";

import {
  getGymDetailHandler,
  getGymSubscription,
  getMySubscriptionHandler,
  getMySubscriptionSummary,
  listGymAudit,
  updateGymSubscription,
} from "../controllers/gymSubscription.controller.js";
import { authenticate, requireGym } from "../middleware/auth.js";
import { requirePlatformAdmin } from "../middleware/requireRole.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

const adminMutationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyFn: (req) => req.user?.id || req.ip || "anonymous",
});

// ---------------------------------------------------------------------------
// Gym owner
// ---------------------------------------------------------------------------
router.get(
  "/subscription",
  authenticate,
  requireGym,
  getMySubscriptionHandler,
);
router.get(
  "/subscription/summary",
  authenticate,
  requireGym,
  getMySubscriptionSummary,
);

// ---------------------------------------------------------------------------
// Super admin
// ---------------------------------------------------------------------------
router.get(
  "/admin/gyms/:gymId",
  authenticate,
  requirePlatformAdmin,
  getGymDetailHandler,
);
router.get(
  "/admin/gyms/:gymId/subscription",
  authenticate,
  requirePlatformAdmin,
  getGymSubscription,
);
router.post(
  "/admin/gyms/:gymId/subscription",
  authenticate,
  requirePlatformAdmin,
  adminMutationLimit,
  updateGymSubscription,
);
router.get(
  "/admin/gyms/:gymId/audit",
  authenticate,
  requirePlatformAdmin,
  listGymAudit,
);

export default router;
