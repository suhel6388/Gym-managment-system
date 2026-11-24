// Role guard used by the /platform administration surface.
//
// The role is always read from the database-backed session by `authenticate`
// before this middleware runs, so a client cannot claim a role in a header or
// request body.

export function requireRole(...allowedRoles) {
  const roles = allowedRoles.flat().filter(Boolean);

  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "You do not have permission to perform this action",
        code:
          roles.length === 1 && roles[0] === "SUPER_ADMIN"
            ? "SUPER_ADMIN_REQUIRED"
            : "ROLE_REQUIRED",
        details: { requiredRoles: roles },
      });
    }
    next();
  };
}

/** Platform owner guard (SUPER_ADMIN). */
export const requirePlatformAdmin = requireRole("SUPER_ADMIN");

export default requireRole;
