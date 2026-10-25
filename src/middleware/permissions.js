// Central role -> permission map.
//
// Keeping this in a dependency-free module means the rules can be unit tested
// without a database or a Better Auth session, and every router uses the same
// source of truth.
//
// Role names are the values stored in `User.role`:
//   ADMIN        gym owner / full control of that gym
//   RECEPTIONIST staff account / read + create only
//   SUPER_ADMIN  SaaS platform operator (not a gym member)
//
// `gymId` scoping is enforced separately in controllers: every query is filtered
// by `req.user.gymId`, so a role never grants access to another gym's data.

export const ROLE = {
  OWNER: "ADMIN",
  STAFF: "RECEPTIONIST",
  SUPER_ADMIN: "SUPER_ADMIN",
};

export const PERMISSION = {
  READ: "records:read",
  CREATE: "records:create",
  UPDATE: "records:update",
  DELETE: "records:delete",
  MANAGE_STAFF: "staff:manage",
  MANAGE_SUBSCRIPTION: "subscription:manage",
  MANAGE_PLATFORM: "platform:manage",
};

const ROLE_PERMISSIONS = {
  [ROLE.OWNER]: [
    PERMISSION.READ,
    PERMISSION.CREATE,
    PERMISSION.UPDATE,
    PERMISSION.DELETE,
    PERMISSION.MANAGE_STAFF,
    PERMISSION.MANAGE_SUBSCRIPTION,
  ],
  [ROLE.STAFF]: [PERMISSION.READ, PERMISSION.CREATE],
  [ROLE.SUPER_ADMIN]: [PERMISSION.MANAGE_PLATFORM],
};

/** Permissions granted to a role. Unknown roles get none (deny by default). */
export function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function can(role, permission) {
  return permissionsFor(role).includes(permission);
}

/**
 * Map an HTTP method to the record permission it needs.
 * Returns null for methods that are not part of the record CRUD surface.
 */
export function permissionForMethod(method) {
  switch (String(method ?? "").toUpperCase()) {
    case "GET":
    case "HEAD":
    case "OPTIONS":
      return PERMISSION.READ;
    case "POST":
      return PERMISSION.CREATE;
    case "PUT":
    case "PATCH":
      return PERMISSION.UPDATE;
    case "DELETE":
      return PERMISSION.DELETE;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Express middleware. These are dependency-free so they can be unit tested
// without a database or an auth session. `src/middleware/auth.js` re-exports
// them so routes keep importing from one place.
// ---------------------------------------------------------------------------

/** Allow only the listed roles. */
export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "You do not have permission" });
    }
    next();
  };
}

/**
 * Require one capability from the central permission map.
 *
 * Use this for endpoints whose HTTP method does not describe the change they
 * make — for example `POST /memberships/:id/cancel` updates an existing record
 * and therefore needs `records:update`, not `records:create`.
 */
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!can(req.user.role, permission)) {
      return res.status(403).json({
        error: "You do not have permission",
        code: "FORBIDDEN",
        requiredPermission: permission,
      });
    }
    next();
  };
}

/**
 * Staff (RECEPTIONIST) rule: read (GET/HEAD) and create (POST) only.
 * PUT / PATCH / DELETE are rejected here, so individual controllers do not
 * need role checks. Applied to every gym-data router.
 */
export function allowReadAndCreateOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const permission = permissionForMethod(req.method);
  if (!permission) {
    return res.status(403).json({ error: "You do not have permission" });
  }

  if (!can(req.user.role, permission)) {
    const message =
      req.user.role === ROLE.STAFF
        ? "Receptionists can only view (GET) and add (POST) data"
        : "You do not have permission";
    return res.status(403).json({
      error: message,
      code: "FORBIDDEN",
      requiredPermission: permission,
    });
  }

  next();
}
