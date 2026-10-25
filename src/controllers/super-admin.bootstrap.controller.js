// POST /api/v1/auth/bootstrap-super-admin
//
// Additive endpoint: existing auth routes (`/signup`, `/login`, `/me`,
// `/setup-gym`, ...) are untouched. It creates — or promotes — the platform
// owner from just `{ name, email, password }`. The account is created already
// verified with a normal Better Auth credential row, so the caller then uses
// the SAME `POST /api/v1/auth/login`. Login already returns `role`, and the
// client already routes `SUPER_ADMIN` to `/super-admin` (see
// `client/src/lib/api.ts` → `resolvePostAuthPath`), so no login change is
// needed.
//
// Why the gate: an endpoint that mints SUPER_ADMIN accounts is a platform
// takeover vector (every gym, plan and billing record). Two layers protect it:
//
//   1. Self-disabling. Once any SUPER_ADMIN exists, the endpoint answers 409
//      and stops minting accounts. Use the CLI script
//      (`npm run bootstrap-super-admin`) for later platform owners.
//   2. Optional shared secret. If `SUPER_ADMIN_BOOTSTRAP_SECRET` is set, the
//      `x-bootstrap-secret` header must match it (timing-safe compare).
//      Unset means "first-run mode", which only works while no SUPER_ADMIN
//      exists.
//
// The role is never taken from the request body: this endpoint always creates
// SUPER_ADMIN, and `role` is stripped if sent.

import { z } from "zod";
import crypto from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "../db.js";

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  emailVerified: true,
  gymId: true,
};

export const bootstrapSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  // A platform owner can read every gym's billing data, so the floor is 12
  // characters (matching scripts/make-super-admin.mjs).
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must be at most 128 characters"),
});

function configuredSecret() {
  return (process.env.SUPER_ADMIN_BOOTSTRAP_SECRET || "").trim();
}

/**
 * True when the supplied header may use the endpoint.
 * No configured secret => first-run mode, allowed here and constrained by the
 * "no SUPER_ADMIN exists yet" check inside the transaction.
 */
export function isBootstrapSecretValid(provided) {
  const expected = configuredSecret();
  if (!expected) return true;
  if (typeof provided !== "string" || provided.length === 0) return false;
  const given = Buffer.from(provided, "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (given.length !== wanted.length) return false;
  return crypto.timingSafeEqual(given, wanted);
}

export function requireBootstrapAccess(req, res, next) {
  if (isBootstrapSecretValid(req.get("x-bootstrap-secret"))) return next();
  return res.status(401).json({
    error: "A valid x-bootstrap-secret header is required",
    code: "BOOTSTRAP_SECRET_REQUIRED",
  });
}

function httpError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

export async function bootstrapSuperAdmin(req, res, next) {
  try {
    const input = bootstrapSchema.parse(req.body ?? {});
    const passwordHash = await hashPassword(input.password);

    const result = await prisma.$transaction(async (tx) => {
      // Serialize concurrent bootstrap calls: without this, two requests could
      // both see "no SUPER_ADMIN" and create two platform owners.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(8127364512)`;

      const superAdminCount = await tx.user.count({
        where: { role: "SUPER_ADMIN" },
      });
      if (superAdminCount > 0) {
        throw httpError(
          409,
          "SUPER_ADMIN_ALREADY_EXISTS",
          "A platform administrator already exists. Sign in through POST /api/v1/auth/login, " +
            "or add another platform owner out-of-band with: npm run bootstrap-super-admin -- <email>",
        );
      }

      const existing = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true, gymId: true },
      });

      // Platform owners are not gym users; attaching a gym to one would let a
      // SUPER_ADMIN be treated as a gym owner by /setup-gym's counterpart.
      if (existing?.gymId) {
        throw httpError(
          409,
          "ACCOUNT_BELONGS_TO_GYM",
          "This email already belongs to a gym. Platform administrators must use a separate account.",
        );
      }

      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              name: input.name,
              role: "SUPER_ADMIN",
              emailVerified: true,
            },
            select: USER_SELECT,
          })
        : await tx.user.create({
            data: {
              name: input.name,
              email: input.email,
              role: "SUPER_ADMIN",
              // Already verified: a platform owner must not depend on SMTP,
              // which is blocked on Render's free web services.
              emailVerified: true,
              gymId: null,
            },
            select: USER_SELECT,
          });

      // Same credential shape Better Auth writes for email/password sign-up,
      // so the existing /auth/login endpoint works unchanged.
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

      return { user, promoted: Boolean(existing) };
    });

    // Audit trail without the password or the hash.
    console.log(
      `[auth] bootstrap-super-admin ${result.promoted ? "promoted" : "created"} ` +
        `${result.user.email} (${result.user.id}) from ${req.ip ?? "unknown"}`,
    );

    return res.status(201).json({
      message: result.promoted
        ? "Existing account promoted to SUPER_ADMIN. Sign in with the password you just supplied."
        : "Platform administrator created. Sign in with the password you supplied.",
      promoted: result.promoted,
      user: result.user,
      login: {
        method: "POST",
        path: "/api/v1/auth/login",
        body: { email: result.user.email, password: "<the password you supplied>" },
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      const first = err?.issues?.[0];
      return res.status(400).json({
        error: first?.message ?? "Validation failed",
        code: "VALIDATION_FAILED",
      });
    }
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    // A concurrent /auth/signup claimed the email first. No SUPER_ADMIN exists
    // yet, so calling this endpoint again promotes that account.
    if (err?.code === "P2002") {
      return res.status(409).json({
        error: "That email was just registered. Call this endpoint again to promote it.",
        code: "EMAIL_CREATED_CONCURRENTLY",
      });
    }
    next(err);
  }
}
