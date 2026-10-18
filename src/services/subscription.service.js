// Core business logic for the SaaS subscription & billing module.
//
// Every gym-scoped query is filtered by `gymId` derived from the authenticated
// user — never trusted from the request body. Prices and entitlements are
// validated server-side. Payment activation runs inside a Prisma transaction.

import { prisma } from "../db.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  serviceUnavailable,
} from "../utils/http-error.js";
import { addMonthsClamped, addDays, daysRemaining, isFuture } from "../utils/dates.js";
import {
  createOrder,
  fetchPayment,
  fetchOrder,
  getKeyId,
  isConfigured,
  verifyPaymentSignature,
} from "./razorpay.service.js";

const CURRENCY = "INR";
const PROVIDER = "razorpay";
const SINGLETON_SETTINGS_ID = "singleton";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Throw unless the actor is a SaaS super-admin. */
function requireSuperAdmin(actor) {
  if (!actor || actor.role !== "SUPER_ADMIN") {
    throw forbidden("SaaS super-admin access required", "SUPER_ADMIN_REQUIRED");
  }
}

/** Fetch a gym, throwing 404 if missing. */
async function findGym(gymId) {
  const gym = await prisma.gym.findUnique({ where: { id: gymId }, select: { id: true, name: true } });
  if (!gym) throw notFound("Gym not found");
  return gym;
}

/** Fetch the singleton subscription settings. */
async function getSettingsRow() {
  let settings = await prisma.subscriptionSetting.findUnique({
    where: { id: SINGLETON_SETTINGS_ID },
  });
  if (!settings) {
    settings = await prisma.subscriptionSetting.create({
      data: { id: SINGLETON_SETTINGS_ID },
    });
  }
  return settings;
}

/** Append an audit log entry within the given transaction (or the main client). */
async function auditLog(tx, { action, gymId, planId, subscriptionId, actor, reason, details }) {
  await tx.subscriptionAuditLog.create({
    data: {
      action,
      gymId: gymId ?? null,
      planId: planId ?? null,
      subscriptionId: subscriptionId ?? null,
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      reason: reason ?? null,
      details: details ?? null,
    },
  });
}

/**
 * Compute whether a gym is currently entitled to use paid business features,
 * and how many days remain before the entitlement ends.
 *
 * Entitlement rules:
 *   TRIALING      -> entitled while trialEndsAt is in the future
 *   ACTIVE        -> entitled while currentPeriodEnd is in the future
 *   CANCELLED     -> entitled while cancelAtPeriodEnd && currentPeriodEnd in future
 *   EXPIRED/PAST_DUE -> never entitled
 *
 * Returns { entitled, subscription, expiresAt, remainingDays, reason }.
 */
export function computeEntitlement(sub, now = new Date()) {
  if (!sub) {
    return {
      entitled: false,
      subscription: null,
      expiresAt: null,
      remainingDays: 0,
      reason: "NO_SUBSCRIPTION",
    };
  }

  const status = sub.status;
  let expiresAt = null;
  let remainingDays = 0;
  let entitled = false;
  let reason = status;

  if (status === "TRIALING") {
    expiresAt = sub.trialEndsAt ?? null;
    if (expiresAt && expiresAt.getTime() > now.getTime()) {
      entitled = true;
      reason = "TRIAL_ACTIVE";
      remainingDays = daysRemaining(expiresAt, now);
    } else {
      entitled = false;
      reason = "TRIAL_EXPIRED";
      remainingDays = 0;
    }
  } else if (status === "ACTIVE") {
    expiresAt = sub.currentPeriodEnd ?? null;
    if (expiresAt && expiresAt.getTime() > now.getTime()) {
      entitled = true;
      reason = "SUBSCRIPTION_ACTIVE";
      remainingDays = daysRemaining(expiresAt, now);
    } else {
      entitled = false;
      reason = "SUBSCRIPTION_EXPIRED";
      remainingDays = 0;
    }
  } else if (status === "CANCELLED") {
    // Cancellation scheduled at period end keeps access until the period ends.
    if (sub.cancelAtPeriodEnd) {
      expiresAt = sub.currentPeriodEnd ?? null;
      if (expiresAt && expiresAt.getTime() > now.getTime()) {
        entitled = true;
        reason = "CANCELLED_AT_PERIOD_END";
        remainingDays = daysRemaining(expiresAt, now);
      } else {
        entitled = false;
        reason = "CANCELLED_EXPIRED";
        remainingDays = 0;
      }
    } else {
      entitled = false;
      reason = "CANCELLED_IMMEDIATE";
      remainingDays = 0;
    }
  } else {
    // EXPIRED, PAST_DUE
    entitled = false;
    remainingDays = 0;
  }

  return { entitled, subscription: sub, expiresAt, remainingDays, reason };
}

/** Build a public plan representation (no internal pricing secrets beyond what's public). */
function publicPlan(plan) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    pricePaise: plan.pricePaise,
    currency: plan.currency,
    durationMonths: plan.durationMonths,
    isActive: plan.isActive,
    displayOrder: plan.displayOrder,
    features: plan.features ?? [],
    maxStaff: plan.maxStaff,
    maxBranches: plan.maxBranches,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Public / authenticated plan APIs
// ---------------------------------------------------------------------------

/** Return active plans with public features (gym-owner view). */
export async function listActivePlans() {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  return { data: plans.map(publicPlan) };
}

/** Return the authenticated gym's subscription, plan, and entitlement. */
export async function getMySubscription(gymId) {
  const sub = await prisma.gymSubscription.findUnique({
    where: { gymId },
    include: { plan: true },
  });

  const now = new Date();
  const entitlement = computeEntitlement(sub, now);

  let remainingTrialDays = 0;
  if (sub && sub.trialEndsAt) {
    remainingTrialDays = daysRemaining(sub.trialEndsAt, now);
  }

  return {
    data: {
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            plan: sub.plan ? publicPlan(sub.plan) : null,
            planNameSnapshot: sub.planNameSnapshot,
            pricePaise: sub.pricePaise,
            currency: sub.currency,
            trialStartsAt: sub.trialStartsAt,
            trialEndsAt: sub.trialEndsAt,
            remainingTrialDays,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            cancelledAt: sub.cancelledAt,
            paymentProvider: sub.paymentProvider,
            createdAt: sub.createdAt,
            updatedAt: sub.updatedAt,
          }
        : null,
      entitled: entitlement.entitled,
      expiresAt: entitlement.expiresAt,
      remainingDays: entitlement.remainingDays,
      reason: entitlement.reason,
    },
  };
}

// ---------------------------------------------------------------------------
// Gym-owner APIs
// ---------------------------------------------------------------------------

/**
 * Start a free trial for a gym. Idempotent: if a trial/subscription already
 * exists for the gym, returns it instead of creating a duplicate.
 * Transaction-safe: the unique gymId on GymSubscription prevents concurrent
 * duplicate grants (the losing transaction hits P2002 and rolls back).
 */
export async function startTrial(gymId, actor) {
  const settings = await getSettingsRow();
  if (!settings.trialEnabled) {
    throw badRequest("Free trials are currently disabled by the platform", "TRIALS_DISABLED");
  }

  // Idempotent: an existing subscription means the gym already started.
  const existing = await prisma.gymSubscription.findUnique({
    where: { gymId },
    select: { id: true, status: true, trialEndsAt: true },
  });
  if (existing) {
    return {
      data: { subscriptionId: existing.id, status: existing.status, trialEndsAt: existing.trialEndsAt, alreadyStarted: true },
      message: "Trial already started for this gym",
    };
  }

  // Eligibility: a gym may consume only one initial trial.
  const alreadyTrialed = await prisma.trialRecord.findFirst({
    where: { gymId, type: "INITIAL" },
    select: { id: true },
  });
  if (alreadyTrialed) {
    throw conflict("This gym has already used its free trial", "TRIAL_ALREADY_USED");
  }

  const trialStartsAt = new Date();
  const trialEndsAt = addDays(trialStartsAt, settings.trialDurationDays);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const sub = await tx.gymSubscription.create({
        data: {
          gymId,
          status: "TRIALING",
          planId: null,
          planNameSnapshot: "Free trial",
          pricePaise: settings.trialPricePaise ?? 0,
          currency: CURRENCY,
          trialStartsAt,
          trialEndsAt,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          cancelledAt: null,
          paymentProvider: null,
        },
      });
      await tx.trialRecord.create({
        data: {
          gymId,
          type: "INITIAL",
          startsAt: trialStartsAt,
          endsAt: trialEndsAt,
          reason: "Initial free trial",
          grantedById: actor?.id ?? null,
          grantedByRole: actor?.role ?? null,
          source: "SELF_SERVICE",
        },
      });
      await auditLog(tx, {
        action: "TRIAL_STARTED",
        gymId,
        actor,
        reason: "Initial free trial",
        details: { trialDurationDays: settings.trialDurationDays, trialEndsAt },
      });
      return sub;
    });
  } catch (err) {
    // Concurrent duplicate: unique gymId constraint violated.
    if (err?.code === "P2002") {
      const again = await prisma.gymSubscription.findUnique({ where: { gymId } });
      if (again) {
        return {
          data: { subscriptionId: again.id, status: again.status, trialEndsAt: again.trialEndsAt, alreadyStarted: true },
          message: "Trial already started for this gym",
        };
      }
    }
    throw err;
  }

  return {
    data: {
      subscriptionId: created.id,
      status: created.status,
      trialStartsAt: created.trialStartsAt,
      trialEndsAt: created.trialEndsAt,
      alreadyStarted: false,
    },
    message: "Free trial started",
  };
}

/**
 * Create a Razorpay order for a plan purchase. Derives gymId from the
 * authenticated user — never from the request body. Returns the order and
 * public key id for the frontend checkout.
 */
export async function createCheckout(gymId, planId) {
  await findGym(gymId);

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) {
    throw notFound("Active plan not found", "PLAN_NOT_FOUND");
  }

  if (!isConfigured()) {
    throw serviceUnavailable("Payment gateway is not configured", "PAYMENT_NOT_CONFIGURED");
  }

  // Idempotency: reuse a pending/created order for the same gym+plan if one
  // exists without a successful payment, so retries don't spawn duplicate orders.
  const pending = await prisma.subscriptionPayment.findFirst({
    where: {
      gymId,
      planId,
      status: { in: ["CREATED", "PENDING"] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, orderId: true, amount: true, status: true, createdAt: true },
  });
  if (pending && pending.orderId) {
    return {
      data: {
        paymentId: pending.id,
        orderId: pending.orderId,
        amount: pending.amount,
        currency: CURRENCY,
        keyId: getKeyId(),
        status: pending.status,
        reused: true,
      },
      message: "Payment order ready",
    };
  }

  const receipt = `sub_${gymId}_${Date.now()}`;
  const order = await createOrder({
    amount: plan.pricePaise,
    currency: CURRENCY,
    receipt,
    notes: { gymId, planId, planName: plan.name },
  });

  const payment = await prisma.subscriptionPayment.create({
    data: {
      gymId,
      planId,
      amount: plan.pricePaise,
      currency: CURRENCY,
      status: "CREATED",
      provider: PROVIDER,
      orderId: order.id,
      paymentId: null,
      signature: null,
      failureReason: null,
      verifiedAt: null,
    },
  });

  return {
    data: {
      paymentId: payment.id,
      orderId: order.id,
      amount: plan.pricePaise,
      currency: CURRENCY,
      keyId: getKeyId(),
      status: "CREATED",
      reused: false,
    },
    message: "Payment order created",
  };
}

/**
 * Verify a Razorpay payment and activate the subscription. Runs inside a
 * transaction. Never trusts the browser's success response alone — the
 * signature and the provider-side payment status are both verified.
 */
export async function verifyPayment(gymId, { orderId, paymentId, signature }) {
  await findGym(gymId);

  const payment = await prisma.subscriptionPayment.findFirst({
    where: { gymId, orderId },
    include: { plan: true },
  });
  if (!payment) {
    throw notFound("Payment order not found", "PAYMENT_NOT_FOUND");
  }

  // Idempotency: already verified/activated.
  if (payment.status === "SUCCESS") {
    const sub = await prisma.gymSubscription.findUnique({ where: { gymId }, include: { plan: true } });
    return { data: { subscription: sub, alreadyVerified: true }, message: "Payment already verified" };
  }

  // 1. Signature verification (server-side, never trust browser).
  const sigOk = verifyPaymentSignature({ orderId, paymentId, signature });
  if (!sigOk) {
    await prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureReason: "Invalid signature" },
    });
    throw badRequest("Payment signature verification failed", "SIGNATURE_INVALID");
  }

  // 2. Verify against Razorpay server-side (amount, currency, status).
  let providerPayment;
  try {
    providerPayment = await fetchPayment(paymentId);
  } catch (err) {
    throw badGateway("Unable to verify payment with provider", "PROVIDER_VERIFY_FAILED");
  }

  if (providerPayment.order_id !== orderId) {
    throw badRequest("Payment does not match the expected order", "ORDER_MISMATCH");
  }
  if (providerPayment.amount !== payment.amount) {
    throw badRequest("Payment amount does not match the order", "AMOUNT_MISMATCH");
  }
  if ((providerPayment.currency || "INR") !== payment.currency) {
    throw badRequest("Payment currency does not match the order", "CURRENCY_MISMATCH");
  }
  if (!["captured", "authorized"].includes(providerPayment.status)) {
    await prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureReason: `Provider status: ${providerPayment.status}` },
    });
    throw badRequest("Payment was not captured by the provider", "PAYMENT_NOT_CAPTURED");
  }

  const plan = payment.plan || (await prisma.subscriptionPlan.findUnique({ where: { id: payment.planId } }));
  if (!plan || !plan.isActive) {
    throw notFound("Plan not found or inactive", "PLAN_NOT_FOUND");
  }

  const now = new Date();
  const periodEnd = addMonthsClamped(now, plan.durationMonths);

  // 3. Activate subscription inside a transaction.
  const [subscription, updatedPayment] = await prisma.$transaction(async (tx) => {
    const sub = await tx.gymSubscription.upsert({
      where: { gymId },
      update: {
        planId: plan.id,
        planNameSnapshot: plan.name,
        pricePaise: plan.pricePaise,
        currency: plan.currency,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        paymentProvider: PROVIDER,
        updatedAt: now,
      },
      create: {
        gymId,
        planId: plan.id,
        status: "ACTIVE",
        planNameSnapshot: plan.name,
        pricePaise: plan.pricePaise,
        currency: plan.currency,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        paymentProvider: PROVIDER,
      },
      include: { plan: true },
    });

    const updated = await tx.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESS",
        paymentId,
        signature,
        verifiedAt: now,
        subscriptionId: sub.id,
      },
    });

    await auditLog(tx, {
      action: "SUBSCRIPTION_ACTIVATED",
      gymId,
      planId: plan.id,
      subscriptionId: sub.id,
      actor: null,
      reason: "Paid subscription activated",
      details: { orderId, paymentId, plan: plan.name, amount: plan.pricePaise, periodEnd },
    });

    return [sub, updated];
  });

  return {
    data: {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        plan: publicPlan(subscription.plan),
        pricePaise: subscription.pricePaise,
        currency: subscription.currency,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        paymentProvider: subscription.paymentProvider,
      },
      payment: {
        id: updatedPayment.id,
        status: updatedPayment.status,
        verifiedAt: updatedPayment.verifiedAt,
      },
      alreadyVerified: false,
    },
    message: "Subscription activated",
  };
}

/**
 * Webhook-driven payment verification and subscription activation.
 * Verifies against Razorpay server-side (no browser signature involved) and
 * activates the subscription inside a transaction. Idempotent: if the payment
 * is already SUCCESS, returns the existing subscription.
 */
export async function verifyAndActivateFromWebhook(orderId, paymentId) {
  const payment = await prisma.subscriptionPayment.findFirst({
    where: { orderId },
    include: { plan: true, gym: true },
  });
  if (!payment) {
    throw notFound("Payment order not found", "PAYMENT_NOT_FOUND");
  }

  // Idempotency: already verified/activated.
  if (payment.status === "SUCCESS") {
    const sub = await prisma.gymSubscription.findUnique({
      where: { gymId: payment.gymId },
      include: { plan: true },
    });
    return { data: { subscription: sub, alreadyVerified: true }, message: "Payment already verified" };
  }

  // Verify against Razorpay server-side (order, amount, currency, status).
  let providerPayment;
  try {
    providerPayment = await fetchPayment(paymentId);
  } catch (err) {
    throw badGateway("Unable to verify payment with provider", "PROVIDER_VERIFY_FAILED");
  }

  if (providerPayment.order_id !== orderId) {
    throw badRequest("Payment does not match the expected order", "ORDER_MISMATCH");
  }
  if (providerPayment.amount !== payment.amount) {
    throw badRequest("Payment amount does not match the order", "AMOUNT_MISMATCH");
  }
  if ((providerPayment.currency || "INR") !== payment.currency) {
    throw badRequest("Payment currency does not match the order", "CURRENCY_MISMATCH");
  }
  if (!["captured", "authorized"].includes(providerPayment.status)) {
    await prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: { status: "FAILED", failureReason: `Provider status: ${providerPayment.status}` },
    });
    throw badRequest("Payment was not captured by the provider", "PAYMENT_NOT_CAPTURED");
  }

  const plan = payment.plan || (await prisma.subscriptionPlan.findUnique({ where: { id: payment.planId } }));
  if (!plan || !plan.isActive) {
    throw notFound("Plan not found or inactive", "PLAN_NOT_FOUND");
  }

  const gymId = payment.gymId;
  const now = new Date();
  const periodEnd = addMonthsClamped(now, plan.durationMonths);

  const [subscription, updatedPayment] = await prisma.$transaction(async (tx) => {
    const sub = await tx.gymSubscription.upsert({
      where: { gymId },
      update: {
        planId: plan.id,
        planNameSnapshot: plan.name,
        pricePaise: plan.pricePaise,
        currency: plan.currency,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        paymentProvider: PROVIDER,
        updatedAt: now,
      },
      create: {
        gymId,
        planId: plan.id,
        status: "ACTIVE",
        planNameSnapshot: plan.name,
        pricePaise: plan.pricePaise,
        currency: plan.currency,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        paymentProvider: PROVIDER,
      },
      include: { plan: true },
    });

    const updated = await tx.subscriptionPayment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESS",
        paymentId,
        signature: null,
        verifiedAt: now,
        subscriptionId: sub.id,
      },
    });

    await auditLog(tx, {
      action: "SUBSCRIPTION_ACTIVATED",
      gymId,
      planId: plan.id,
      subscriptionId: sub.id,
      actor: null,
      reason: "Paid subscription activated via webhook",
      details: { orderId, paymentId, plan: plan.name, amount: plan.pricePaise, periodEnd },
    });

    return [sub, updated];
  });

  return {
    data: {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        plan: publicPlan(subscription.plan),
        pricePaise: subscription.pricePaise,
        currency: subscription.currency,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        paymentProvider: subscription.paymentProvider,
      },
      payment: {
        id: updatedPayment.id,
        status: updatedPayment.status,
        verifiedAt: updatedPayment.verifiedAt,
      },
      alreadyVerified: false,
    },
    message: "Subscription activated via webhook",
  };
}

/** Return the authenticated gym's subscription and payment history. */
export async function getHistory(gymId) {
  await findGym(gymId);

  const [subscription, payments] = await Promise.all([
    prisma.gymSubscription.findUnique({
      where: { gymId },
      include: { plan: true },
    }),
    prisma.subscriptionPayment.findMany({
      where: { gymId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  return {
    data: {
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            plan: subscription.plan ? publicPlan(subscription.plan) : null,
            planNameSnapshot: subscription.planNameSnapshot,
            pricePaise: subscription.pricePaise,
            currency: subscription.currency,
            trialStartsAt: subscription.trialStartsAt,
            trialEndsAt: subscription.trialEndsAt,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            cancelledAt: subscription.cancelledAt,
            paymentProvider: subscription.paymentProvider,
            createdAt: subscription.createdAt,
            updatedAt: subscription.updatedAt,
          }
        : null,
      payments: payments.map((p) => ({
        id: p.id,
        planId: p.planId,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        provider: p.provider,
        orderId: p.orderId,
        paymentId: p.paymentId,
        failureReason: p.failureReason,
        verifiedAt: p.verifiedAt,
        createdAt: p.createdAt,
      })),
    },
  };
}

/**
 * Cancel a gym's subscription according to the configured billing policy.
 * Default policy: cancel at end of paid period (access continues until
 * currentPeriodEnd). Immediate cancellation when policy is IMMEDIATE.
 */
export async function cancelSubscription(gymId, actor) {
  await findGym(gymId);

  const settings = await getSettingsRow();
  const sub = await prisma.gymSubscription.findUnique({
    where: { gymId },
    include: { plan: true },
  });
  if (!sub) {
    throw notFound("No subscription found for this gym", "SUBSCRIPTION_NOT_FOUND");
  }
  if (sub.status === "CANCELLED") {
    return {
      data: { subscriptionId: sub.id, status: sub.status, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, alreadyCancelled: true },
      message: "Subscription already cancelled",
    };
  }
  if (sub.status === "EXPIRED" || sub.status === "PAST_DUE") {
    throw badRequest("Cannot cancel an expired or past-due subscription", "SUBSCRIPTION_NOT_ACTIVE");
  }

  const now = new Date();
  const immediate = settings.cancellationPolicy === "IMMEDIATE";

  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.gymSubscription.update({
      where: { gymId },
      data: {
        status: immediate ? "CANCELLED" : "CANCELLED",
        cancelAtPeriodEnd: !immediate,
        cancelledAt: now,
        updatedAt: now,
        // If immediate, the period ends now; otherwise access runs to currentPeriodEnd.
        ...(immediate ? { currentPeriodEnd: now } : {}),
      },
      include: { plan: true },
    });

    await tx.subscriptionPayment.create({
      data: {
        gymId,
        planId: sub.planId ?? null,
        amount: 0,
        currency: sub.currency,
        status: "FAILED",
        provider: PROVIDER,
        failureReason: immediate ? "Cancelled immediately" : "Cancelled at period end",
      },
    });

    await auditLog(tx, {
      action: "SUBSCRIPTION_CANCELLED",
      gymId,
      planId: sub.planId ?? null,
      subscriptionId: s.id,
      actor,
      reason: immediate ? "Immediate cancellation" : "Cancel at period end",
      details: { policy: settings.cancellationPolicy, cancelAtPeriodEnd: s.cancelAtPeriodEnd, currentPeriodEnd: s.currentPeriodEnd },
    });

    return s;
  });

  return {
    data: {
      subscriptionId: updated.id,
      status: updated.status,
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
      currentPeriodEnd: updated.currentPeriodEnd,
      cancelledAt: updated.cancelledAt,
      alreadyCancelled: false,
    },
    message: immediate
      ? "Subscription cancelled immediately"
      : "Subscription will end at the end of the current billing period",
  };
}

// ---------------------------------------------------------------------------
// Super-admin plan management
// ---------------------------------------------------------------------------

export async function listAllPlans() {
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  return { data: plans.map(publicPlan) };
}

export async function createPlan(data, actor) {
  requireSuperAdmin(actor);
  const plan = await prisma.subscriptionPlan.create({
    data: {
      code: data.code,
      name: data.name,
      description: data.description ?? null,
      pricePaise: data.pricePaise,
      currency: data.currency ?? CURRENCY,
      durationMonths: data.durationMonths,
      isActive: data.isActive ?? true,
      displayOrder: data.displayOrder ?? 0,
      features: data.features ?? [],
      maxStaff: data.maxStaff ?? null,
      maxBranches: data.maxBranches ?? null,
    },
  });
  await prisma.subscriptionAuditLog.create({
    data: {
      action: "PLAN_CREATED",
      planId: plan.id,
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      reason: "Plan created",
      details: { code: plan.code, name: plan.name, pricePaise: plan.pricePaise },
    },
  });
  return { data: publicPlan(plan) };
}

export async function updatePlan(id, data, actor) {
  requireSuperAdmin(actor);
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!existing) throw notFound("Plan not found", "PLAN_NOT_FOUND");

  const plan = await prisma.subscriptionPlan.update({
    where: { id },
    data: {
      ...(data.code !== undefined ? { code: data.code } : {}),
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.pricePaise !== undefined ? { pricePaise: data.pricePaise } : {}),
      ...(data.currency !== undefined ? { currency: data.currency } : {}),
      ...(data.durationMonths !== undefined ? { durationMonths: data.durationMonths } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.displayOrder !== undefined ? { displayOrder: data.displayOrder } : {}),
      ...(data.features !== undefined ? { features: data.features } : {}),
      ...(data.maxStaff !== undefined ? { maxStaff: data.maxStaff } : {}),
      ...(data.maxBranches !== undefined ? { maxBranches: data.maxBranches } : {}),
    },
  });
  await prisma.subscriptionAuditLog.create({
    data: {
      action: "PLAN_UPDATED",
      planId: plan.id,
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      reason: "Plan updated",
      details: data,
    },
  });
  return { data: publicPlan(plan) };
}

export async function setPlanStatus(id, isActive, actor) {
  requireSuperAdmin(actor);
  const existing = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!existing) throw notFound("Plan not found", "PLAN_NOT_FOUND");

  const plan = await prisma.subscriptionPlan.update({
    where: { id },
    data: { isActive },
  });
  await prisma.subscriptionAuditLog.create({
    data: {
      action: isActive ? "PLAN_ACTIVATED" : "PLAN_DEACTIVATED",
      planId: plan.id,
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      reason: isActive ? "Plan activated" : "Plan deactivated",
      details: { isActive },
    },
  });
  // Deactivating a plan does NOT cancel existing subscriptions (snapshots preserve terms).
  return { data: { id: plan.id, code: plan.code, name: plan.name, isActive: plan.isActive } };
}

// ---------------------------------------------------------------------------
// Super-admin gym subscription management
// ---------------------------------------------------------------------------

export async function searchGyms(query, { page = 1, limit = 20 }) {
  if (!query || query.trim().length < 2) {
    return { data: [], pagination: { page, limit, total: 0, totalPages: 0 } };
  }
  const skip = (page - 1) * limit;
  const take = Math.min(limit, 100);
  const where = {
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      { phone: { contains: query, mode: "insensitive" } },
    ],
  };
  const [gyms, total] = await Promise.all([
    prisma.gym.findMany({ where, skip, take, orderBy: { name: "asc" } }),
    prisma.gym.count({ where }),
  ]);
  return {
    data: gyms.map((g) => ({ id: g.id, name: g.name, email: g.email, phone: g.phone })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / take) },
  };
}

export async function getGymSubscriptionAdmin(gymId, actor) {
  requireSuperAdmin(actor);
  await findGym(gymId);
  const [subscription, payments, trials] = await Promise.all([
    prisma.gymSubscription.findUnique({
      where: { gymId },
      include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 50 } },
    }),
    prisma.trialRecord.findMany({
      where: { gymId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    data: {
      gymId,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            plan: subscription.plan ? publicPlan(subscription.plan) : null,
            planNameSnapshot: subscription.planNameSnapshot,
            pricePaise: subscription.pricePaise,
            currency: subscription.currency,
            trialStartsAt: subscription.trialStartsAt,
            trialEndsAt: subscription.trialEndsAt,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            cancelledAt: subscription.cancelledAt,
            paymentProvider: subscription.paymentProvider,
            createdAt: subscription.createdAt,
            updatedAt: subscription.updatedAt,
          }
        : null,
      payments: (subscription?.payments ?? []).map((p) => ({
        id: p.id,
        planId: p.planId,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        provider: p.provider,
        orderId: p.orderId,
        paymentId: p.paymentId,
        verifiedAt: p.verifiedAt,
        createdAt: p.createdAt,
      })),
      trialHistory: trials.map((t) => ({
        id: t.id,
        type: t.type,
        startsAt: t.startsAt,
        endsAt: t.endsAt,
        reason: t.reason,
        grantedById: t.grantedById,
        grantedByRole: t.grantedByRole,
        source: t.source,
        createdAt: t.createdAt,
      })),
    },
  };
}

/**
 * Extend a gym's trial. Audited admin action. Creates/extends a TRIALING
 * subscription and records a TRIALRecord of type EXTENSION.
 */
export async function extendTrial(gymId, { additionalDays, reason }, actor) {
  requireSuperAdmin(actor);
  await findGym(gymId);

  if (!additionalDays || additionalDays < 1 || additionalDays > 365) {
    throw badRequest("additionalDays must be between 1 and 365", "INVALID_EXTENSION_DAYS");
  }
  if (!reason || reason.trim().length < 3) {
    throw badRequest("A reason is required for trial extension", "REASON_REQUIRED");
  }

  const now = new Date();
  let sub = await prisma.gymSubscription.findUnique({ where: { gymId } });

  // Ensure a base subscription exists to extend.
  if (!sub) {
    sub = await prisma.gymSubscription.create({
      data: {
        gymId,
        status: "TRIALING",
        planId: null,
        planNameSnapshot: "Free trial",
        pricePaise: 0,
        currency: CURRENCY,
        trialStartsAt: now,
        trialEndsAt: now,
        paymentProvider: null,
      },
    });
  }

  const currentEnd = sub.trialEndsAt ?? now;
  const newEnd = addDays(currentEnd, additionalDays);

  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.gymSubscription.update({
      where: { gymId },
      data: {
        status: "TRIALING",
        trialEndsAt: newEnd,
        trialStartsAt: sub.trialStartsAt ?? now,
        updatedAt: now,
      },
    });

    await tx.trialRecord.create({
      data: {
        gymId,
        type: "EXTENSION",
        startsAt: now,
        endsAt: newEnd,
        reason: reason.trim(),
        grantedById: actor.id,
        grantedByRole: actor.role,
        source: "ADMIN_EXTENSION",
      },
    });

    await auditLog(tx, {
      action: "TRIAL_EXTENDED",
      gymId,
      subscriptionId: s.id,
      actor,
      reason: reason.trim(),
      details: { additionalDays, previousEndsAt: currentEnd, newEndsAt: newEnd },
    });

    return s;
  });

  return {
    data: {
      subscriptionId: updated.id,
      status: updated.status,
      trialEndsAt: updated.trialEndsAt,
      extendedByDays: additionalDays,
    },
    message: `Trial extended by ${additionalDays} day(s)`,
  };
}

/**
 * Grant a time-limited manual entitlement. Creates a CANCELLED-at-period-end
 * subscription (or ACTIVE) with an explicit expiry, audited.
 */
export async function grantAccess(gymId, { expiresAt, reason }, actor) {
  requireSuperAdmin(actor);
  await findGym(gymId);

  const expiry = new Date(expiresAt);
  if (isNaN(expiry.getTime()) || expiry.getTime() <= Date.now()) {
    throw badRequest("expiresAt must be a future date", "INVALID_EXPIRY");
  }

  const now = new Date();
  const sub = await prisma.$transaction(async (tx) => {
    const existing = await prisma.gymSubscription.findUnique({ where: { gymId } });
    const s = existing
      ? await tx.gymSubscription.update({
          where: { gymId },
          data: {
            status: "ACTIVE",
            planId: null,
            planNameSnapshot: "Manual access grant",
            pricePaise: 0,
            currency: CURRENCY,
            currentPeriodStart: now,
            currentPeriodEnd: expiry,
            cancelAtPeriodEnd: true,
            cancelledAt: null,
            updatedAt: now,
          },
        })
      : await tx.gymSubscription.create({
          data: {
            gymId,
            status: "ACTIVE",
            planId: null,
            planNameSnapshot: "Manual access grant",
            pricePaise: 0,
            currency: CURRENCY,
            trialStartsAt: null,
            trialEndsAt: null,
            currentPeriodStart: now,
            currentPeriodEnd: expiry,
            cancelAtPeriodEnd: true,
            cancelledAt: null,
            paymentProvider: null,
          },
        });

    await tx.trialRecord.create({
      data: {
        gymId,
        type: "EXTENSION",
        startsAt: now,
        endsAt: expiry,
        reason: reason.trim(),
        grantedById: actor.id,
        grantedByRole: actor.role,
        source: "ADMIN_GRANT",
      },
    });

    await auditLog(tx, {
      action: "ACCESS_GRANTED",
      gymId,
      subscriptionId: s.id,
      actor,
      reason: reason.trim(),
      details: { expiresAt: expiry, grantedUntil: expiry },
    });

    return s;
  });

  return {
    data: {
      subscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd,
      expiresAt,
    },
    message: `Manual access granted until ${expiresAt.toISOString()}`,
  };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function readSettings() {
  const settings = await getSettingsRow();
  return {
    data: {
      trialEnabled: settings.trialEnabled,
      trialDurationDays: settings.trialDurationDays,
      trialPricePaise: settings.trialPricePaise,
      trialRequiresPaymentMethod: settings.trialRequiresPaymentMethod,
      cancellationPolicy: settings.cancellationPolicy,
      reminderDaysBefore: settings.reminderDaysBefore,
      updatedAt: settings.updatedAt,
    },
  };
}

export async function updateSettings(data, actor) {
  requireSuperAdmin(actor);
  const updatable = {};
  if (data.trialEnabled !== undefined) updatable.trialEnabled = data.trialEnabled;
  if (data.trialDurationDays !== undefined) {
    if (data.trialDurationDays < 1 || data.trialDurationDays > 365) {
      throw badRequest("trialDurationDays must be between 1 and 365", "INVALID_TRIAL_DURATION");
    }
    updatable.trialDurationDays = data.trialDurationDays;
  }
  if (data.trialPricePaise !== undefined) updatable.trialPricePaise = data.trialPricePaise;
  if (data.trialRequiresPaymentMethod !== undefined) updatable.trialRequiresPaymentMethod = data.trialRequiresPaymentMethod;
  if (data.cancellationPolicy !== undefined) {
    if (!["END_OF_PERIOD", "IMMEDIATE"].includes(data.cancellationPolicy)) {
      throw badRequest("cancellationPolicy must be END_OF_PERIOD or IMMEDIATE", "INVALID_CANCELLATION_POLICY");
    }
    updatable.cancellationPolicy = data.cancellationPolicy;
  }
  if (data.reminderDaysBefore !== undefined) updatable.reminderDaysBefore = data.reminderDaysBefore;

  const settings = await prisma.subscriptionSetting.update({
    where: { id: SINGLETON_SETTINGS_ID },
    data: { ...updatable, updatedById: actor.id },
  });

  await prisma.subscriptionAuditLog.create({
    data: {
      action: "SETTINGS_UPDATED",
      actorUserId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      reason: "Subscription settings updated",
      details: updatable,
    },
  });

  return {
    data: {
      trialEnabled: settings.trialEnabled,
      trialDurationDays: settings.trialDurationDays,
      trialPricePaise: settings.trialPricePaise,
      trialRequiresPaymentMethod: settings.trialRequiresPaymentMethod,
      cancellationPolicy: settings.cancellationPolicy,
      reminderDaysBefore: settings.reminderDaysBefore,
      updatedAt: settings.updatedAt,
    },
  };
}

// ---------------------------------------------------------------------------
// Expiry reconciliation job
// ---------------------------------------------------------------------------

/**
 * Reconcile subscription statuses based on dates:
 *   TRIALING with trialEndsAt in the past -> EXPIRED
 *   ACTIVE with currentPeriodEnd in the past -> EXPIRED (unless cancelAtPeriodEnd already handled)
 *   CANCELLED with cancelAtPeriodEnd && currentPeriodEnd in past -> EXPIRED
 * Returns a summary of what changed.
 */
export async function reconcileExpiredSubscriptions(now = new Date()) {
  const expiredTrials = await prisma.gymSubscription.findMany({
    where: {
      status: "TRIALING",
      trialEndsAt: { lt: now },
    },
  });

  const expiredActives = await prisma.gymSubscription.findMany({
    where: {
      status: "ACTIVE",
      currentPeriodEnd: { lt: now },
    },
  });

  const expiredCancellations = await prisma.gymSubscription.findMany({
    where: {
      status: "CANCELLED",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: { lt: now },
    },
  });

  const toExpire = [...expiredTrials, ...expiredActives, ...expiredCancellations];
  const updated = [];

  for (const sub of toExpire) {
    const updatedSub = await prisma.gymSubscription.update({
      where: { id: sub.id },
      data: { status: "EXPIRED", updatedAt: now },
    });
    await prisma.subscriptionAuditLog.create({
      data: {
        action: "SUBSCRIPTION_EXPIRED",
        gymId: sub.gymId,
        subscriptionId: sub.id,
        actor: null,
        reason: "Automatic expiry reconciliation",
        details: { previousStatus: sub.status, expiredAt: now },
      },
    });
    updated.push(updatedSub);
  }

  return {
    reconciledAt: now,
    expiredCount: updated.length,
    expired: updated.map((s) => ({ gymId: s.gymId, id: s.id, status: s.status })),
  };
}
