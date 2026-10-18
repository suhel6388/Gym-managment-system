// Gym-owner subscription controllers.
//
// gymId is ALWAYS derived from req.user.gymId (authenticated server-side
// context) — never trusted from the request body.

import { z } from "zod";

import {
  listActivePlans as listActivePlansService,
  getMySubscription as getMySubscriptionService,
  startTrial as startTrialService,
  createCheckout as createCheckoutService,
  verifyPayment as verifyPaymentService,
  getHistory as getHistoryService,
  cancelSubscription as cancelSubscriptionService,
} from "../services/subscription.service.js";

export async function getPlans(req, res, next) {
  try {
    const result = await listActivePlansService();
    res.json(result);
  } catch (err) { next(err); }
}

export async function getMe(req, res, next) {
  try {
    if (!req.user?.gymId) {
      return res.status(400).json({ error: "No gym associated with this account", code: "NO_GYM" });
    }
    const result = await getMySubscriptionService(req.user.gymId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function startTrial(req, res, next) {
  try {
    if (!req.user?.gymId) {
      return res.status(400).json({ error: "No gym associated with this account", code: "NO_GYM" });
    }
    const result = await startTrialService(req.user.gymId, req.user);
    res.status(result.data.alreadyStarted ? 200 : 201).json(result);
  } catch (err) { next(err); }
}

export async function checkout(req, res, next) {
  try {
    if (!req.user?.gymId) {
      return res.status(400).json({ error: "No gym associated with this account", code: "NO_GYM" });
    }
    const input = z.object({ planId: z.string().trim().min(1) }).parse(req.body);
    const result = await createCheckoutService(req.user.gymId, input.planId);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function verifyPayment(req, res, next) {
  try {
    if (!req.user?.gymId) {
      return res.status(400).json({ error: "No gym associated with this account", code: "NO_GYM" });
    }
    const input = z
      .object({
        orderId: z.string().trim().min(1),
        paymentId: z.string().trim().min(1),
        signature: z.string().trim().min(1),
      })
      .parse(req.body);
    const result = await verifyPaymentService(req.user.gymId, input);
    res.status(result.data.alreadyVerified ? 200 : 200).json(result);
  } catch (err) { next(err); }
}

export async function getHistory(req, res, next) {
  try {
    if (!req.user?.gymId) {
      return res.status(400).json({ error: "No gym associated with this account", code: "NO_GYM" });
    }
    const result = await getHistoryService(req.user.gymId);
    res.json(result);
  } catch (err) { next(err); }
}

export async function cancelSubscription(req, res, next) {
  try {
    if (!req.user?.gymId) {
      return res.status(400).json({ error: "No gym associated with this account", code: "NO_GYM" });
    }
    const result = await cancelSubscriptionService(req.user.gymId, req.user);
    res.json(result);
  } catch (err) { next(err); }
}
