import { Router } from "express";
import {
  createReceptionist,
  listStaff,
  deleteReceptionist,
} from "../controllers/staff.controller.js";
import {
  authenticate,
  requireGym,
  requirePermission,
  PERMISSION,
} from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";

const router = Router();

// Only a gym owner (ADMIN) can manage staff.
// RECEPTIONIST gets 403 here (handled by requirePermission).
router.use(authenticate, requireGym, requirePermission(PERMISSION.MANAGE_STAFF), requireActiveSubscription());

router.get("/receptionists", listStaff);
router.post("/receptionists", createReceptionist);
router.delete("/receptionists/:id", deleteReceptionist);

export default router;
