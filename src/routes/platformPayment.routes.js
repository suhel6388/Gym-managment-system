// Platform payment routes. Mounted at /api/v1/platform (and /api/platform).
//
// Owner endpoints derive gymId from the authenticated user. Amounts are only
// ever computed server-side. Sensitive endpoints are rate-limited per user.

import { Router } from "express";

import {
  createOrder,
  getMyPayments,
  getPayment,
  listPayments,
  verifyPayment,
} from "../controllers/platformPayment.controller.js";
import { authenticate, requireGym, requirePermission, PERMISSION } from "../middleware/auth.js";
import { requirePlatformAdmin } from "../middleware/requireRole.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

const createOrderLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyFn: (req) => req.user?.id || req.ip || "anonymous",
});

const verifyLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  keyFn: (req) => req.user?.id || req.ip || "anonymous",
});

// ---------------------------------------------------------------------------
// Gym owner
// ---------------------------------------------------------------------------
router.post(
  "/payments/create-order",
  authenticate,
  requireGym,
  requirePermission(PERMISSION.MANAGE_SUBSCRIPTION),
  createOrderLimit,
  createOrder,
);

router.post(
  "/payments/verify",
  authenticate,
  requireGym,
  requirePermission(PERMISSION.MANAGE_SUBSCRIPTION),
  verifyLimit,
  verifyPayment,
);

router.get(
  "/payments",
  authenticate,
  requireGym,
  requirePermission(PERMISSION.MANAGE_SUBSCRIPTION),
  getMyPayments,
);

// ---------------------------------------------------------------------------
// Super admin
// ---------------------------------------------------------------------------
router.get(
  "/admin/payments",
  authenticate,
  requirePlatformAdmin,
  listPayments,
);
router.get(
  "/admin/payments/:paymentId",
  authenticate,
  requirePlatformAdmin,
  getPayment,
);

export default router;
