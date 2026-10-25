// Platform-administrator account management (max two accounts).
//
// The first platform owner is created by the one-time bootstrap endpoint
// (POST /api/v1/auth/bootstrap-super-admin) or the CLI script. This service
// creates the SECOND (and final) one, and can only be reached by an existing
// SUPER_ADMIN session — see src/routes/super-admin.route.js, which applies
// authenticate + requireSuperAdmin before this code runs.
//
// Accounts are written to the existing User + Account tables, already verified,
// with the same credential shape Better Auth uses for email/password sign-in.
// No OTP or SMTP involvement.

import { hashPassword } from "better-auth/crypto";
import { prisma } from "../db.js";
import { conflict, forbidden } from "../utils/http-error.js";

/** Hard cap requested for platform administrators. */
export const MAX_PLATFORM_ADMINS = 2;

// Same advisory-lock key as src/controllers/super-admin.bootstrap.controller.js,
// so the bootstrap endpoint and this service cannot race past the cap.
const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  emailVerified: true,
  gymId: true,
};

/**
 * Create or promote a platform administrator.
 * @param {{ id: string, role: string }} actor Database-backed caller (req.user).
 * @param {{ name: string, email: string, password: string }} input
 */
export async function createPlatformAdmin(actor, input) {
  // Defense in depth: the router already enforces this, but the service must
  // never mint a SUPER_ADMIN for a non-super-admin caller even if it is called
  // from somewhere else later.
  if (!actor || actor.role !== "SUPER_ADMIN") {
    throw forbidden("SaaS super-admin access required", "SUPER_ADMIN_REQUIRED");
  }

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    // Serialize create calls (and the one-time bootstrap) so the two-account
    // cap cannot be raced. Wrapped in a subselect because the function returns
    // void, which Prisma's pg adapter cannot deserialize.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(8127364512)) AS admin_cap_lock`;

    const current = await tx.user.count({ where: { role: "SUPER_ADMIN" } });
    if (current >= MAX_PLATFORM_ADMINS) {
      throw conflict(
        `The maximum of ${MAX_PLATFORM_ADMINS} platform administrators already exists`,
        "SUPER_ADMIN_LIMIT_REACHED",
        { max: MAX_PLATFORM_ADMINS, current },
      );
    }

    const existing = await tx.user.findUnique({
      where: { email: input.email },
      select: { id: true, role: true, gymId: true },
    });

    if (existing?.role === "SUPER_ADMIN") {
      throw conflict(
        "This account is already a platform administrator",
        "ALREADY_SUPER_ADMIN",
      );
    }
    if (existing?.gymId) {
      throw conflict(
        "This email already belongs to a gym. Platform administrators must use a separate account.",
        "ACCOUNT_BELONGS_TO_GYM",
      );
    }

    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            name: input.name,
            role: "SUPER_ADMIN",
            emailVerified: true,
            // A platform account must never be treated as a gym user.
            gymId: null,
          },
          select: USER_SELECT,
        })
      : await tx.user.create({
          data: {
            name: input.name,
            email: input.email,
            role: "SUPER_ADMIN",
            emailVerified: true,
            gymId: null,
          },
          select: USER_SELECT,
        });

    // Same credential row Better Auth writes for email/password sign-up, so
    // POST /api/v1/auth/super-admin/login works without an OTP step.
    await tx.account.upsert({
      where: {
        providerId_accountId: { providerId: "credential", accountId: user.id },
      },
      create: {
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      },
      update: { password: passwordHash },
    });

    return {
      user,
      promoted: Boolean(existing),
      remainingSlots: MAX_PLATFORM_ADMINS - (current + 1),
    };
  });
}

/** True when the given database row may use the platform (super-admin) login. */
export function isPlatformAdmin(user) {
  return Boolean(user && user.role === "SUPER_ADMIN");
}
