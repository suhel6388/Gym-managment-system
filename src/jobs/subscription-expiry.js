// Background job: subscription status reconciliation and reminders.
//
// Runs reconcileExpiredSubscriptions() on an interval so expired trials and
// paid periods are marked EXPIRED even between API requests. Access control
// does NOT rely exclusively on this job — requireActiveSubscription checks
// entitlement on every request too (defense in depth).
//
// Usage:
//   import { startExpiryJob, stopExpiryJob } from "../jobs/subscription-expiry.js";
//   startExpiryJob();  // call once when the server starts

import { reconcileExpiredSubscriptions } from "../services/subscription.service.js";

// Default: reconcile every 15 minutes. Override with SUBSCRIPTION_RECONCILE_INTERVAL_MS.
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

let timer = null;
let running = false;

export function startExpiryJob(intervalMs = Number(process.env.SUBSCRIPTION_RECONCILE_INTERVAL_MS) || DEFAULT_INTERVAL_MS) {
  if (timer) return;
  if (intervalMs < 60 * 1000) {
    throw new Error("SUBSCRIPTION_RECONCILE_INTERVAL_MS must be at least 60000ms (1 minute)");
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      const result = await reconcileExpiredSubscriptions();
      if (result.expiredCount > 0) {
        console.log(
          `[subscription-expiry] reconciled ${result.expiredCount} expired subscription(s) at ${result.reconciledAt.toISOString()}`
        );
      }
    } catch (err) {
      console.error("[subscription-expiry] reconciliation failed:", err.message);
    } finally {
      running = false;
    }
  }

  // Run once shortly after startup, then on the interval.
  setTimeout(tick, 5000);
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
}

export function stopExpiryJob() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
