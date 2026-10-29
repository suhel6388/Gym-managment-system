// Platform-owner (SaaS super-admin) gym onboarding.
//
// Creates a gym AND its first owner account in one transaction. This is the
// only place besides the public signup/setup-gym flow where a gym owner is
// minted, so it deliberately reuses the same building blocks:
//
//   * `User` + `Account` rows shaped exactly like Better Auth's credential
//     provider, hashed with `better-auth/crypto`'s `hashPassword` (the same
//     helper used by super-admin-accounts.service.js). The owner can sign in
//     through POST /api/v1/auth/login immediately.
//   * `ROLE.OWNER` — the existing role map names the gym owner "OWNER" but
//     stores the ADMIN value. No new enum value is introduced, so every
//     existing permission check and gym-scoped query keeps working.
//   * `GymSubscription` + `TrialRecord` follow the same rules as
//     subscription.service.js: a free trial is created only when trials are
//     enabled and the gym has never consumed one, otherwise a paid plan can be
//     assigned in the same request.
//
// Every exported function re-checks the database-backed SUPER_ADMIN role, so
// the service is safe even if a future caller forgets the route middleware.

import { randomBytes } from "node:crypto";
import { hashPassword } from "better-auth/crypto";

import { prisma } from "../db.js";
import { ROLE } from "../middleware/permissions.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../utils/http-error.js";
import { addDays, addMonthsClamped } from "../utils/dates.js";
import { effectiveSubscriptionStatus, subscriptionExpiry } from "./super-admin.service.js";

const SINGLETON_SETTINGS_ID = "singleton";
const CURRENCY = "INR";

const OWNER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  emailVerified: true,
  gymId: true,
  createdAt: true,
};

const PLAN_SELECT = {
  id: true,
  code: true,
  name: true,
  pricePaise: true,
  currency: true,
  durationMonths: true,
  isActive: true,
};

/** Throws 403 unless the actor is a platform SUPER_ADMIN. */
function requirePlatformAdmin(actor) {
  if (!actor || actor.role !== "SUPER_ADMIN") {
    throw forbidden("SaaS super-admin access required", "SUPER_ADMIN_REQUIRED");
  }
}

function normalizeOptional(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** A random credential for the invitation flow. The owner never sees it. */
function generateInvitationPassword() {
  return `${randomBytes(24).toString("base64url")}Aa1!`;
}

async function readSubscriptionSettings(client = prisma) {
  return client.subscriptionSetting.findUnique({
    where: { id: SINGLETON_SETTINGS_ID },
  });
}

function serializeOwner(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    // Expose the canonical gym-owner label while keeping the stored user.role
    // (ADMIN) available for clients that already switch on it.
    role: user.role,
    roleLabel: "OWNER",
    gymId: user.gymId,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

function serializeSubscription(subscription, plan, now = new Date()) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    status: subscription.status,
    effectiveStatus: effectiveSubscriptionStatus(subscription, now),
    plan: plan
      ? {
          id: plan.id,
          code: plan.code,
          name: plan.name,
          pricePaise: plan.pricePaise,
          currency: plan.currency,
          durationMonths: plan.durationMonths,
        }
      : null,
    planId: subscription.planId ?? null,
    planNameSnapshot: subscription.planNameSnapshot ?? null,
    pricePaise: subscription.pricePaise,
    currency: subscription.currency,
    trialStartsAt: subscription.trialStartsAt ?? null,
    trialEndsAt: subscription.trialEndsAt ?? null,
    currentPeriodStart: subscription.currentPeriodStart ?? null,
    currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    expiresAt: subscriptionExpiry(subscription),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    createdAt: subscription.createdAt,
  };
}

function serializeGym(gym) {
  return {
    id: gym.id,
    name: gym.name,
    email: gym.email,
    phone: gym.phone,
    address: gym.address,
    createdAt: gym.createdAt,
    registeredAt: gym.createdAt,
  };
}

function serializeOwnerRow(user, now = new Date()) {
  const subscription = user.gym?.subscription ?? null;
  const expiresAt = subscriptionExpiry(subscription);
  return {
    ...serializeOwner(user),
    gym: user.gym
      ? {
          id: user.gym.id,
          name: user.gym.name,
          email: user.gym.email,
          phone: user.gym.phone,
          createdAt: user.gym.createdAt,
        }
      : null,
    subscription: subscription
      ? {
          id: subscription.id,
          status: subscription.status,
          effectiveStatus: effectiveSubscriptionStatus(subscription, now),
          planId: subscription.planId ?? null,
          planName:
            subscription.plan?.name ??
            subscription.planNameSnapshot ??
            (subscription.status === "TRIALING" ? "Free trial" : null),
          pricePaise: subscription.pricePaise,
          expiresAt,
          remainingDays: expiresAt
            ? Math.max(
                0,
                Math.ceil(
                  (expiresAt.getTime() - now.getTime()) /
                    (24 * 60 * 60 * 1000),
                ),
              )
            : 0,
        }
      : null,
  };
}

/**
 * Create a gym and its owner account.
 *
 * @param {{ id: string, role: string, email?: string }} actor Database-backed
 *   super-admin caller (req.user).
 * @param {{
 *   ownerName: string,
 *   ownerEmail: string,
 *   ownerPhone: string,
 *   gymName: string,
 *   gymEmail?: string,
 *   gymPhone?: string,
 *   gymAddress?: string,
 *   mode?: "PASSWORD" | "INVITE",
 *   password?: string,
 *   planId?: string,
 * }} input Parsed and validated by super-admin.owners.controller.js.
 */
export async function createGymOwner(actor, input) {
  requirePlatformAdmin(actor);

  const now = new Date();
  const mode = input.mode ?? "PASSWORD";
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const ownerPhone = input.ownerPhone.trim();
  const gymEmail = normalizeOptional(input.gymEmail) ?? ownerEmail;
  const gymPhone = normalizeOptional(input.gymPhone) ?? ownerPhone;
  const gymAddress = normalizeOptional(input.gymAddress);

  // --- Duplicate-account checks (email and phone are globally unique) ------
  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: ownerEmail }, { phone: ownerPhone }] },
    select: { id: true, email: true, phone: true },
  });
  if (existing) {
    if (existing.email === ownerEmail) {
      throw conflict(
        "An account with this email already exists",
        "EMAIL_ALREADY_REGISTERED",
      );
    }
    throw conflict(
      "An account with this mobile number already exists",
      "PHONE_ALREADY_REGISTERED",
    );
  }

  // --- Subscription decision (existing SaaS rules) ------------------------
  const plan = input.planId
    ? await prisma.subscriptionPlan.findUnique({
        where: { id: input.planId },
        select: PLAN_SELECT,
      })
    : null;
  if (input.planId && !plan) {
    throw notFound("Subscription plan not found", "PLAN_NOT_FOUND");
  }
  if (plan && !plan.isActive) {
    throw badRequest(
      "The selected subscription plan is inactive",
      "PLAN_INACTIVE",
    );
  }

  const settings = await readSubscriptionSettings();
  const trialEnabled = settings?.trialEnabled ?? true;
  if (!plan && !trialEnabled) {
    throw badRequest(
      "Free trials are disabled by the platform. Select a paid plan to create a gym with access.",
      "TRIALS_DISABLED_PLAN_REQUIRED",
    );
  }

  const trialDurationDays = settings?.trialDurationDays ?? 14;
  const trialPricePaise = settings?.trialPricePaise ?? 0;
  const trialStartsAt = plan ? null : now;
  const trialEndsAt = plan ? null : addDays(now, trialDurationDays);
  const periodEnd = plan ? addMonthsClamped(now, plan.durationMonths) : null;

  // The owner never learns this value; the invitation email lets them set a
  // password through the existing reset-password flow.
  const password = mode === "INVITE" ? generateInvitationPassword() : input.password;
  if (!password) {
    throw badRequest("A password is required", "PASSWORD_REQUIRED");
  }
  const passwordHash = await hashPassword(password);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const gym = await tx.gym.create({
        data: {
          name: input.gymName.trim(),
          email: gymEmail,
          phone: gymPhone,
          address: gymAddress,
        },
      });

      const owner = await tx.user.create({
        data: {
          name: input.ownerName.trim(),
          email: ownerEmail,
          phone: ownerPhone,
          role: ROLE.OWNER,
          emailVerified: true,
          gymId: gym.id,
        },
        select: OWNER_SELECT,
      });

      // Identical credential row Better Auth writes for email/password
      // sign-up, so the owner can log in without an invitation OTP.
      await tx.account.create({
        data: {
          accountId: owner.id,
          providerId: "credential",
          userId: owner.id,
          password: passwordHash,
        },
      });

      let subscription;
      if (plan) {
        subscription = await tx.gymSubscription.create({
          data: {
            gymId: gym.id,
            planId: plan.id,
            planNameSnapshot: plan.name,
            pricePaise: plan.pricePaise,
            currency: plan.currency,
            status: "ACTIVE",
            trialStartsAt: null,
            trialEndsAt: null,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            cancelAtPeriodEnd: false,
            paymentProvider: null,
          },
        });
      } else {
        subscription = await tx.gymSubscription.create({
          data: {
            gymId: gym.id,
            planId: null,
            planNameSnapshot: "Free trial",
            pricePaise: trialPricePaise,
            currency: CURRENCY,
            status: "TRIALING",
            trialStartsAt,
            trialEndsAt,
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            paymentProvider: null,
          },
        });

        // INITIAL proves this gym has consumed its one allowed free trial,
        // exactly like the self-service /subscription/trial flow.
        await tx.trialRecord.create({
          data: {
            gymId: gym.id,
            type: "INITIAL",
            startsAt: trialStartsAt,
            endsAt: trialEndsAt,
            reason:
              "Free trial started when a platform administrator created the gym",
            grantedById: actor.id,
            grantedByRole: actor.role,
            source: "ADMIN_CREATED",
          },
        });
      }

      await tx.subscriptionAuditLog.create({
        data: {
          action: "GYM_CREATED",
          gymId: gym.id,
          planId: plan?.id ?? null,
          subscriptionId: subscription.id,
          actorUserId: actor.id,
          actorEmail: actor.email ?? null,
          actorRole: actor.role,
          reason:
            normalizeOptional(input.reason) ??
            "Gym and owner created by platform administrator",
          details: {
            ownerId: owner.id,
            ownerEmail: owner.email,
            ownerPhone: owner.phone,
            ownerRole: "OWNER",
            storedRole: owner.role,
            gymName: gym.name,
            subscriptionMode: plan ? "PLAN" : "TRIAL",
            planCode: plan?.code ?? null,
            trialStartsAt,
            trialEndsAt,
            currentPeriodEnd: periodEnd,
            accountMode: mode,
          },
        },
      });

      return { gym, owner, subscription };
    });
  } catch (err) {
    // Lost a race against another create for the same email/phone.
    if (err?.code === "P2002") {
      const target = JSON.stringify(err?.meta?.target ?? "").toLowerCase();
      if (target.includes("phone")) {
        throw conflict(
          "An account with this mobile number already exists",
          "PHONE_ALREADY_REGISTERED",
        );
      }
      throw conflict(
        "An account with this email already exists",
        "EMAIL_ALREADY_REGISTERED",
      );
    }
    throw err;
  }

  return {
    data: {
      gym: serializeGym(created.gym),
      owner: serializeOwner(created.owner),
      subscription: serializeSubscription(created.subscription, plan, now),
      invitation: {
        mode,
        email: ownerEmail,
        // The controller emails the invite after this transaction commits.
        requiresEmail: mode === "INVITE",
      },
    },
    message: plan
      ? "Gym and owner created with a paid subscription"
      : `Gym and owner created with a ${trialDurationDays}-day free trial`,
  };
}

/**
 * Paginated, searchable directory of gym owner accounts.
 * Matches the gym directory endpoint's shape so the console can swap views.
 */
export async function listGymOwners(
  actor,
  { q, page = 1, limit = 20, sort = "newest" } = {},
  now = new Date(),
) {
  requirePlatformAdmin(actor);

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const where = { role: ROLE.OWNER };

  if (q && q.trim().length >= 2) {
    const search = q.trim();
    where.OR = [
      { id: { contains: search, mode: "insensitive" } },
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      {
        gym: {
          is: {
            OR: [
              { id: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const orderBy =
    sort === "oldest"
      ? { createdAt: "asc" }
      : sort === "name"
        ? { name: "asc" }
        : { createdAt: "desc" };

  const [owners, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: safeLimit,
      orderBy,
      select: {
        ...OWNER_SELECT,
        gym: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            createdAt: true,
            subscription: {
              select: {
                id: true,
                status: true,
                planId: true,
                planNameSnapshot: true,
                pricePaise: true,
                trialEndsAt: true,
                currentPeriodEnd: true,
                cancelAtPeriodEnd: true,
                plan: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data: {
      owners: owners.map((owner) => serializeOwnerRow(owner, now)),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
      filters: { q: q ?? null, sort },
    },
  };
}
