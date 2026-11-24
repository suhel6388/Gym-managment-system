// ---------------------------------------------------------------------------
// Platform payment controllers.
//
// The request body is NEVER trusted for money. `createOrder` accepts only a
// planId and an optional coupon code; every amount is computed on the server.
// ---------------------------------------------------------------------------

import {
  createPlatformOrder,
  getGymPaymentHistory,
  getPlatformPayment,
  listPlatformPayments,
  verifyPlatformPayment,
} from "../services/platformPayment.service.js";
import {
  createOrderSchema,
  verifyPaymentSchema,
  paymentHistoryQuerySchema,
  adminPaymentListSchema,
} from "../validators/platform.validator.js";

function requireGym(req) {
  if (!req.user?.gymId) {
    const err = new Error("No gym associated with this account");
    err.statusCode = 400;
    err.code = "NO_GYM";
    throw err;
  }
  return req.user.gymId;
}

/** POST /platform/payments/create-order */
export async function createOrder(req, res, next) {
  try {
    const gymId = requireGym(req);
    const input = createOrderSchema.parse(req.body ?? {});
    const result = await createPlatformOrder({
      gymId,
      planId: input.planId,
      couponCode: input.couponCode ?? null,
      actor: req.user,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/** POST /platform/payments/verify */
export async function verifyPayment(req, res, next) {
  try {
    const gymId = requireGym(req);
    const input = verifyPaymentSchema.parse(req.body ?? {});
    const result = await verifyPlatformPayment({ gymId, ...input });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /platform/payments — authenticated gym's own history. */
export async function getMyPayments(req, res, next) {
  try {
    const gymId = requireGym(req);
    const query = paymentHistoryQuerySchema.parse(req.query);
    const result = await getGymPaymentHistory(gymId, query);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /platform/admin/payments — cross-gym ledger (super admin only). */
export async function listPayments(req, res, next) {
  try {
    const query = adminPaymentListSchema.parse(req.query);
    const result = await listPlatformPayments({
      ...query,
      q: query.q?.trim() || null,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /platform/admin/payments/:paymentId */
export async function getPayment(req, res, next) {
  try {
    const result = await getPlatformPayment(req.params.paymentId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
