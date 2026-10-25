// Gym-owner subscription routes.
// Mounted at /api/v1/subscription
//
// gymId is derived from the authenticated user (req.user.gymId) — never from
// the request body. Sensitive endpoints are rate-limited.

import { Router } from "express";
import {
  getPlans,
  getMe,
  startTrial,
  checkout,
  verifyPayment,
  getHistory,
  cancelSubscription,
} from "../controllers/subscription.controller.js";
import { authenticate, requireGym, requirePermission, PERMISSION } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

// Public plan listing (no auth required).
router.get("/plans", getPlans);

// Authenticated gym endpoints.
router.use(authenticate, requireGym);

// Subscription status for the authenticated gym. Read-only, so staff can load
// the dashboard banner; billing changes below are owner-only.
router.get("/me", getMe);

// Start a free trial (rate-limited, idempotent).
router.post(
  "/trial",
  requirePermission(PERMISSION.MANAGE_SUBSCRIPTION),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyFn: (req) => req.user.id }),
  startTrial
);

// Create a payment order for a plan (rate-limited).
router.post(
  "/checkout",
  requirePermission(PERMISSION.MANAGE_SUBSCRIPTION),
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyFn: (req) => req.user.id }),
  checkout
);

// Verify a Razorpay payment and activate subscription.
router.post("/verify", requirePermission(PERMISSION.MANAGE_SUBSCRIPTION), verifyPayment);

// Payment and subscription history.
router.get("/history", requirePermission(PERMISSION.MANAGE_SUBSCRIPTION), getHistory);

// Cancel subscription.
router.post("/cancel", requirePermission(PERMISSION.MANAGE_SUBSCRIPTION), cancelSubscription);

export default router;
