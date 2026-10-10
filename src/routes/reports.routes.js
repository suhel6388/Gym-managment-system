import { Router } from "express";
import { dashboard, dueMemberships } from "../controllers/reports.controller.js";
import { authenticate, requireGym } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/dashboard", dashboard);
router.get("/due-memberships", dueMemberships);

export default router;
