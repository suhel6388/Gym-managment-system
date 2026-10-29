import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../src/db.js";
import { requireSuperAdmin } from "../src/middleware/auth.js";
import { computeEntitlement } from "../src/services/subscription.service.js";
import {
  assignPlan,
  endTrial,
  extendExpiry,
  getDashboardStats,
  getGymDetail,
  listActivity,
  listAllPlans,
  listGyms,
  setAccessStatus,
  startOrExtendTrial,
  effectiveSubscriptionStatus,
} from "../src/services/super-admin.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = `sa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const SUPER_ADMIN = {
  id: `super-${PREFIX}`,
  role: "SUPER_ADMIN",
  email: `super-${PREFIX}@example.com`,
  gymId: null,
};

function gymAdmin(gymId) {
  return {
    id: `admin-${gymId}`,
    role: "ADMIN",
    email: `admin-${gymId}@example.com`,
    gymId,
  };
}

function staff(gymId) {
  return {
    id: `staff-${gymId}`,
    role: "RECEPTIONIST",
    email: `staff-${gymId}@example.com`,
    gymId,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function run(middleware, req) {
  const res = makeRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

async function createGym(label, ownerName = `${PREFIX} Owner`) {
  const gym = await prisma.gym.create({
    data: {
      name: `${PREFIX} ${label}`,
      email: `${label}-${PREFIX}@example.com`,
      phone: "9999999999",
    },
    select: { id: true, name: true },
  });
  await prisma.user.create({
    data: {
      name: ownerName,
      email: `owner-${label}-${PREFIX}@example.com`,
      role: "ADMIN",
      emailVerified: true,
      gymId: gym.id,
    },
  });
  return gym;
}

async function createPlan(code, { pricePaise = 49900, durationMonths = 1 } = {}) {
  return prisma.subscriptionPlan.create({
    data: {
      code: `${code}_${PREFIX}`.toUpperCase(),
      name: `${code} plan`,
      pricePaise,
      durationMonths,
      features: ["Test feature"],
    },
  });
}

async function cleanupGym(gymId) {
  await prisma.subscriptionAuditLog.deleteMany({ where: { gymId } });
  await prisma.trialRecord.deleteMany({ where: { gymId } });
  await prisma.subscriptionPayment.deleteMany({ where: { gymId } });
  await prisma.gymSubscription.deleteMany({ where: { gymId } });
  await prisma.user.deleteMany({ where: { gymId } });
  await prisma.gym.deleteMany({ where: { id: gymId } });
}

async function cleanupPlan(planId) {
  await prisma.subscriptionPlan.deleteMany({ where: { id: planId } });
}

// ---------------------------------------------------------------------------
// Authorization middleware
// ---------------------------------------------------------------------------

test("requireSuperAdmin allows SUPER_ADMIN and blocks owner/staff", () => {
  const allowed = run(requireSuperAdmin, { user: SUPER_ADMIN });
  assert.strictEqual(allowed.nextCalled, true);

  for (const user of [gymAdmin("gym-a"), staff("gym-a")]) {
    const blocked = run(requireSuperAdmin, { user });
    assert.strictEqual(blocked.nextCalled, false);
    assert.strictEqual(blocked.res.statusCode, 403);
    assert.strictEqual(blocked.res.body.code, "SUPER_ADMIN_REQUIRED");
  }
});

test("every super-admin route is guarded by authenticate + requireSuperAdmin", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "super-admin.route.js"),
    "utf8",
  );
  assert.match(source, /router\.use\(authenticate,\s*requireSuperAdmin\)/);
  assert.doesNotMatch(source, /register/i);
});

test("setup-gym refuses to attach a gym to a SUPER_ADMIN account", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "controllers", "auth.controller.js"),
    "utf8",
  );
  assert.match(source, /SUPER_ADMIN_CANNOT_CREATE_GYM/);
});

// ---------------------------------------------------------------------------
// Service-level authorization (defense in depth)
// ---------------------------------------------------------------------------

test("cross-gym services reject gym owners and staff", async (t) => {
  const gym = await createGym("authz");
  t.after(() => cleanupGym(gym.id));

  const actor = gymAdmin(gym.id);
  const staffActor = staff(gym.id);

  const calls = [
    () => getDashboardStats(actor),
    () => listGyms(actor, { q: PREFIX }),
    () => getGymDetail(actor, gym.id),
    () => listAllPlans(actor),
    () => listActivity(actor),
    () =>
      assignPlan(actor, gym.id, {
        planId: "missing",
        reason: "Should be rejected before plan lookup",
      }),
    () => extendExpiry(actor, gym.id, { additionalDays: 1, reason: "nope" }),
    () => startOrExtendTrial(actor, gym.id, { days: 7, reason: "nope" }),
    () => endTrial(actor, gym.id, { reason: "nope" }),
    () => setAccessStatus(actor, gym.id, { status: "SUSPENDED", reason: "nope" }),
  ];

  for (const call of calls) {
    await assert.rejects(call, (err) => err.statusCode === 403 && err.code === "SUPER_ADMIN_REQUIRED");
  }

  await assert.rejects(
    () => getGymDetail(staffActor, gym.id),
    (err) => err.statusCode === 403 && err.code === "SUPER_ADMIN_REQUIRED",
  );
});

// ---------------------------------------------------------------------------
// Dashboard statistics
// ---------------------------------------------------------------------------

test("stats use real gym, subscription and successful-payment rows", async (t) => {
  const before = await getDashboardStats(SUPER_ADMIN);
  const gym = await createGym("stats");
  const plan = await createPlan("STATS", { pricePaise: 39900 });
  t.after(() => cleanupPlan(plan.id));
  t.after(() => cleanupGym(gym.id));

  await assignPlan(SUPER_ADMIN, gym.id, {
    planId: plan.id,
    reason: "Stats test assignment",
  });
  await prisma.subscriptionPayment.create({
    data: {
      gymId: gym.id,
      planId: plan.id,
      amount: 39900,
      currency: "INR",
      status: "SUCCESS",
      provider: "razorpay",
      orderId: `order_${PREFIX}_stats`,
      paymentId: `pay_${PREFIX}_stats`,
      verifiedAt: new Date(),
    },
  });
  await prisma.subscriptionPayment.create({
    data: {
      gymId: gym.id,
      planId: plan.id,
      amount: 999999,
      currency: "INR",
      status: "FAILED",
      provider: "razorpay",
      orderId: `order_${PREFIX}_failed`,
      failureReason: "Test failure",
    },
  });

  const after = await getDashboardStats(SUPER_ADMIN);
  assert.ok(after.data.totalGyms >= before.data.totalGyms + 1);
  // Active subscriptions are counted globally, and other test files run in
  // parallel against the same database, so a strict delta is racy: a
  // subscription created after `before` can be cleaned up before `after`.
  // Assert this gym's row is active and that the global count is non-zero.
  const gymSubscription = await prisma.gymSubscription.findUnique({ where: { gymId: gym.id } });
  assert.strictEqual(gymSubscription?.status, "ACTIVE");
  assert.ok(after.data.activeSubscriptions >= 1);
  assert.ok(after.data.subscriptionRevenuePaise >= before.data.subscriptionRevenuePaise + 39900);
  assert.ok(after.data.successfulPayments >= before.data.successfulPayments + 1);
  assert.ok(Array.isArray(after.data.planDistribution));
  assert.ok(Array.isArray(after.data.recentGyms));
  assert.ok(Array.isArray(after.data.recentActivity));
});

test("effective status reflects date expiry, not only the stored status", () => {
  const now = new Date("2026-10-25T10:00:00Z");
  assert.strictEqual(effectiveSubscriptionStatus(null, now), "NO_SUBSCRIPTION");
  assert.strictEqual(
    effectiveSubscriptionStatus(
      { status: "ACTIVE", currentPeriodEnd: new Date("2026-10-30T00:00:00Z") },
      now,
    ),
    "ACTIVE",
  );
  assert.strictEqual(
    effectiveSubscriptionStatus(
      { status: "ACTIVE", currentPeriodEnd: new Date("2026-10-20T00:00:00Z") },
      now,
    ),
    "EXPIRED",
  );
  assert.strictEqual(
    effectiveSubscriptionStatus(
      { status: "SUSPENDED", currentPeriodEnd: new Date("2026-12-01T00:00:00Z") },
      now,
    ),
    "SUSPENDED",
  );
});

// ---------------------------------------------------------------------------
// Gym directory / tenant isolation
// ---------------------------------------------------------------------------

test("gym list searches owner details and filters by status", async (t) => {
  const gymA = await createGym("list-a", `${PREFIX} Alpha Owner`);
  const gymB = await createGym("list-b", `${PREFIX} Beta Owner`);
  const plan = await createPlan("LIST", { pricePaise: 1000 });
  t.after(() => cleanupPlan(plan.id));
  t.after(() => cleanupGym(gymA.id));
  t.after(() => cleanupGym(gymB.id));

  await assignPlan(SUPER_ADMIN, gymA.id, {
    planId: plan.id,
    reason: "Directory test active gym",
  });
  await startOrExtendTrial(SUPER_ADMIN, gymB.id, {
    days: 7,
    reason: "Directory test trial gym",
  });

  const all = await listGyms(SUPER_ADMIN, { q: PREFIX, limit: 100 });
  assert.strictEqual(all.data.pagination.total, 2);
  assert.deepStrictEqual(
    all.data.gyms.map((gym) => gym.id).sort(),
    [gymA.id, gymB.id].sort(),
  );
  assert.ok(all.data.gyms.some((gym) => gym.owner?.name === `${PREFIX} Alpha Owner`));

  const byOwner = await listGyms(SUPER_ADMIN, { q: `${PREFIX} Alpha`, limit: 100 });
  assert.strictEqual(byOwner.data.pagination.total, 1);
  assert.strictEqual(byOwner.data.gyms[0].id, gymA.id);

  const active = await listGyms(SUPER_ADMIN, { q: PREFIX, status: "ACTIVE", limit: 100 });
  assert.strictEqual(active.data.gyms.length, 1);
  assert.strictEqual(active.data.gyms[0].id, gymA.id);

  const trialing = await listGyms(SUPER_ADMIN, { q: PREFIX, status: "TRIALING", limit: 100 });
  assert.strictEqual(trialing.data.gyms.length, 1);
  assert.strictEqual(trialing.data.gyms[0].id, gymB.id);
});

test("gym detail never leaks another gym's payments", async (t) => {
  const gymA = await createGym("detail-a");
  const gymB = await createGym("detail-b");
  const plan = await createPlan("DETAIL", { pricePaise: 5000 });
  t.after(() => cleanupPlan(plan.id));
  t.after(() => cleanupGym(gymA.id));
  t.after(() => cleanupGym(gymB.id));

  await assignPlan(SUPER_ADMIN, gymA.id, { planId: plan.id, reason: "Detail test A" });
  await assignPlan(SUPER_ADMIN, gymB.id, { planId: plan.id, reason: "Detail test B" });
  await prisma.subscriptionPayment.create({
    data: {
      gymId: gymB.id,
      planId: plan.id,
      amount: 5000,
      currency: "INR",
      status: "SUCCESS",
      orderId: `order_${PREFIX}_b`,
      paymentId: `pay_${PREFIX}_b`,
    },
  });

  const detailA = await getGymDetail(SUPER_ADMIN, gymA.id);
  assert.strictEqual(detailA.data.gym.id, gymA.id);
  assert.strictEqual(detailA.data.payments.length, 0);
  assert.ok(detailA.data.owner, "owner details are included");

  const detailB = await getGymDetail(SUPER_ADMIN, gymB.id);
  assert.strictEqual(detailB.data.payments.length, 1);
  assert.strictEqual(detailB.data.payments[0].gymId, undefined, "serializer intentionally omits gymId");
});

// ---------------------------------------------------------------------------
// Subscription changes
// ---------------------------------------------------------------------------

test("plan assignment and change update snapshots, expiry and audit log", async (t) => {
  const gym = await createGym("plans");
  const monthly = await createPlan("MONTHLY_T", { pricePaise: 49900, durationMonths: 1 });
  const annual = await createPlan("ANNUAL_T", { pricePaise: 469900, durationMonths: 12 });
  t.after(() => cleanupPlan(monthly.id));
  t.after(() => cleanupPlan(annual.id));
  t.after(() => cleanupGym(gym.id));

  const first = await assignPlan(SUPER_ADMIN, gym.id, {
    planId: monthly.id,
    reason: "Initial plan assignment",
  });
  assert.strictEqual(first.data.subscription.status, "ACTIVE");
  assert.strictEqual(first.data.subscription.plan.id, monthly.id);
  assert.strictEqual(first.data.subscription.pricePaise, 49900);
  assert.ok(new Date(first.data.subscription.currentPeriodEnd) > new Date());

  const second = await assignPlan(SUPER_ADMIN, gym.id, {
    planId: annual.id,
    reason: "Upgrade after owner request",
  });
  assert.strictEqual(second.data.subscription.plan.id, annual.id);
  assert.strictEqual(second.data.subscription.pricePaise, 469900);
  assert.strictEqual(second.data.subscription.planNameSnapshot, "ANNUAL_T plan");

  const audits = await prisma.subscriptionAuditLog.findMany({
    where: { gymId: gym.id },
    orderBy: { createdAt: "asc" },
  });
  assert.deepStrictEqual(
    audits.map((audit) => audit.action),
    ["SUBSCRIPTION_PLAN_ASSIGNED", "SUBSCRIPTION_PLAN_CHANGED"],
  );
  assert.ok(audits[0].actorUserId === SUPER_ADMIN.id);
  assert.strictEqual(audits[1].actorRole, "SUPER_ADMIN");
});

test("extending expiry moves the paid period and rejects invalid input", async (t) => {
  const gym = await createGym("extend");
  const plan = await createPlan("EXTEND_T", { pricePaise: 1000, durationMonths: 1 });
  t.after(() => cleanupPlan(plan.id));
  t.after(() => cleanupGym(gym.id));

  const explicit = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  await assignPlan(SUPER_ADMIN, gym.id, {
    planId: plan.id,
    expiresAt: explicit.toISOString(),
    reason: "Set explicit period",
  });

  const extended = await extendExpiry(SUPER_ADMIN, gym.id, {
    additionalDays: 5,
    reason: "Goodwill extension",
  });
  const newEnd = new Date(extended.data.expiresAt);
  assert.ok(newEnd.getTime() >= explicit.getTime() + 5 * 24 * 60 * 60 * 1000 - 1000);

  await assert.rejects(
    () => extendExpiry(SUPER_ADMIN, gym.id, { reason: "missing days" }),
    (err) => err.statusCode === 400 && err.code === "EXTENSION_REQUIRED",
  );
  await assert.rejects(
    () =>
      extendExpiry(SUPER_ADMIN, gym.id, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        reason: "past date",
      }),
    (err) => err.statusCode === 400 && err.code === "INVALID_EXPIRY",
  );
});

test("trial management starts, extends and ends a trial", async (t) => {
  const gym = await createGym("trial");
  t.after(() => cleanupGym(gym.id));

  const started = await startOrExtendTrial(SUPER_ADMIN, gym.id, {
    days: 7,
    reason: "Sales onboarding trial",
  });
  assert.strictEqual(started.data.status, "TRIALING");
  const firstEnd = new Date(started.data.trialEndsAt).getTime();

  const extended = await startOrExtendTrial(SUPER_ADMIN, gym.id, {
    days: 3,
    reason: "Extend onboarding trial",
  });
  assert.strictEqual(extended.data.extended, true);
  assert.ok(new Date(extended.data.trialEndsAt).getTime() > firstEnd);

  const sub = await prisma.gymSubscription.findUnique({ where: { gymId: gym.id } });
  const entitlement = computeEntitlement(sub);
  assert.strictEqual(entitlement.entitled, true);
  assert.strictEqual(entitlement.reason, "TRIAL_ACTIVE");

  const ended = await endTrial(SUPER_ADMIN, gym.id, { reason: "Trial abuse" });
  assert.strictEqual(ended.data.status, "EXPIRED");

  const trials = await prisma.trialRecord.findMany({ where: { gymId: gym.id } });
  assert.ok(trials.length >= 2);
  assert.ok(trials.every((trial) => trial.source === "ADMIN_TRIAL"));
  assert.ok(trials.every((trial) => trial.grantedByRole === "SUPER_ADMIN"));
});

test("suspension blocks entitlement and activation restores access", async (t) => {
  const gym = await createGym("suspend");
  const plan = await createPlan("SUSPEND_T", { pricePaise: 1000, durationMonths: 1 });
  t.after(() => cleanupPlan(plan.id));
  t.after(() => cleanupGym(gym.id));

  await assignPlan(SUPER_ADMIN, gym.id, {
    planId: plan.id,
    reason: "Activate before suspension test",
  });

  const suspended = await setAccessStatus(SUPER_ADMIN, gym.id, {
    status: "SUSPENDED",
    reason: "Chargeback investigation",
  });
  assert.strictEqual(suspended.data.subscription.status, "SUSPENDED");

  const suspendedRow = await prisma.gymSubscription.findUnique({ where: { gymId: gym.id } });
  const denied = computeEntitlement(suspendedRow);
  assert.strictEqual(denied.entitled, false);
  assert.strictEqual(denied.reason, "SUSPENDED");

  const audit = await prisma.subscriptionAuditLog.findFirst({
    where: { gymId: gym.id, action: "GYM_SUSPENDED" },
  });
  assert.ok(audit);
  assert.strictEqual(audit.actorRole, "SUPER_ADMIN");

  // The paid period is still in the future, so lifting the suspension resumes
  // access without inventing a new expiry date.
  const resumed = await setAccessStatus(SUPER_ADMIN, gym.id, {
    status: "ACTIVE",
    reason: "Investigation cleared",
  });
  assert.strictEqual(resumed.data.subscription.status, "ACTIVE");
  assert.strictEqual(resumed.data.subscription.entitled, true);

  // An expired subscription, however, cannot be switched on without a new
  // explicit expiry (or a plan assignment).
  await prisma.gymSubscription.update({
    where: { gymId: gym.id },
    data: {
      status: "EXPIRED",
      currentPeriodEnd: new Date(Date.now() - 24 * 60 * 60 * 1000),
    },
  });
  await assert.rejects(
    () =>
      setAccessStatus(SUPER_ADMIN, gym.id, {
        status: "ACTIVE",
        reason: "No expiry",
      }),
    (err) => err.statusCode === 400 && err.code === "EXPIRY_REQUIRED",
  );

  const reactivated = await setAccessStatus(SUPER_ADMIN, gym.id, {
    status: "ACTIVE",
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    reason: "Investigation cleared and term restarted",
  });
  assert.strictEqual(reactivated.data.subscription.status, "ACTIVE");
  assert.strictEqual(reactivated.data.subscription.entitled, true);
});
