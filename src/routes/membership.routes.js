import { Router } from "express";
import { cancelMembership, createMembership, freezeMembership, listMemberships } from "../controllers/membership.controller.js";
import {
  authenticate,
  requireGym,
  allowReadAndCreateOnly,
  requirePermission,
  PERMISSION,
} from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";

const router = Router();
router.use(authenticate, requireGym, allowReadAndCreateOnly, requireActiveSubscription());

router.get("/", listMemberships);
router.post("/", createMembership);
// These are POSTs but they modify an existing membership, so they need the
// update capability. Staff (RECEPTIONIST) therefore cannot freeze or cancel.
router.post("/:id/freeze", requirePermission(PERMISSION.UPDATE), freezeMembership);
router.post("/:id/cancel", requirePermission(PERMISSION.UPDATE), cancelMembership);

export default router;
