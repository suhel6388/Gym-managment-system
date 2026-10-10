import { Router } from "express";
import { createPlan, deactivatePlan, listPlans, updatePlan } from "../controllers/plans.controller.js";
import { authenticate, requireGym } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/", listPlans);
router.post("/", createPlan);
router.patch("/:id", updatePlan);
router.delete("/:id", deactivatePlan);

export default router;
