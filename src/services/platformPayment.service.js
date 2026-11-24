// ---------------------------------------------------------------------------
// Platform payment service — Razorpay order creation and verification.
//
// Contract:
//   * The client sends only { planId, couponCode? }. Amounts are derived from
//     the database plan and pricing.service.js — never from the request.
//   * Every payment stores an immutable amountBreakdown + planSnapshot so later
//     plan edits (price/GST/discount) never rewrite a past order.
//   * A recent pending order for the same gym + plan + price is reused so a
//     double-click or page reload does not create duplicate Razorpay orders.
// ---------------------------------------------------------------------------

import { prisma } from "../db.js";
import {
  badGateway,
  badRequest,
  notFound,
} from "../utils/http-error.js";
import {
  DEFAULT_CURRENCY,
  assertRazorpayConfigured,
  findCoupon,
  platformBillingConfig,
  publicKeyId,
} from "../config/razorpay.js";
import {
  createOrder,
  fetchPayment,
  verifyPaymentSignature,
} from "./razorpay.service.js";
import { calculatePricing } from "./pricing.service.js";
import {
  applySuccessfulPayment,
  getSubscriptionSummary,
  markPaymentFailed,
  resolvePlanDurationDays,
} from "./subscription.service.js";

const PROVIDER = "razorpay";

// ---------------------------------------------------------------------------
// Serializers
// ---------------------------------------------------------------------------

/** Immutable terms captured on the order. */
export function buildPlanSnapshot(plan) {
  return {
    id: plan.id,
    code: plan.code,
    slug: plan.slug ?? null,
    name: plan.name,
    description: plan.description ?? null,
    pricePaise: plan.pricePaise,
    currency: plan.currency,
    durationDays: resolvePlanDurationDays(plan),
    durationMonths: plan.durationMonths,
    gstPercent: plan.gstPercent ?? 0,
    discountPaise: plan.discountPaise ?? 0,
    features: plan.features ?? [],
    maxStaff: plan.maxStaff ?? null,
    maxBranches: plan.maxBranches ?? null,
  };
}

/** Public plan shape for the owner-facing `/upgrade` page. */
export function serializePlan(plan) {
  return {
    id: plan.id,
    code: plan.code,
    slug: plan.slug ?? null,
    name: plan.name,
    description: plan.description ?? null,
    pricePaise: plan.pricePaise,
    currency: plan.currency,
    durationDays: resolvePlanDurationDays(plan),
    durationMonths: plan.durationMonths,
    gstPercent: plan.gstPercent ?? 0,
    discountPaise: plan.discountPaise ?? 0,
    features: plan.features ?? [],
    isActive: plan.isActive,
    displayOrder: plan.displayOrder,
    maxStaff: plan.maxStaff ?? null,
    maxBranches: plan.maxBranches ?? null,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

export function serializePayment(payment, { includeBreakdown = true } = {}) {
  return {
    id: payment.id,
    gymId: payment.gymId,
    planId: payment.planId ?? null,
    planName:
      payment.planSnapshot?.name ?? payment.plan?.name ?? null,
    subscriptionId: payment.subscriptionId ?? null,
    // Both names are returned: `amount` mirrors the DB column, `amountPaise`
    // matches every other money field in the client.
    amount: Math.round(Number(payment.amount) || 0),
    amountPaise: Math.round(Number(payment.amount) || 0),
    currency: payment.currency,
    status: payment.status,
    provider: payment.provider,
    orderId: payment.orderId ?? null,
    paymentId: payment.paymentId ?? null,
    couponCode: payment.couponCode ?? null,
    purpose: payment.purpose ?? "SUBSCRIPTION",
    failureReason: payment.failureReason ?? null,
    verifiedAt: payment.verifiedAt ?? null,
    createdAt: payment.createdAt,
    ...(includeBreakdown ? { amountBreakdown: payment.amountBreakdown ?? null } : {}),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadPurchasablePlan(planId) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.deletedAt) {
    throw notFound("Plan not found", "PLAN_NOT_FOUND");
  }
  if (!plan.isActive) {
    throw badRequest("This plan is no longer available", "PLAN_INACTIVE");
  }
  if (!Number.isInteger(plan.pricePaise) || plan.pricePaise < 0) {
    throw badRequest("Plan price is invalid", "INVALID_PLAN_PRICE");
  }
  return plan;
}

function orderReceipt(gymId) {
  // Razorpay caps `receipt` at 40 characters.
  const suffix = `${Date.now().toString(36)}${String(gymId).slice(-6)}`;
  return `plat_${suffix}`.slice(0, 40);
}

function ensureChargeableTotal(total) {
  if (!Number.isInteger(total) || total < platformBillingConfig.minimumChargePaise) {
    throw badRequest(
      "The payable amount is below the payment gateway minimum",
      "AMOUNT_TOO_SMALL",
    );
  }
  if (total > platformBillingConfig.maximumChargePaise) {
    throw badRequest("The payable amount is too large", "AMOUNT_TOO_LARGE");
  }
}

// ---------------------------------------------------------------------------
// Create order
// ---------------------------------------------------------------------------

/**
 * POST /api/v1/platform/payments/create-order
 * Body: { planId, couponCode? }
 */
export async function createPlatformOrder({ gymId, planId, couponCode = null, actor = null }) {
  assertRazorpayConfigured();

  const [gym, plan] = await Promise.all([
    prisma.gym.findUnique({ where: { id: gymId }, select: { id: true, name: true } }),
    loadPurchasablePlan(planId),
  ]);
  if (!gym) throw notFound("Gym not found", "GYM_NOT_FOUND");

  let coupon = null;
  const normalizedCoupon = couponCode ? String(couponCode).trim().toUpperCase() : null;
  if (normalizedCoupon) {
    coupon = findCoupon(normalizedCoupon);
    if (!coupon) {
      throw badRequest("Coupon code is invalid", "INVALID_COUPON");
    }
  }

  const pricing = calculatePricing({
    basePricePaise: plan.pricePaise,
    gstPercent: plan.gstPercent ?? 0,
    planDiscountPaise: plan.discountPaise ?? 0,
    coupon,
  });
  ensureChargeableTotal(pricing.total);

  // Reuse a recent pending order for the same gym + plan + coupon + total.
  const ttlStart = new Date(
    Date.now() - platformBillingConfig.pendingOrderTtlMinutes * 60_000,
  );
  const pending = await prisma.subscriptionPayment.findFirst({
    where: {
      gymId,
      planId: plan.id,
      status: { in: ["CREATED", "PENDING"] },
      amount: pricing.total,
      couponCode: normalizedCoupon,
      orderId: { not: null },
      createdAt: { gte: ttlStart },
    },
    orderBy: { createdAt: "desc" },
  });

  if (pending) {
    return {
      data: {
        paymentId: pending.id,
        orderId: pending.orderId,
        amount: pricing.total,
        currency: pending.currency || DEFAULT_CURRENCY,
        keyId: publicKeyId(),
        status: pending.status,
        reused: true,
        amountBreakdown: pending.amountBreakdown ?? pricing,
        plan: serializePlan(plan),
        pendingOrderExpiresAt: new Date(
          pending.createdAt.getTime() +
            platformBillingConfig.pendingOrderTtlMinutes * 60_000,
        ),
      },
      message: "Existing payment order reused",
    };
  }

  let order;
  try {
    order = await createOrder({
      amount: pricing.total,
      currency: plan.currency || DEFAULT_CURRENCY,
      receipt: orderReceipt(gymId),
      notes: {
        gymId,
        planId: plan.id,
        couponCode: normalizedCoupon ?? "",
        basePaise: String(pricing.base),
        discountPaise: String(pricing.discount + pricing.couponDiscount),
        gstPaise: String(pricing.gst),
      },
    });
  } catch (err) {
    throw badGateway(
      `Payment gateway could not create the order: ${err?.message ?? "unknown error"}`,
      "PAYMENT_GATEWAY_ERROR",
    );
  }

  const snapshot = buildPlanSnapshot(plan);
  const payment = await prisma.subscriptionPayment.create({
    data: {
      gymId,
      planId: plan.id,
      amount: pricing.total,
      currency: plan.currency || DEFAULT_CURRENCY,
      status: "CREATED",
      provider: PROVIDER,
      orderId: order.id,
      couponCode: normalizedCoupon,
      amountBreakdown: pricing,
      planSnapshot: snapshot,
      purpose: "SUBSCRIPTION",
    },
  });

  await prisma.subscriptionAuditLog.create({
    data: {
      action: "PAYMENT_ORDER_CREATED",
      gymId,
      planId: plan.id,
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      reason: "Platform subscription order created",
      details: {
        orderId: order.id,
        paymentId: payment.id,
        amountBreakdown: pricing,
        couponCode: normalizedCoupon,
      },
      newValues: {
        status: "CREATED",
        amount: pricing.total,
        planId: plan.id,
      },
    },
  });

  return {
    data: {
      paymentId: payment.id,
      orderId: order.id,
      amount: pricing.total,
      currency: payment.currency,
      keyId: publicKeyId(),
      status: payment.status,
      reused: false,
      amountBreakdown: pricing,
      plan: serializePlan(plan),
      pendingOrderExpiresAt: new Date(
        Date.now() + platformBillingConfig.pendingOrderTtlMinutes * 60_000,
      ),
    },
    message: "Payment order created",
  };
}

// ---------------------------------------------------------------------------
// Verify payment
// ---------------------------------------------------------------------------

function assertProviderPaymentMatches(payment, providerPayment, orderId) {
  if (providerPayment.order_id !== orderId) {
    throw badRequest("Payment does not match the expected order", "ORDER_MISMATCH");
  }
  if (Math.round(providerPayment.amount) !== Math.round(payment.amount)) {
    throw badRequest("Payment amount does not match the order", "AMOUNT_MISMATCH");
  }
  if (
    String(providerPayment.currency || DEFAULT_CURRENCY).toUpperCase() !==
    String(payment.currency || DEFAULT_CURRENCY).toUpperCase()
  ) {
    throw badRequest("Payment currency does not match the order", "CURRENCY_MISMATCH");
  }
  if (!["captured", "authorized"].includes(providerPayment.status)) {
    throw badRequest(
      `Payment was not captured by the provider (status: ${providerPayment.status})`,
      "PAYMENT_NOT_CAPTURED",
    );
  }
}

/**
 * POST /api/v1/platform/payments/verify
 * Body: { orderId, paymentId, signature }
 *
 * The browser's success callback is never trusted: the HMAC signature is
 * verified with timingSafeEqual AND the payment is re-fetched from Razorpay
 * before the subscription is activated.
 */
export async function verifyPlatformPayment({
  gymId,
  orderId,
  paymentId,
  signature,
}) {
  const payment = await prisma.subscriptionPayment.findFirst({
    where: { gymId, orderId },
    include: { plan: true },
  });
  if (!payment) {
    throw notFound("Payment order not found", "PAYMENT_NOT_FOUND");
  }

  if (payment.status === "SUCCESS") {
    const subscription = await getSubscriptionSummary(gymId);
    return {
      data: {
        subscription,
        payment: serializePayment(payment),
        alreadyVerified: true,
      },
      message: "Payment already verified",
    };
  }

  let signatureOk;
  try {
    signatureOk = verifyPaymentSignature({ orderId, paymentId, signature });
  } catch (err) {
    throw badGateway(
      `Payment gateway is not configured: ${err?.message ?? "missing secret"}`,
      "PAYMENT_NOT_CONFIGURED",
    );
  }
  if (!signatureOk) {
    await prisma.subscriptionPayment.updateMany({
      where: { id: payment.id, status: { in: ["CREATED", "PENDING"] } },
      data: {
        status: "FAILED",
        failureReason: "Invalid payment signature",
        updatedAt: new Date(),
      },
    });
    throw badRequest("Payment signature verification failed", "SIGNATURE_INVALID");
  }

  let providerPayment;
  try {
    providerPayment = await fetchPayment(paymentId);
  } catch (err) {
    throw badGateway(
      `Unable to verify the payment with the provider: ${err?.message ?? "unknown error"}`,
      "PROVIDER_VERIFY_FAILED",
    );
  }
  assertProviderPaymentMatches(payment, providerPayment, orderId);

  const outcome = await applySuccessfulPayment({
    gymId,
    paymentId: payment.id,
    providerPaymentId: paymentId,
    signature,
    source: "verify",
  });

  const subscription = await getSubscriptionSummary(gymId);
  return {
    data: {
      subscription,
      payment: serializePayment(outcome.payment),
      alreadyVerified: outcome.alreadyProcessed,
      extendedFrom: outcome.extendedFrom ?? null,
      newPeriodEnd: outcome.newPeriodEnd ?? null,
    },
    message: outcome.alreadyProcessed
      ? "Payment already verified"
      : outcome.extendedFrom
        ? "Subscription extended"
        : "Subscription activated",
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** GET /platform/payments/history — the authenticated gym only. */
export async function getGymPaymentHistory(gymId, { page = 1, limit = 20 } = {}) {
  const take = Math.min(Math.max(limit, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;

  const [rows, total, subscription] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where: { gymId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { plan: { select: { name: true } } },
    }),
    prisma.subscriptionPayment.count({ where: { gymId } }),
    getSubscriptionSummary(gymId),
  ]);

  return {
    data: {
      subscription,
      payments: rows.map((row) => serializePayment(row)),
      pagination: {
        page: Math.max(page, 1),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
    },
  };
}

/** GET /platform/admin/payments — cross-gym payment ledger. */
export async function listPlatformPayments({
  q = null,
  status = null,
  planId = null,
  gymId = null,
  from = null,
  to = null,
  page = 1,
  limit = 20,
} = {}) {
  const take = Math.min(Math.max(limit, 1), 100);
  const skip = (Math.max(page, 1) - 1) * take;

  const where = {
    ...(status ? { status } : {}),
    ...(planId ? { planId } : {}),
    ...(gymId ? { gymId } : {}),
    ...(from || to
      ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
    ...(q
      ? {
          OR: [
            { orderId: { contains: q, mode: "insensitive" } },
            { paymentId: { contains: q, mode: "insensitive" } },
            { gym: { name: { contains: q, mode: "insensitive" } } },
            { gym: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [rows, total, successfulTotal] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        gym: { select: { id: true, name: true, email: true } },
        plan: { select: { id: true, name: true } },
      },
    }),
    prisma.subscriptionPayment.count({ where }),
    prisma.subscriptionPayment.aggregate({
      where: { ...where, status: "SUCCESS" },
      _sum: { amount: true },
    }),
  ]);

  return {
    data: {
      payments: rows.map((row) => ({
        ...serializePayment(row),
        gym: row.gym
          ? { id: row.gym.id, name: row.gym.name, email: row.gym.email }
          : null,
        planName: row.planSnapshot?.name ?? row.plan?.name ?? null,
      })),
      pagination: {
        page: Math.max(page, 1),
        limit: take,
        total,
        totalPages: Math.ceil(total / take),
      },
      summary: {
        successfulTotalPaise: Math.round(successfulTotal._sum.amount || 0),
      },
    },
  };
}

/** GET /platform/admin/payments/:id — full audit for one payment. */
export async function getPlatformPayment(paymentId) {
  const payment = await prisma.subscriptionPayment.findUnique({
    where: { id: paymentId },
    include: {
      gym: { select: { id: true, name: true, email: true } },
      plan: { select: { id: true, name: true } },
    },
  });
  if (!payment) throw notFound("Payment not found", "PAYMENT_NOT_FOUND");

  return {
    data: {
      ...serializePayment(payment),
      gym: payment.gym,
      planSnapshot: payment.planSnapshot ?? null,
      processedEventIds: payment.processedEventIds ?? [],
    },
  };
}

export { markPaymentFailed };
