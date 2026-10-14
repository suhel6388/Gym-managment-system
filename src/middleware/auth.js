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
      select: { id: true, gymId: true, role: true, email: true },
    });
    req.user = {
      id: session.user.id,
      gymId: user?.gymId || session.user.gymId || null,
      role: user?.role || session.user.role || "OWNER",
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
