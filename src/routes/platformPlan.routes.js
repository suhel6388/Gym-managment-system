// Platform plan routes. Mounted at /api/v1/platform (and /api/platform).
//
// Public: the plan catalogue and a price/coupon quote. A locked gym owner must
// be able to see prices before paying, so these do NOT require a subscription.
// Admin: full CRUD, status toggles, archive and the price audit trail.

import { Router } from "express";

import {
  createPlan,
  deletePlan,
  listPlanAudit,
  listPlans,
  listPlansAdmin,
  quotePlan,
  setPlanStatus,
  updatePlan,
} from "../controllers/platformPlan.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requirePlatformAdmin } from "../middleware/requireRole.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

const quoteLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  keyFn: (req) => req.user?.id || req.ip || "anonymous",
});

// ---------------------------------------------------------------------------
// Public catalogue
// ---------------------------------------------------------------------------
router.get("/plans", listPlans);
router.post("/plans/:id/quote", quoteLimit, quotePlan);

// ---------------------------------------------------------------------------
// Super-admin plan management
// ---------------------------------------------------------------------------
router.get("/admin/plans", authenticate, requirePlatformAdmin, listPlansAdmin);
router.post("/admin/plans", authenticate, requirePlatformAdmin, createPlan);
router.patch("/admin/plans/:id", authenticate, requirePlatformAdmin, updatePlan);
router.patch(
  "/admin/plans/:id/status",
  authenticate,
  requirePlatformAdmin,
  setPlanStatus,
);
router.delete("/admin/plans/:id", authenticate, requirePlatformAdmin, deletePlan);
router.get(
  "/admin/plans/:id/audit",
  authenticate,
  requirePlatformAdmin,
  listPlanAudit,
);

export default router;
