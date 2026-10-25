// Platform-level (super-admin) dashboard service.
//
// This is the ONLY service that is allowed to query across gyms. Every exported
// function first checks `actor.role === "SUPER_ADMIN"` from the database-backed
// session, then performs the cross-gym query. Gym-scoped services must never
// call these helpers.
//
// Billing data is read from the existing GymSubscription, SubscriptionPayment,
// TrialRecord and SubscriptionAuditLog models. No revenue or subscription row
// is fabricated: revenue is the sum of successful SubscriptionPayment rows.

import { prisma } from "../db.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../utils/http-error.js";
import {
  addDays,
  addMonthsClamped,
  daysRemaining,
  isFuture,
} from "../utils/dates.js";
import { computeEntitlement } from "./subscription.service.js";

const ACTIVE = "ACTIVE";
const TRIALING = "TRIALING";
const EXPIRED = "EXPIRED";
const CANCELLED = "CANCELLED";
const PAST_DUE = "PAST_DUE";
const SUSPENDED = "SUSPENDED";
const NO_SUBSCRIPTION = "NO_SUBSCRIPTION";

const PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  pricePaise: true,
  currency: true,
  durationMonths: true,
  isActive: true,
  displayOrder: true,
  features: true,
  maxStaff: true,
  maxBranches: true,
};

const OWNER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  emailVerified: true,
  createdAt: true,
};

/** Throws 403 unless the actor is a platform SUPER_ADMIN. */
function requirePlatformAdmin(actor) {
  if (!actor || actor.role !== "SUPER_ADMIN") {
    throw forbidden("SaaS super-admin access required", "SUPER_ADMIN_REQUIRED");
  }
}

/** A reason is mandatory for every mutation so the audit log is useful. */
function requireReason(reason) {
  if (typeof reason !== "string" || reason.trim().length < 3) {
    throw badRequest("A reason is required for this administrative action", "REASON_REQUIRED");
  }
  return reason.trim();
}

function parseFutureDate(value, code = "INVALID_EXPIRY") {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw badRequest("expiresAt must be a valid future date", code);
  }
  return date;
}

/** Find a gym or throw a non-enumerating 404. */
async function findGym(gymId, client = prisma) {
  const gym = await client.gym.findUnique({
    where: { id: gymId },
    select: { id: true, name: true },
  });
  if (!gym) throw notFound("Gym not found", "GYM_NOT_FOUND");
  return gym;
}

async function writeAudit(tx, { action, gymId, planId, subscriptionId, actor, reason, details }) {
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

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

/**
 * Status derived from both the stored status and the actual dates. This keeps
 * the dashboard honest even if the background expiry job has not run yet.
 */
export function effectiveSubscriptionStatus(subscription, now = new Date()) {
  if (!subscription) return NO_SUBSCRIPTION;

  switch (subscription.status) {
    case SUSPENDED:
      return SUSPENDED;
    case TRIALING:
      return isFuture(subscription.trialEndsAt, now) ? TRIALING : EXPIRED;
    case ACTIVE:
      return isFuture(subscription.currentPeriodEnd, now) ? ACTIVE : EXPIRED;
    case CANCELLED:
      // A scheduled cancellation keeps access until the paid period ends.
      if (subscription.cancelAtPeriodEnd && isFuture(subscription.currentPeriodEnd, now)) {
        return CANCELLED;
      }
      return isFuture(subscription.currentPeriodEnd, now) ? CANCELLED : EXPIRED;
    case EXPIRED:
      return EXPIRED;
    case PAST_DUE:
      return PAST_DUE;
    default:
      return subscription.status;
  }
}

/** The date that matters for "expires on" in the admin UI. */
export function subscriptionExpiry(subscription) {
  if (!subscription) return null;
  if (subscription.status === TRIALING) {
    return subscription.trialEndsAt ?? null;
  }
  return subscription.currentPeriodEnd ?? subscription.trialEndsAt ?? null;
}

function serializePlan(plan) {
  if (!plan) return null;
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
  };
}

function serializeSubscription(subscription, now = new Date()) {
  if (!subscription) return null;
  const expiry = subscriptionExpiry(subscription);
  const entitlement = computeEntitlement(subscription, now);
  return {
    id: subscription.id,
    status: subscription.status,
    effectiveStatus: effectiveSubscriptionStatus(subscription, now),
    entitled: entitlement.entitled,
    entitlementReason: entitlement.reason,
    plan: serializePlan(subscription.plan),
    planId: subscription.planId,
    planNameSnapshot: subscription.planNameSnapshot,
    pricePaise: subscription.pricePaise,
    currency: subscription.currency,
    trialStartsAt: subscription.trialStartsAt,
    trialEndsAt: subscription.trialEndsAt,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    expiresAt: expiry,
    remainingDays: daysRemaining(expiry, now),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    cancelledAt: subscription.cancelledAt,
    paymentProvider: subscription.paymentProvider,
    createdAt: subscription.createdAt,
    updatedAt: subscription.updatedAt,
  };
}

function serializeOwner(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

function serializeGymRow(gym, now = new Date()) {
  const owners = gym.users ?? [];
  return {
    id: gym.id,
    name: gym.name,
    email: gym.email,
    phone: gym.phone,
    address: gym.address,
    registeredAt: gym.createdAt,
    createdAt: gym.createdAt,
    owner: serializeOwner(owners[0]),
    owners: owners.map(serializeOwner),
    effectiveStatus: effectiveSubscriptionStatus(gym.subscription, now),
    subscription: serializeSubscription(gym.subscription, now),
    expiryDate: subscriptionExpiry(gym.subscription),
    memberCount: gym._count?.members ?? 0,
    staffCount: gym._count?.users ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Dashboard statistics
// ---------------------------------------------------------------------------

export async function getDashboardStats(actor, now = new Date()) {
  requirePlatformAdmin(actor);

  const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const inSevenDays = addDays(now, 7);

  const expiredWhere = {
    OR: [
      { status: EXPIRED },
      { status: ACTIVE, currentPeriodEnd: { lte: now } },
      { status: ACTIVE, currentPeriodEnd: null },
      { status: TRIALING, trialEndsAt: { lte: now } },
      { status: TRIALING, trialEndsAt: null },
      { status: CANCELLED, cancelAtPeriodEnd: true, currentPeriodEnd: { lte: now } },
    ],
  };

  const [
    totalGyms,
    activeSubscriptions,
    trialGyms,
    expiredSubscriptions,
    suspendedGyms,
    pastDueGyms,
    noSubscriptionGyms,
    revenue,
    monthlyRevenue,
    expiringSoonRows,
    recentGymRows,
    recentActivity,
    planGroups,
  ] = await Promise.all([
    prisma.gym.count(),
    prisma.gymSubscription.count({
      where: { status: ACTIVE, currentPeriodEnd: { gt: now } },
    }),
    prisma.gymSubscription.count({
      where: { status: TRIALING, trialEndsAt: { gt: now } },
    }),
    prisma.gymSubscription.count({ where: expiredWhere }),
    prisma.gymSubscription.count({ where: { status: SUSPENDED } }),
    prisma.gymSubscription.count({ where: { status: PAST_DUE } }),
    prisma.gym.count({ where: { subscription: null } }),
    prisma.subscriptionPayment.aggregate({
      where: { status: "SUCCESS" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.subscriptionPayment.aggregate({
      where: { status: "SUCCESS", createdAt: { gte: startOfMonth } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.gymSubscription.findMany({
      where: {
        OR: [
          { status: ACTIVE, currentPeriodEnd: { gte: now, lte: inSevenDays } },
          { status: TRIALING, trialEndsAt: { gte: now, lte: inSevenDays } },
        ],
      },
      include: {
        gym: { select: { id: true, name: true } },
        plan: { select: PLAN_SELECT },
      },
      orderBy: { updatedAt: "desc" },
      take: 8,
    }),
    prisma.gym.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        subscription: { include: { plan: { select: PLAN_SELECT } } },
        users: {
          where: { role: "ADMIN" },
          select: OWNER_SELECT,
          orderBy: { createdAt: "asc" },
          take: 1,
        },
        _count: { select: { members: true, users: true } },
      },
    }),
    prisma.subscriptionAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.gymSubscription.groupBy({
      by: ["planId"],
      where: { status: { in: [ACTIVE, TRIALING, SUSPENDED, CANCELLED, PAST_DUE] } },
      _count: { _all: true },
    }),
  ]);

  // Plan names for the distribution bars. One extra small query is cheaper
  // and clearer than a raw group-by join.
  const planIds = planGroups.map((group) => group.planId).filter(Boolean);
  const plans = planIds.length
    ? await prisma.subscriptionPlan.findMany({
        where: { id: { in: planIds } },
        select: { id: true, name: true },
      })
    : [];
  const planNameById = new Map(plans.map((plan) => [plan.id, plan.name]));

  return {
    data: {
      totalGyms,
      activeSubscriptions,
      trialGyms,
      expiredSubscriptions,
      suspendedGyms,
      pastDueGyms,
      noSubscriptionGyms,
      subscriptionRevenuePaise: Math.round(revenue._sum.amount ?? 0),
      monthlyRevenuePaise: Math.round(monthlyRevenue._sum.amount ?? 0),
      successfulPayments: revenue._count._all,
      monthlySuccessfulPayments: monthlyRevenue._count._all,
      planDistribution: planGroups
        .map((group) => ({
          planId: group.planId,
          planName: group.planId
            ? planNameById.get(group.planId) ?? "Unknown plan"
            : "No plan / trial",
          count: group._count._all,
        }))
        .sort((a, b) => b.count - a.count),
      expiringSoon: expiringSoonRows.map((sub) => ({
        gymId: sub.gymId,
        gymName: sub.gym.name,
        status: sub.status,
        effectiveStatus: effectiveSubscriptionStatus(sub, now),
        planName: sub.plan?.name ?? sub.planNameSnapshot ?? "Free trial",
        expiresAt: subscriptionExpiry(sub),
        remainingDays: daysRemaining(subscriptionExpiry(sub), now),
      })),
      recentGyms: recentGymRows.map((gym) => serializeGymRow(gym, now)),
      recentActivity: recentActivity.map(serializeAuditLog),
      generatedAt: now,
    },
  };
}

// ---------------------------------------------------------------------------
// Gym list / detail
// ---------------------------------------------------------------------------

function subscriptionStatusWhere(status, now) {
  switch (status) {
    case ACTIVE:
      return {
        subscription: {
          is: { status: ACTIVE, currentPeriodEnd: { gt: now } },
        },
      };
    case TRIALING:
      return {
        subscription: {
          is: { status: TRIALING, trialEndsAt: { gt: now } },
        },
      };
    case EXPIRED:
      return {
        subscription: {
          is: {
            OR: [
              { status: EXPIRED },
              { status: ACTIVE, currentPeriodEnd: { lte: now } },
              { status: ACTIVE, currentPeriodEnd: null },
              { status: TRIALING, trialEndsAt: { lte: now } },
              { status: TRIALING, trialEndsAt: null },
              {
                status: CANCELLED,
                cancelAtPeriodEnd: true,
                currentPeriodEnd: { lte: now },
              },
            ],
          },
        },
      };
    case SUSPENDED:
      return { subscription: { is: { status: SUSPENDED } } };
    case PAST_DUE:
      return { subscription: { is: { status: PAST_DUE } } };
    case CANCELLED:
      return {
        subscription: {
          is: {
            status: CANCELLED,
            OR: [
              { cancelAtPeriodEnd: false },
              { currentPeriodEnd: { gt: now } },
              { currentPeriodEnd: null },
            ],
          },
        },
      };
    case NO_SUBSCRIPTION:
      return { subscription: null };
    default:
      return {};
  }
}

export async function listGyms(
  actor,
  { q, status, planId, page = 1, limit = 20, sort = "newest" } = {},
  now = new Date(),
) {
  requirePlatformAdmin(actor);

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const and = [];

  if (status) and.push(subscriptionStatusWhere(status, now));
  if (planId) and.push({ subscription: { is: { planId } } });

  if (q && q.trim().length >= 2) {
    const search = q.trim();
    and.push({
      OR: [
        { id: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        {
          users: {
            some: {
              role: "ADMIN",
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
                { phone: { contains: search, mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
  }

  const where = and.length ? { AND: and } : {};
  const orderBy =
    sort === "oldest"
      ? { createdAt: "asc" }
      : sort === "name"
        ? { name: "asc" }
        : { createdAt: "desc" };

  const [gyms, total] = await Promise.all([
    prisma.gym.findMany({
      where,
      skip,
      take: safeLimit,
      orderBy,
      include: {
        subscription: { include: { plan: { select: PLAN_SELECT } } },
        users: {
          where: { role: "ADMIN" },
          select: OWNER_SELECT,
          orderBy: { createdAt: "asc" },
          take: 1,
        },
        _count: { select: { members: true, users: true } },
      },
    }),
    prisma.gym.count({ where }),
  ]);

  return {
    data: {
      gyms: gyms.map((gym) => serializeGymRow(gym, now)),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
      filters: { q: q ?? null, status: status ?? null, planId: planId ?? null, sort },
    },
  };
}

export async function getGymDetail(actor, gymId, now = new Date()) {
  requirePlatformAdmin(actor);

  const gym = await prisma.gym.findUnique({
    where: { id: gymId },
    include: {
      subscription: { include: { plan: { select: PLAN_SELECT } } },
      users: {
        select: OWNER_SELECT,
        orderBy: { createdAt: "asc" },
      },
      _count: {
        select: { members: true, users: true, attendances: true, plans: true },
      },
    },
  });
  if (!gym) throw notFound("Gym not found", "GYM_NOT_FOUND");

  const [payments, trials, auditLogs, activeMemberships] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where: { gymId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.trialRecord.findMany({
      where: { gymId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.subscriptionAuditLog.findMany({
      where: { gymId },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.membership.count({ where: { gymId, status: ACTIVE } }),
  ]);

  const owners = gym.users.filter((user) => user.role === "ADMIN");
  const staff = gym.users.filter((user) => user.role === "RECEPTIONIST");

  return {
    data: {
      gym: {
        id: gym.id,
        name: gym.name,
        email: gym.email,
        phone: gym.phone,
        address: gym.address,
        registeredAt: gym.createdAt,
        createdAt: gym.createdAt,
      },
      owner: serializeOwner(owners[0]),
      owners: owners.map(serializeOwner),
      staff: staff.map(serializeOwner),
      effectiveStatus: effectiveSubscriptionStatus(gym.subscription, now),
      subscription: serializeSubscription(gym.subscription, now),
      expiryDate: subscriptionExpiry(gym.subscription),
      payments: payments.map((payment) => ({
        id: payment.id,
        planId: payment.planId,
        subscriptionId: payment.subscriptionId,
        amountPaise: Math.round(payment.amount),
        currency: payment.currency,
        status: payment.status,
        provider: payment.provider,
        orderId: payment.orderId,
        paymentId: payment.paymentId,
        failureReason: payment.failureReason,
        verifiedAt: payment.verifiedAt,
        createdAt: payment.createdAt,
      })),
      trialHistory: trials.map((trial) => ({
        id: trial.id,
        type: trial.type,
        startsAt: trial.startsAt,
        endsAt: trial.endsAt,
        reason: trial.reason,
        grantedById: trial.grantedById,
        grantedByRole: trial.grantedByRole,
        source: trial.source,
        createdAt: trial.createdAt,
      })),
      subscriptionHistory: auditLogs.map(serializeAuditLog),
      auditLogs: auditLogs.map(serializeAuditLog),
      stats: {
        members: gym._count.members,
        owners: owners.length,
        staff: staff.length,
        totalUsers: gym._count.users,
        attendanceRecords: gym._count.attendances,
        membershipPlans: gym._count.plans,
        activeMemberships,
      },
    },
  };
}

function serializeAuditLog(log) {
  return {
    id: log.id,
    action: log.action,
    gymId: log.gymId,
    planId: log.planId,
    subscriptionId: log.subscriptionId,
    actorUserId: log.actorUserId,
    actorEmail: log.actorEmail,
    actorRole: log.actorRole,
    reason: log.reason,
    details: log.details,
    createdAt: log.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Administrative mutations
// ---------------------------------------------------------------------------

/**
 * Assign a plan or change the gym's current plan. Starts a fresh paid period
 * from now unless an explicit `expiresAt` is supplied. Never writes a payment
 * row: this is a platform action, not a customer payment.
 */
export async function assignPlan(actor, gymId, { planId, expiresAt, reason }, now = new Date()) {
  requirePlatformAdmin(actor);
  const auditReason = requireReason(reason);
  await findGym(gymId);

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw notFound("Plan not found", "PLAN_NOT_FOUND");

  const explicitExpiry = parseFutureDate(expiresAt);
  const periodEnd = explicitExpiry ?? addMonthsClamped(now, plan.durationMonths);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.gymSubscription.findUnique({ where: { gymId } });
    const data = {
      planId: plan.id,
      planNameSnapshot: plan.name,
      pricePaise: plan.pricePaise,
      currency: plan.currency,
      status: ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      paymentProvider: null,
      updatedAt: now,
    };

    const subscription = existing
      ? await tx.gymSubscription.update({ where: { gymId }, data })
      : await tx.gymSubscription.create({
          data: {
            gymId,
            ...data,
            trialStartsAt: null,
            trialEndsAt: null,
          },
        });

    const action =
      existing && existing.planId && existing.planId !== plan.id
        ? "SUBSCRIPTION_PLAN_CHANGED"
        : "SUBSCRIPTION_PLAN_ASSIGNED";

    await writeAudit(tx, {
      action,
      gymId,
      planId: plan.id,
      subscriptionId: subscription.id,
      actor,
      reason: auditReason,
      details: {
        previousPlanId: existing?.planId ?? null,
        previousStatus: existing?.status ?? null,
        previousPeriodEnd: existing?.currentPeriodEnd ?? null,
        planCode: plan.code,
        planName: plan.name,
        pricePaise: plan.pricePaise,
        currentPeriodEnd: periodEnd,
      },
    });

    return { subscription, action };
  });

  return {
    data: {
      subscription: serializeSubscription(
        { ...result.subscription, plan },
        now,
      ),
    },
    message:
      result.action === "SUBSCRIPTION_PLAN_CHANGED"
        ? "Subscription plan changed"
        : "Subscription plan assigned",
  };
}

/**
 * Extend a paid period or a trial by a number of days, or set an explicit
 * future expiry. Reactivates an expired paid subscription unless it is
 * currently suspended (suspension wins until an explicit activation).
 */
export async function extendExpiry(
  actor,
  gymId,
  { additionalDays, expiresAt, reason },
  now = new Date(),
) {
  requirePlatformAdmin(actor);
  const auditReason = requireReason(reason);
  if (additionalDays === undefined && !expiresAt) {
    throw badRequest(
      "Provide additionalDays or expiresAt to extend the subscription",
      "EXTENSION_REQUIRED",
    );
  }
  await findGym(gymId);

  const sub = await prisma.gymSubscription.findUnique({ where: { gymId } });
  if (!sub) throw notFound("No subscription found for this gym", "SUBSCRIPTION_NOT_FOUND");

  const explicitExpiry = parseFutureDate(expiresAt);
  const isTrial = sub.status === TRIALING;
  const base = isTrial
    ? sub.trialEndsAt ?? now
    : sub.currentPeriodEnd ?? sub.trialEndsAt ?? now;
  const newEnd = explicitExpiry ?? addDays(base, Number(additionalDays));
  if (newEnd.getTime() <= now.getTime()) {
    throw badRequest("The new expiry must be in the future", "INVALID_EXPIRY");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const data = isTrial
      ? { trialEndsAt: newEnd, updatedAt: now }
      : {
          currentPeriodEnd: newEnd,
          status: sub.status === SUSPENDED ? SUSPENDED : ACTIVE,
          cancelAtPeriodEnd: sub.status === SUSPENDED ? sub.cancelAtPeriodEnd : false,
          cancelledAt: sub.status === SUSPENDED ? sub.cancelledAt : null,
          updatedAt: now,
        };

    const subscription = await tx.gymSubscription.update({ where: { gymId }, data });

    await writeAudit(tx, {
      action: isTrial ? "TRIAL_EXTENDED" : "SUBSCRIPTION_EXTENDED",
      gymId,
      planId: sub.planId,
      subscriptionId: subscription.id,
      actor,
      reason: auditReason,
      details: {
        previousExpiry: base,
        newExpiry: newEnd,
        additionalDays: additionalDays ?? null,
        explicitExpiresAt: explicitExpiry ?? null,
        status: subscription.status,
      },
    });

    return subscription;
  });

  return {
    data: {
      subscriptionId: updated.id,
      status: updated.status,
      expiresAt: subscriptionExpiry({ ...updated }),
      previousExpiry: base,
      extendedByDays: additionalDays ?? null,
    },
    message: isTrial ? "Trial expiry updated" : "Subscription expiry updated",
  };
}

/**
 * Start or extend an admin-granted trial. Active paid subscriptions are
 * protected: the admin must suspend/cancel or let them expire first.
 */
export async function startOrExtendTrial(
  actor,
  gymId,
  { days = 14, startsAt, reason },
  now = new Date(),
) {
  requirePlatformAdmin(actor);
  const auditReason = requireReason(reason);
  const durationDays = Number(days);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365) {
    throw badRequest("days must be an integer between 1 and 365", "INVALID_TRIAL_DAYS");
  }
  await findGym(gymId);

  const start = startsAt ? new Date(startsAt) : now;
  if (Number.isNaN(start.getTime())) {
    throw badRequest("startsAt must be a valid date", "INVALID_START_DATE");
  }

  const existing = await prisma.gymSubscription.findUnique({ where: { gymId } });
  if (
    existing &&
    existing.status === ACTIVE &&
    isFuture(existing.currentPeriodEnd, now)
  ) {
    throw conflict(
      "This gym already has an active paid subscription. Suspend it or wait for it to expire before starting a trial.",
      "ACTIVE_SUBSCRIPTION_EXISTS",
    );
  }

  const extending =
    existing?.status === TRIALING && isFuture(existing.trialEndsAt, now);
  const endBase = extending ? existing.trialEndsAt : start;
  const trialEnd = addDays(endBase, durationDays);

  const result = await prisma.$transaction(async (tx) => {
    const data = {
      status: TRIALING,
      planId: null,
      planNameSnapshot: "Free trial",
      pricePaise: 0,
      currency: existing?.currency ?? "INR",
      trialStartsAt: existing?.trialStartsAt ?? start,
      trialEndsAt: trialEnd,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelledAt: null,
      paymentProvider: null,
      updatedAt: now,
    };
    const subscription = existing
      ? await tx.gymSubscription.update({ where: { gymId }, data })
      : await tx.gymSubscription.create({ data: { gymId, ...data } });

    await tx.trialRecord.create({
      data: {
        gymId,
        type: extending ? "EXTENSION" : "INITIAL",
        startsAt: start,
        endsAt: trialEnd,
        reason: auditReason,
        grantedById: actor.id,
        grantedByRole: actor.role,
        source: "ADMIN_TRIAL",
      },
    });

    await writeAudit(tx, {
      action: extending ? "TRIAL_EXTENDED" : "TRIAL_STARTED",
      gymId,
      subscriptionId: subscription.id,
      actor,
      reason: auditReason,
      details: {
        days: durationDays,
        trialStartsAt: data.trialStartsAt,
        trialEndsAt: trialEnd,
        previousStatus: existing?.status ?? null,
      },
    });

    return subscription;
  });

  return {
    data: {
      subscriptionId: result.id,
      status: result.status,
      trialStartsAt: result.trialStartsAt,
      trialEndsAt: result.trialEndsAt,
      extended: extending,
    },
    message: extending ? "Trial extended" : "Trial started",
  };
}

/** End a trial immediately. */
export async function endTrial(actor, gymId, { reason }, now = new Date()) {
  requirePlatformAdmin(actor);
  const auditReason = requireReason(reason);
  await findGym(gymId);

  const sub = await prisma.gymSubscription.findUnique({ where: { gymId } });
  if (!sub) throw notFound("No subscription found for this gym", "SUBSCRIPTION_NOT_FOUND");
  if (sub.status !== TRIALING) {
    throw badRequest("This gym is not currently trialing", "NOT_TRIALING");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const subscription = await tx.gymSubscription.update({
      where: { gymId },
      data: {
        status: EXPIRED,
        trialEndsAt: now,
        updatedAt: now,
      },
    });
    await writeAudit(tx, {
      action: "TRIAL_ENDED",
      gymId,
      planId: sub.planId,
      subscriptionId: sub.id,
      actor,
      reason: auditReason,
      details: { previousTrialEndsAt: sub.trialEndsAt, endedAt: now },
    });
    return subscription;
  });

  return {
    data: {
      subscriptionId: updated.id,
      status: updated.status,
      trialEndsAt: updated.trialEndsAt,
    },
    message: "Trial ended",
  };
}

/** Suspend or reactivate gym access. Only ACTIVE and SUSPENDED are accepted. */
export async function setAccessStatus(
  actor,
  gymId,
  { status, expiresAt, reason },
  now = new Date(),
) {
  requirePlatformAdmin(actor);
  const auditReason = requireReason(reason);
  if (![ACTIVE, SUSPENDED].includes(status)) {
    throw badRequest("status must be ACTIVE or SUSPENDED", "INVALID_ACCESS_STATUS");
  }
  await findGym(gymId);

  const sub = await prisma.gymSubscription.findUnique({
    where: { gymId },
    include: { plan: { select: PLAN_SELECT } },
  });
  if (!sub) throw notFound("No subscription found for this gym", "SUBSCRIPTION_NOT_FOUND");

  if (status === SUSPENDED) {
    if (sub.status === SUSPENDED) {
      return {
        data: { subscription: serializeSubscription(sub, now) },
        message: "Gym is already suspended",
      };
    }
    const updated = await prisma.$transaction(async (tx) => {
      const subscription = await tx.gymSubscription.update({
        where: { gymId },
        data: { status: SUSPENDED, updatedAt: now },
      });
      await writeAudit(tx, {
        action: "GYM_SUSPENDED",
        gymId,
        planId: sub.planId,
        subscriptionId: sub.id,
        actor,
        reason: auditReason,
        details: {
          previousStatus: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd,
          trialEndsAt: sub.trialEndsAt,
        },
      });
      return subscription;
    });
    return {
      data: { subscription: serializeSubscription({ ...updated, plan: sub.plan }, now) },
      message: "Gym access suspended",
    };
  }

  // ACTIVE
  if (sub.status === TRIALING && isFuture(sub.trialEndsAt, now)) {
    throw badRequest(
      "The gym is trialing. Assign a paid plan or use trial management instead.",
      "TRIAL_IN_PROGRESS",
    );
  }

  const explicitExpiry = parseFutureDate(expiresAt);
  const hasFuturePeriod = isFuture(sub.currentPeriodEnd, now);
  if (!explicitExpiry && !hasFuturePeriod) {
    throw badRequest(
      "Provide expiresAt to activate a gym whose paid period has ended",
      "EXPIRY_REQUIRED",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const subscription = await tx.gymSubscription.update({
      where: { gymId },
      data: {
        status: ACTIVE,
        ...(explicitExpiry
          ? { currentPeriodStart: now, currentPeriodEnd: explicitExpiry }
          : {}),
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        updatedAt: now,
      },
    });
    await writeAudit(tx, {
      action: "GYM_ACTIVATED",
      gymId,
      planId: sub.planId,
      subscriptionId: sub.id,
      actor,
      reason: auditReason,
      details: {
        previousStatus: sub.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        explicitExpiresAt: explicitExpiry ?? null,
      },
    });
    return subscription;
  });

  return {
    data: { subscription: serializeSubscription({ ...updated, plan: sub.plan }, now) },
    message: "Gym access activated",
  };
}

// ---------------------------------------------------------------------------
// Read-only helpers for the admin UI
// ---------------------------------------------------------------------------

export async function listAllPlans(actor) {
  requirePlatformAdmin(actor);
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
  });
  return { data: plans.map(serializePlan) };
}

export async function listActivity(actor, { limit = 20 } = {}) {
  requirePlatformAdmin(actor);
  const take = Math.min(100, Math.max(1, Number(limit) || 20));
  const logs = await prisma.subscriptionAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
  });
  return { data: logs.map(serializeAuditLog) };
}
