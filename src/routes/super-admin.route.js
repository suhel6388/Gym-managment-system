// Platform (SaaS owner) dashboard routes.
// Mounted at /api/v1/super-admin.
//
// SECURITY: every route is guarded by authenticate + requireSuperAdmin.
// `authenticate` reads the role from the database on each request, so a client
// cannot claim SUPER_ADMIN. Gym owners and receptionists always receive 403.
//
// This router is the only API surface allowed to query across gyms. Gym-scoped
// routers continue to derive gymId from req.user.gymId.

import { Router } from "express";

import {
  getStats,
  getGyms,
  getGym,
  getPlans,
  assignGymPlan,
  extendGymExpiry,
  startGymTrial,
  endGymTrial,
  updateGymAccess,
  getActivity,
} from "../controllers/super-admin.controller.js";
import { createAdmin } from "../controllers/super-admin.accounts.controller.js";
import { authenticate, requireSuperAdmin } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.use(authenticate, requireSuperAdmin);

const mutationLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  keyFn: (req) => req.user.id,
});

// Dashboard overview.
router.get("/stats", getStats);
router.get("/activity", getActivity);

// Cross-gym gym directory and detail.
router.get("/gyms", getGyms);
router.get("/gyms/:gymId", getGym);

// Plan catalog (read-only here; plan editing remains on /admin/subscription).
router.get("/plans", getPlans);

// Administrative billing/access actions. All are audited.
router.post("/gyms/:gymId/plan", mutationLimit, assignGymPlan);
router.post("/gyms/:gymId/extend-expiry", mutationLimit, extendGymExpiry);
router.post("/gyms/:gymId/trial", mutationLimit, startGymTrial);
router.post("/gyms/:gymId/trial/end", mutationLimit, endGymTrial);
router.patch("/gyms/:gymId/access", mutationLimit, updateGymAccess);

// Platform-owner accounts (maximum two). Requires an existing SUPER_ADMIN
// session; creates the second owner already verified, with no OTP step.
router.post("/admins", mutationLimit, createAdmin);

export default router;
