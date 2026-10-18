import { test } from "node:test";
import assert from "node:assert";

// Pure unit tests for subscription date helpers and entitlement computation.
// No database required.

import { addMonthsClamped, addDays, daysRemaining, isFuture } from "../src/utils/dates.js";
import { computeEntitlement } from "../src/services/subscription.service.js";

const now = new Date("2026-10-18T10:00:00Z");

test("addDays adds whole days", (t) => {
  const base = new Date("2026-10-18T10:00:00Z");
  const result = addDays(base, 14);
  assert.strictEqual(result.getDate(), 1);
  assert.strictEqual(result.getMonth(), 10); // Oct 18 + 14 days = Nov 1 (month index 10)
});

test("addMonthsClamped clamps end-of-month", (t) => {
  const jan31 = new Date(Date.UTC(2026, 0, 31, 10, 0, 0));
  const feb = addMonthsClamped(jan31, 1);
  assert.strictEqual(feb.getUTCMonth(), 1);
  assert.strictEqual(feb.getUTCDate(), 28); // 2026 is not a leap year
});

test("daysRemaining returns 0 for past/null dates", (t) => {
  assert.strictEqual(daysRemaining(null), 0);
  assert.strictEqual(daysRemaining(new Date("2020-01-01"), now), 0);
  assert.strictEqual(daysRemaining(now, now), 0);
});

test("daysRemaining rounds up and never negative", (t) => {
  const future = new Date(now.getTime() + 25 * 60 * 60 * 1000); // 25 hours
  assert.strictEqual(daysRemaining(future, now), 2);
});

test("isFuture is strict", (t) => {
  assert.strictEqual(isFuture(now, now), false);
  assert.strictEqual(isFuture(null, now), false);
  assert.strictEqual(isFuture(new Date(now.getTime() + 1000), now), true);
});

test("computeEntitlement: TRIALING in future is entitled", (t) => {
  const sub = {
    status: "TRIALING",
    trialEndsAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
  const e = computeEntitlement(sub, now);
  assert.strictEqual(e.entitled, true);
  assert.strictEqual(e.reason, "TRIAL_ACTIVE");
  assert.strictEqual(e.remainingDays, 5);
});

test("computeEntitlement: TRIALING expired is not entitled", (t) => {
  const sub = {
    status: "TRIALING",
    trialEndsAt: new Date(now.getTime() - 1000),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
  const e = computeEntitlement(sub, now);
  assert.strictEqual(e.entitled, false);
  assert.strictEqual(e.reason, "TRIAL_EXPIRED");
});

test("computeEntitlement: ACTIVE in period is entitled", (t) => {
  const sub = {
    status: "ACTIVE",
    trialEndsAt: null,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
  };
  const e = computeEntitlement(sub, now);
  assert.strictEqual(e.entitled, true);
  assert.strictEqual(e.reason, "SUBSCRIPTION_ACTIVE");
});

test("computeEntitlement: CANCELLED at period end still entitled until period ends", (t) => {
  const sub = {
    status: "CANCELLED",
    trialEndsAt: null,
    currentPeriodEnd: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: true,
  };
  const e = computeEntitlement(sub, now);
  assert.strictEqual(e.entitled, true);
  assert.strictEqual(e.reason, "CANCELLED_AT_PERIOD_END");
});

test("computeEntitlement: CANCELLED immediate is not entitled", (t) => {
  const sub = {
    status: "CANCELLED",
    trialEndsAt: null,
    currentPeriodEnd: new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: false,
  };
  const e = computeEntitlement(sub, now);
  assert.strictEqual(e.entitled, false);
  assert.strictEqual(e.reason, "CANCELLED_IMMEDIATE");
});

test("computeEntitlement: no subscription is not entitled", (t) => {
  const e = computeEntitlement(null, now);
  assert.strictEqual(e.entitled, false);
  assert.strictEqual(e.reason, "NO_SUBSCRIPTION");
  assert.strictEqual(e.remainingDays, 0);
});
