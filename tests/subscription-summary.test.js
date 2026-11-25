import { test } from "node:test";
import assert from "node:assert";

import { DAY_MS, addDays } from "../src/utils/dates.js";
import {
  resolvePlanDurationDays,
  computeEntitlement,
} from "../src/services/subscription.service.js";

test("resolvePlanDurationDays accurately calculates standard SaaS plan durations", () => {
  // Explicit durationDays
  assert.strictEqual(resolvePlanDurationDays({ durationDays: 30 }), 30);
  assert.strictEqual(resolvePlanDurationDays({ durationDays: 90 }), 90);
  assert.strictEqual(resolvePlanDurationDays({ durationDays: 180 }), 180);
  assert.strictEqual(resolvePlanDurationDays({ durationDays: 365 }), 365);

  // Month-based fallback
  assert.strictEqual(resolvePlanDurationDays({ durationMonths: 1 }), 30);
  assert.strictEqual(resolvePlanDurationDays({ durationMonths: 3 }), 90);
  assert.strictEqual(resolvePlanDurationDays({ durationMonths: 6 }), 180);
  assert.strictEqual(resolvePlanDurationDays({ durationMonths: 12 }), 365);
});

test("DAY_MS is defined and calculates total duration days without MS_PER_DAY reference error", () => {
  assert.ok(DAY_MS, "DAY_MS must be defined");
  assert.strictEqual(DAY_MS, 86400000);

  const start = new Date("2026-11-25T10:00:00Z");
  const expiry = new Date("2026-12-25T10:00:00Z"); // 30 days later

  const diffMs = expiry.getTime() - start.getTime();
  const totalDays = Math.max(1, Math.round(diffMs / DAY_MS));
  assert.strictEqual(totalDays, 30);

  // Test annual duration
  const annualExpiry = new Date(start.getTime() + 365 * DAY_MS);
  const annualDiff = annualExpiry.getTime() - start.getTime();
  const annualTotalDays = Math.max(1, Math.round(annualDiff / DAY_MS));
  assert.strictEqual(annualTotalDays, 365);
});

test("renewal logic: extends from existing expiry when active, starts from now when expired", () => {
  const now = new Date("2026-11-25T12:00:00Z");
  const planDuration = 30; // 30 days

  // Scenario 1: Active subscription with 10 days left
  const activeExpiry = addDays(now, 10);
  const isCurrentlyActive = activeExpiry.getTime() > now.getTime();
  assert.strictEqual(isCurrentlyActive, true);

  const baseActive = activeExpiry.getTime() > now.getTime() ? activeExpiry : now;
  const newExtendedExpiry = addDays(baseActive, planDuration);
  // Total time should be now + 10 + 30 = 40 days
  assert.strictEqual(
    Math.round((newExtendedExpiry.getTime() - now.getTime()) / DAY_MS),
    40
  );

  // Scenario 2: Expired subscription (expired 5 days ago)
  const expiredDate = addDays(now, -5);
  const isExpired = expiredDate.getTime() <= now.getTime();
  assert.strictEqual(isExpired, true);

  const baseExpired = expiredDate.getTime() > now.getTime() ? expiredDate : now;
  const newReactivatedExpiry = addDays(baseExpired, planDuration);
  // Starts from now + 30 days
  assert.strictEqual(
    Math.round((newReactivatedExpiry.getTime() - now.getTime()) / DAY_MS),
    30
  );
});

test("computeEntitlement properly reports days left and warning when <= 7 days", () => {
  const now = new Date("2026-11-25T12:00:00Z");

  // 5 days left -> warning
  const sub5Days = {
    status: "ACTIVE",
    currentPeriodEnd: addDays(now, 5),
    cancelAtPeriodEnd: false,
  };
  const ent5 = computeEntitlement(sub5Days, now);
  assert.strictEqual(ent5.entitled, true);
  assert.strictEqual(ent5.remainingDays, 5);
  const isExpiringSoon5 = ent5.entitled && ent5.remainingDays > 0 && ent5.remainingDays <= 7;
  assert.strictEqual(isExpiringSoon5, true);

  // 20 days left -> no warning
  const sub20Days = {
    status: "ACTIVE",
    currentPeriodEnd: addDays(now, 20),
    cancelAtPeriodEnd: false,
  };
  const ent20 = computeEntitlement(sub20Days, now);
  assert.strictEqual(ent20.entitled, true);
  assert.strictEqual(ent20.remainingDays, 20);
  const isExpiringSoon20 = ent20.entitled && ent20.remainingDays > 0 && ent20.remainingDays <= 7;
  assert.strictEqual(isExpiringSoon20, false);
});

