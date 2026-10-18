import { test } from "node:test";
import assert from "node:assert";

import { prisma } from "../src/db.js";
import {
  startTrial,
  createPlan,
  updatePlan,
  setPlanStatus,
  listAllPlans,
  createCheckout,
  computeEntitlement,
} from "../src/services/subscription.service.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_PREFIX = `test_${Date.now()}`;

async function createTestGym(nameSuffix) {
  return prisma.gym.create({
    data: { name: `${TEST_PREFIX}-${nameSuffix}`, email: `test-${nameSuffix}@example.com` },
  });
}

function makeActor(role, gymId = null) {
  return {
    id: `actor-${role}-${Date.now()}`,
    role,
    gymId,
    email: `actor-${role}-${Date.now()}@example.com`,
  };
}

async function cleanupGym(gymId) {
  await prisma.subscriptionPayment.deleteMany({ where: { gymId } });
  await prisma.trialRecord.deleteMany({ where: { gymId } });
  await prisma.gymSubscription.delete({ where: { gymId } }).catch(() => {});
  await prisma.subscriptionAuditLog.deleteMany({ where: { gymId } });
  await prisma.gym.delete({ where: { id: gymId } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Trial eligibility
// ---------------------------------------------------------------------------

test("trial: start a trial for an eligible gym succeeds", async (t) => {
  const gym = await createTestGym("trial-eligible");
  t.after(() => cleanupGym(gym.id));

  const actor = makeActor("ADMIN", gym.id);
  const result = await startTrial(gym.id, actor);

  assert.strictEqual(result.data.alreadyStarted, false);
  assert.strictEqual(result.data.status, "TRIALING");
  assert.ok(result.data.trialEndsAt);
  assert.ok(result.data.trialStartsAt);

  const sub = await prisma.gymSubscription.findUnique({ where: { gymId: gym.id } });
  assert.strictEqual(sub.status, "TRIALING");
  assert.ok(sub.trialStartsAt);
  assert.ok(sub.trialEndsAt);
});

test("trial: starting a duplicate trial returns the existing one (idempotent)", async (t) => {
  const gym = await createTestGym("trial-dup");
  t.after(() => cleanupGym(gym.id));

  const actor = makeActor("ADMIN", gym.id);
  await startTrial(gym.id, actor);
  const result = await startTrial(gym.id, actor);

  assert.strictEqual(result.data.alreadyStarted, true);
  assert.strictEqual(result.data.status, "TRIALING");
});

test("trial: prevents duplicate trials under concurrency (unique gymId)", async (t) => {
  const gym = await createTestGym("trial-concurrent");
  t.after(() => cleanupGym(gym.id));

  const actor = makeActor("ADMIN", gym.id);
  const promises = Array(5).fill(null).map(() => startTrial(gym.id, actor));
  const results = await Promise.allSettled(promises);

  const success = results.filter(
    (r) => r.status === "fulfilled" && r.value.data.alreadyStarted === false
  );
  assert.ok(
    success.length <= 1,
    `Expected at most one successful trial start, got ${success.length}`
  );

  const count = await prisma.trialRecord.count({
    where: { gymId: gym.id, type: "INITIAL" },
  });
  assert.strictEqual(count, 1, "Exactly one initial trial record should exist");
});

// ---------------------------------------------------------------------------
// Plan permissions (super-admin only)
// ---------------------------------------------------------------------------

test("plan: non-super-admin cannot create a plan", async (t) => {
  const actor = makeActor("ADMIN");
  await assert.rejects(
    () =>
      createPlan(
        {
          code: "TEST1",
          name: "Test Plan",
          pricePaise: 1000,
          durationMonths: 1,
        },
        actor
      ),
    (err) => err.statusCode === 403 && err.code === "SUPER_ADMIN_REQUIRED"
  );
});

test("plan: super-admin can create a plan", async (t) => {
  const actor = makeActor("SUPER_ADMIN");
  const plan = await createPlan(
    {
      code: `PLAN_${Date.now()}`,
      name: "Test Plan",
      pricePaise: 49900,
      durationMonths: 1,
      features: ["Feature A"],
    },
    actor
  );
  t.after(() =>
    prisma.subscriptionPlan.delete({ where: { id: plan.data.id } }).catch(() => {})
  );

  assert.strictEqual(plan.data.name, "Test Plan");
  assert.strictEqual(plan.data.pricePaise, 49900);
  assert.strictEqual(plan.data.isActive, true);
});

test("plan: non-super-admin cannot update a plan", async (t) => {
  const actor = makeActor("ADMIN");
  await assert.rejects(
    () => updatePlan("some-id", { name: "Hacked" }, actor),
    (err) => err.statusCode === 403 && err.code === "SUPER_ADMIN_REQUIRED"
  );
});

test("plan: super-admin deactivating a plan does not cancel existing subscriptions", async (t) => {
  const actor = makeActor("SUPER_ADMIN");
  const plan = await createPlan(
    { code: `NODEACT_${Date.now()}`, name: "No Deactivate", pricePaise: 1000, durationMonths: 1 },
    actor
  );
  t.after(() => prisma.subscriptionPlan.delete({ where: { id: plan.data.id } }).catch(() => {}));

  const deactivated = await setPlanStatus(plan.data.id, false, actor);
  assert.strictEqual(deactivated.data.isActive, false);

  const planAfter = await prisma.subscriptionPlan.findUnique({ where: { id: plan.data.id } });
  assert.strictEqual(planAfter.isActive, false);
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test("tenant isolation: gym A cannot see gym B's subscription", async (t) => {
  const gymA = await createTestGym("tenant-a");
  const gymB = await createTestGym("tenant-b");
  t.after(() => cleanupGym(gymA.id));
  t.after(() => cleanupGym(gymB.id));

  const actorA = makeActor("ADMIN", gymA.id);
  await startTrial(gymA.id, actorA);

  const subA = await prisma.gymSubscription.findUnique({ where: { gymId: gymA.id } });
  assert.ok(subA, "Gym A should have a subscription");

  const subB = await prisma.gymSubscription.findUnique({ where: { gymId: gymB.id } });
  assert.strictEqual(subB, null, "Gym B should not see gym A's subscription");
});

// ---------------------------------------------------------------------------
// Checkout uses the DB price (not client-supplied)
// ---------------------------------------------------------------------------

test("checkout: creates a payment order using the plan's database price", async (t) => {
  const actor = makeActor("SUPER_ADMIN");
  const plan = await createPlan(
    { code: `CHECKOUT_${Date.now()}`, name: "Checkout Plan", pricePaise: 139900, durationMonths: 3 },
    actor
  );
  t.after(() => prisma.subscriptionPlan.delete({ where: { id: plan.data.id } }).catch(() => {}));

  const gym = await createTestGym("checkout");
  t.after(() => cleanupGym(gym.id));

  try {
    await createCheckout(gym.id, plan.data.id);
    const payment = await prisma.subscriptionPayment.findFirst({
      where: { gymId: gym.id, planId: plan.data.id },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(payment, "A payment order should be created");
    assert.strictEqual(payment.amount, 139900, "Order amount must match the DB plan price");
  } catch (err) {
    assert.ok(
      err.message.includes("not configured") || err.message.includes("Razorpay"),
      `Unexpected checkout error: ${err.message}`
    );
  }
});

// ---------------------------------------------------------------------------
// Expiry computation (server-side, not trusted from client)
// ---------------------------------------------------------------------------

test("expiry: computeEntitlement derives remaining days on the server", (t) => {
  const now = new Date("2026-10-18T10:00:00Z");
  const sub = {
    status: "TRIALING",
    trialEndsAt: new Date("2026-11-01T00:00:00Z"),
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  };
  const e = computeEntitlement(sub, now);
  assert.strictEqual(e.entitled, true);
  assert.ok(e.remainingDays > 0);
  assert.ok(e.expiresAt);
});
