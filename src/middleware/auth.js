import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { prisma } from "../db.js";

export async function authenticate(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, gymId: true, role: true, email: true, emailVerified: true },
    });

    // A session alone is not enough: accounts must confirm their email before
    // they can reach any gym data or onboarding endpoint. Google accounts are
    // created with emailVerified=true by Better Auth.
    const emailVerified = user?.emailVerified ?? session.user.emailVerified;
    if (!emailVerified) {
      return res.status(403).json({
        error: "Email not verified. Verify your email to continue.",
        code: "EMAIL_NOT_VERIFIED",
        email: session.user.email,
      });
    }

    req.user = {
      id: session.user.id,
      gymId: user?.gymId || session.user.gymId || null,
      role: user?.role || session.user.role || "ADMIN",
      email: session.user.email
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

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission" });
    }
    next();
  };
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

// RECEPTIONIST rule: can only read (GET) and create (POST).
// Any PUT / PATCH / DELETE from a RECEPTIONIST is rejected here,
// so individual controllers don't need role checks.
export function allowReadAndCreateOnly(req, res, next) {
  if (req.user?.role === "RECEPTIONIST" && req.method !== "GET" && req.method !== "POST") {
    return res.status(403).json({
      error: "Receptionists can only view (GET) and add (POST) data",
    });
  }
  next();
}
