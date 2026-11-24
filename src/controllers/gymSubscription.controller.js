// ---------------------------------------------------------------------------
// Gym subscription controllers (owner status + super-admin management).
//
// Mutations delegate to the existing, already-audited super-admin services so
// there is exactly one implementation of "grant trial / assign plan / extend /
// suspend". This module only adds the /platform route surface.
// ---------------------------------------------------------------------------

import { prisma } from "../db.js";
import { notFound } from "../utils/http-error.js";
import {
  assignPlan,
  endTrial,
  extendExpiry,
  getGymDetail,
  setAccessStatus,
  startOrExtendTrial,
} from "../services/super-admin.service.js";
import {
  getSubscriptionSummary,
  getMySubscription,
  resolvePlanDurationDays,
  serializeSubscriptionForOwner,
} from "../services/subscription.service.js";
import {
  gymSubscriptionActionSchema,
  gymAuditQuerySchema,
} from "../validators/platform.validator.js";

/** GET /platform/subscription — owner's current subscription. */
export async function getMySubscriptionHandler(req, res, next) {
  try {
    if (!req.user?.gymId) {
      return res.status(400).json({
        error: "No gym associated with this account",
        code: "NO_GYM",
      });
    }
    const result = await getMySubscription(req.user.gymId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /platform/subscription/summary — lightweight login/guard payload. */
export async function getMySubscriptionSummary(req, res, next) {
  try {
    if (!req.user?.gymId) {
      return res.status(400).json({
        error: "No gym associated with this account",
        code: "NO_GYM",
      });
    }
    const summary = await getSubscriptionSummary(req.user.gymId);
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /platform/admin/gyms/:gymId/subscription
 * Lean billing panel payload: subscription + plan + recent payments + audit.
 */
export async function getGymSubscription(req, res, next) {
  try {
    const gymId = req.params.gymId;

    const [gym, subscription, payments, audits, trials] = await Promise.all([
      prisma.gym.findUnique({
        where: { id: gymId },
        select: { id: true, name: true, email: true, phone: true },
      }),
      prisma.gymSubscription.findUnique({
        where: { gymId },
        include: { plan: true },
      }),
      prisma.subscriptionPayment.findMany({
        where: { gymId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.subscriptionAuditLog.findMany({
        where: { gymId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.trialRecord.findMany({
        where: { gymId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    if (!gym) throw notFound("Gym not found", "GYM_NOT_FOUND");

    const summary = await getSubscriptionSummary(gymId);

    res.json({
      data: {
        gym,
        summary,
        subscription: subscription
          ? {
              ...subscription,
              planName: subscription.planNameSnapshot ?? subscription.plan?.name ?? null,
              durationDays: subscription.plan
                ? resolvePlanDurationDays(subscription.plan)
                : null,
              expiresAt: serializeSubscriptionForOwner(subscription).expiresAt,
            }
          : null,
        payments: payments.map((payment) => ({
          id: payment.id,
          planId: payment.planId,
          planName: payment.planSnapshot?.name ?? null,
          amountPaise: Math.round(Number(payment.amount) || 0),
          currency: payment.currency,
          status: payment.status,
          orderId: payment.orderId,
          paymentId: payment.paymentId,
          couponCode: payment.couponCode ?? null,
          amountBreakdown: payment.amountBreakdown ?? null,
          verifiedAt: payment.verifiedAt,
          createdAt: payment.createdAt,
        })),
        audits: audits.map((log) => ({
          id: log.id,
          action: log.action,
          actorEmail: log.actorEmail,
          actorRole: log.actorRole,
          reason: log.reason,
          oldValues: log.oldValues ?? null,
          newValues: log.newValues ?? null,
          details: log.details ?? null,
          at: log.createdAt,
        })),
        trials,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/admin/gyms/:gymId/subscription — audited manual action. */
export async function updateGymSubscription(req, res, next) {
  try {
    const input = gymSubscriptionActionSchema.parse(req.body ?? {});
    const { gymId } = req.params;

    let result;
    switch (input.action) {
      case "grant_trial":
        result = await startOrExtendTrial(req.user, gymId, {
          days: input.days ?? 14,
          reason: input.reason,
        });
        break;
      case "assign_plan":
        result = await assignPlan(req.user, gymId, {
          planId: input.planId,
          expiresAt: input.expiresAt,
          reason: input.reason,
        });
        break;
      case "extend":
        result = await extendExpiry(req.user, gymId, {
          additionalDays: input.additionalDays,
          expiresAt: input.expiresAt,
          reason: input.reason,
        });
        break;
      case "suspend":
        result = await setAccessStatus(req.user, gymId, {
          status: "SUSPENDED",
          reason: input.reason,
        });
        break;
      case "resume":
        result = await setAccessStatus(req.user, gymId, {
          status: "ACTIVE",
          reason: input.reason,
        });
        break;
      case "end_trial":
        result = await endTrial(req.user, gymId, { reason: input.reason });
        break;
      default:
        // Unreachable: zod restricts the enum.
        result = null;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
}

/** GET /platform/admin/gyms/:gymId/audit — full audit trail for one gym. */
export async function listGymAudit(req, res, next) {
  try {
    const { limit } = gymAuditQuerySchema.parse(req.query);
    const logs = await prisma.subscriptionAuditLog.findMany({
      where: { gymId: req.params.gymId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    res.json({
      data: logs.map((log) => ({
        id: log.id,
        action: log.action,
        planId: log.planId,
        subscriptionId: log.subscriptionId,
        actorEmail: log.actorEmail,
        actorRole: log.actorRole,
        reason: log.reason,
        oldValues: log.oldValues ?? null,
        newValues: log.newValues ?? null,
        details: log.details ?? null,
        at: log.createdAt,
      })),
    });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/admin/gyms/:gymId — full platform gym detail (reused UI). */
export async function getGymDetailHandler(req, res, next) {
  try {
    const result = await getGymDetail(req.user, req.params.gymId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
