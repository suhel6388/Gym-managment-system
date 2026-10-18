// Razorpay webhook routes.
// Mounted at /api/v1/subscription/webhooks
//
// The raw request body is required for signature verification, so express.raw()
// is applied specifically to this router before express.json() consumes it.

import express from "express";
import { Router } from "express";
import { handleWebhook } from "../controllers/subscription.webhook.controller.js";

const router = Router();

// Razorpay sends the payload as the raw body; verifyWebhookSignature uses it.
router.use(express.raw({ type: "application/json" }));
router.post("/razorpay", handleWebhook);

export default router;
