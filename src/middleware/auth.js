import { auth } from "../lib/auth.js";

export async function authenticate(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session?.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    req.user = {
      id: session.user.id,
      gymId: session.user.gymId || null,
      role: session.user.role || "OWNER",
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
