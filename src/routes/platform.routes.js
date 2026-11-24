// Platform billing router.
//
// Mounted at BOTH `/api/v1/platform` (the repo's canonical API prefix) and
// `/api/platform` (the prefix used in the platform-billing specification), so
// either URL works without duplicating any handler.

import { Router } from "express";

import platformPlanRoutes from "./platformPlan.routes.js";
import platformPaymentRoutes from "./platformPayment.routes.js";
import gymSubscriptionRoutes from "./gymSubscription.routes.js";

const router = Router();

router.use(platformPlanRoutes);
router.use(platformPaymentRoutes);
router.use(gymSubscriptionRoutes);

export default router;
