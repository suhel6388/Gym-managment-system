import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.ts";
import { prisma } from "../db.js";

export {
  allowRoles,
  requirePermission,
  allowReadAndCreateOnly,
  PERMISSION,
} from "./permissions.js";

/**
 * Resolve the Better Auth session and attach the database-backed user to the
 * request. The role and gymId always come from the database row, never from
 * client input, so a tampered request cannot claim another gym or role.
 */
export async function authenticate(req, res, next) {
  try {
    let session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    let sessionUserId = session?.user?.id;
    let sessionUserEmail = session?.user?.email;

    // Fallback: If cross-site cookie was blocked by the browser, check Bearer token
    if (!sessionUserId) {
      const authHeader = req.headers?.authorization;
      if (authHeader && typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        const token = authHeader.slice(7).trim();
        if (token) {
          const cleanToken = token.split(".")[0];
          const dbSession = await prisma.session.findFirst({
            where: {
              OR: [{ token }, { token: cleanToken }],
            },
            select: { userId: true, expiresAt: true },
          });
          if (dbSession && dbSession.expiresAt > new Date()) {
            sessionUserId = dbSession.userId;
          }
        }
      }
    }

    if (!sessionUserId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const user = await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true, gymId: true, role: true, email: true, emailVerified: true },
    });

    // A session without a matching user row is stale (for example the account
    // was deleted). Do not fall back to a default role — deny by default.
    if (!user) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // A session alone is not enough: accounts must confirm their email before
    // they can reach any gym data or onboarding endpoint. Google accounts are
    // created with emailVerified=true by Better Auth.
    if (!user.emailVerified) {
      return res.status(403).json({
        error: "Email not verified. Verify your email to continue.",
        code: "EMAIL_NOT_VERIFIED",
        email: sessionUserEmail ?? user.email,
      });
    }

    req.user = {
      id: user.id,
      gymId: user.gymId,
      role: user.role,
      email: user.email ?? sessionUserEmail,
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireGym(req, res, next) {
  if (!req.user?.gymId) {
    return res.status(403).json({
      error: "Gym setup required",
      message: "Create your gym using POST /api/v1/auth/setup-gym before accessing gym data."
    });
  }
  next();
}

// SaaS platform owner only. Gym OWNER/ADMIN/RECEPTIONIST users are rejected.
// The role is never assignable from client input (better-auth marks the
// `role` additional field input:false); promote a user out-of-band with
// `node scripts/make-super-admin.mjs <email>`.
export function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== "SUPER_ADMIN") {
    return res.status(403).json({
      error: "You do not have permission",
      code: "SUPER_ADMIN_REQUIRED",
    });
  }
  next();
}
