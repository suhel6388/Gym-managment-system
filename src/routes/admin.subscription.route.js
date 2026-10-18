// Super-admin subscription routes.
// Mounted at /api/v1/admin/subscription
//
// Every route requires authenticate + requireSuperAdmin. Gym OWNER/ADMIN/
// RECEPTIONIST users are rejected.

import { Router } from "express";
import {
  listPlansAdmin,
  createPlanAdmin,
  updatePlanAdmin,
  setPlanStatusAdmin,
  searchGymsAdmin,
  getGymSubscriptionAdmin,
  extendTrialAdmin,
  grantAccessAdmin,
  readSettingsAdmin,
  updateSettingsAdmin,
} from "../controllers/admin.subscription.controller.js";
import { authenticate } from "../middleware/auth.js";
import { requireSuperAdmin } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.use(authenticate, requireSuperAdmin);

// Plan management (all plans, including inactive).
router.get("/plans", listPlansAdmin);
router.post(
  "/plans",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyFn: (req) => req.user.id }),
  createPlanAdmin
);
router.patch("/plans/:id", updatePlanAdmin);
router.patch("/plans/:id/status", setPlanStatusAdmin);

// Gym subscription management.
router.get("/gyms", searchGymsAdmin);
router.get("/gyms/:gymId", getGymSubscriptionAdmin);
router.post(
  "/gyms/:gymId/extend-trial",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyFn: (req) => req.user.id }),
  extendTrialAdmin
);
router.post(
  "/gyms/:gymId/grant-access",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyFn: (req) => req.user.id }),
  grantAccessAdmin
);

// Settings.
router.get("/settings", readSettingsAdmin);
router.patch("/settings", updateSettingsAdmin);

export default router;
