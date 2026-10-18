// Subscription entitlement middleware.
//
// Protects paid gym-management features. Checks the current gym's subscription
// entitlement on every request (in addition to any scheduled expiry job), so
// access control never relies exclusively on a background job.
//
// When a trial or paid subscription expires, returns HTTP 402 with a
// structured SUBSCRIPTION_REQUIRED error. Login, account access, billing,
// plan listing, payment history, and renewal flows are NOT protected by this
// middleware (those routes must not apply it).

import { prisma } from "../db.js";
import { computeEntitlement } from "../services/subscription.service.js";
import { paymentRequired } from "../utils/http-error.js";

/**
 * Middleware factory: requireActiveSubscription.
 *
 * Usage (applied after authenticate + requireGym):
 *   router.use(authenticate, requireGym, requireActiveSubscription());
 *
 * Exempt paths (passed as `exempt` array) can skip the check — useful for
 * billing/renewal endpoints on the same router.
 */
export function requireActiveSubscription({ exempt = [] } = {}) {
  return async (req, res, next) => {
    try {
      // Skip exempt paths (e.g. /cancel, /checkout, /verify, /trial, /plans, /history).
      if (exempt.includes(req.path)) return next();

      const gymId = req.user?.gymId ?? req.gymId ?? null;
      if (!gymId) {
        // No gym associated; let requireGym/auth handle that. Don't double-handle.
        return next();
      }

      const sub = await prisma.gymSubscription.findUnique({
        where: { gymId },
        select: {
          id: true,
          status: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          planId: true,
          planNameSnapshot: true,
        },
      });

      const entitlement = computeEntitlement(sub, new Date());
      req.subscription = entitlement.subscription ?? null;
      req.entitlement = entitlement;

      if (!entitlement.entitled) {
        return res.status(402).json({
          error: "Subscription required",
          code: "SUBSCRIPTION_REQUIRED",
          reason: entitlement.reason,
          expiresAt: entitlement.expiresAt,
          remainingDays: entitlement.remainingDays,
          message: subscriptionExpiredMessage(entitlement.reason),
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

function subscriptionExpiredMessage(reason) {
  switch (reason) {
    case "TRIAL_EXPIRED":
      return "Your free trial has expired. Please subscribe to continue using gym management features.";
    case "SUBSCRIPTION_EXPIRED":
      return "Your subscription has expired. Please renew to continue.";
    case "CANCELLED_IMMEDIATE":
      return "Your subscription has been cancelled.";
    case "NO_SUBSCRIPTION":
      return "No active subscription found. Please start a trial or subscribe.";
    default:
      return "Your subscription is not currently active.";
  }
}
