import { Router } from "express";
import { dashboard, dueMemberships } from "../controllers/reports.controller.js";
import {
  authenticate,
  requireGym,
  allowReadAndCreateOnly,
} from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";

const router = Router();
router.use(authenticate, requireGym, allowReadAndCreateOnly, requireActiveSubscription());

router.get("/dashboard", dashboard);
router.get("/due-memberships", dueMemberships);

export default router;
