import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ROLE,
  PERMISSION,
  allowReadAndCreateOnly,
  allowRoles,
  can,
  permissionForMethod,
  permissionsFor,
  requirePermission,
} from "../src/middleware/permissions.js";

// Pure unit tests: no database, session or network required.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routesDir = path.join(__dirname, "..", "src", "routes");

function makeReq(method, role) {
  return {
    method,
    user: role ? { id: "user-1", gymId: "gym-1", role } : undefined,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

/** Run a sync Express middleware and report what it did. */
function run(middleware, req) {
  const res = makeRes();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

test("owner (ADMIN) has full record CRUD permissions", () => {
  assert.strictEqual(can(ROLE.OWNER, PERMISSION.READ), true);
  assert.strictEqual(can(ROLE.OWNER, PERMISSION.CREATE), true);
  assert.strictEqual(can(ROLE.OWNER, PERMISSION.UPDATE), true);
  assert.strictEqual(can(ROLE.OWNER, PERMISSION.DELETE), true);
  assert.strictEqual(can(ROLE.OWNER, PERMISSION.MANAGE_STAFF), true);
});

test("staff (RECEPTIONIST) can read and create but not update or delete", () => {
  assert.deepStrictEqual(permissionsFor(ROLE.STAFF), [
    PERMISSION.READ,
    PERMISSION.CREATE,
  ]);
  assert.strictEqual(can(ROLE.STAFF, PERMISSION.UPDATE), false);
  assert.strictEqual(can(ROLE.STAFF, PERMISSION.DELETE), false);
  assert.strictEqual(can(ROLE.STAFF, PERMISSION.MANAGE_STAFF), false);
  assert.strictEqual(can(ROLE.STAFF, PERMISSION.MANAGE_SUBSCRIPTION), false);
});

test("unknown roles get no permissions (deny by default)", () => {
  assert.deepStrictEqual(permissionsFor("SOMETHING_ELSE"), []);
  assert.strictEqual(can(undefined, PERMISSION.READ), false);
});

test("permissionForMethod maps the CRUD surface", () => {
  assert.strictEqual(permissionForMethod("GET"), PERMISSION.READ);
  assert.strictEqual(permissionForMethod("head"), PERMISSION.READ);
  assert.strictEqual(permissionForMethod("POST"), PERMISSION.CREATE);
  assert.strictEqual(permissionForMethod("PATCH"), PERMISSION.UPDATE);
  assert.strictEqual(permissionForMethod("put"), PERMISSION.UPDATE);
  assert.strictEqual(permissionForMethod("DELETE"), PERMISSION.DELETE);
  assert.strictEqual(permissionForMethod("TRACE"), null);
});

test("allowReadAndCreateOnly lets staff GET and POST", () => {
  for (const method of ["GET", "POST"]) {
    const { nextCalled, res } = run(allowReadAndCreateOnly, makeReq(method, ROLE.STAFF));
    assert.strictEqual(nextCalled, true, `${method} should be allowed`);
    assert.strictEqual(res.statusCode, 200);
  }
});

test("allowReadAndCreateOnly blocks staff PATCH, PUT and DELETE with 403", () => {
  for (const method of ["PATCH", "PUT", "DELETE"]) {
    const { nextCalled, res } = run(allowReadAndCreateOnly, makeReq(method, ROLE.STAFF));
    assert.strictEqual(nextCalled, false, `${method} should be blocked`);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.code, "FORBIDDEN");
  }
});

test("allowReadAndCreateOnly lets the owner use every CRUD method", () => {
  for (const method of ["GET", "POST", "PATCH", "PUT", "DELETE"]) {
    const { nextCalled } = run(allowReadAndCreateOnly, makeReq(method, ROLE.OWNER));
    assert.strictEqual(nextCalled, true, `${method} should be allowed for ADMIN`);
  }
});

test("allowReadAndCreateOnly rejects unauthenticated requests with 401", () => {
  const { nextCalled, res } = run(allowReadAndCreateOnly, makeReq("GET"));
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 401);
});

test("allowReadAndCreateOnly rejects non-CRUD methods", () => {
  const { nextCalled, res } = run(allowReadAndCreateOnly, makeReq("TRACE", ROLE.OWNER));
  assert.strictEqual(nextCalled, false);
  assert.strictEqual(res.statusCode, 403);
});

test("requirePermission(UPDATE) blocks staff but allows the owner", () => {
  const staff = run(requirePermission(PERMISSION.UPDATE), makeReq("POST", ROLE.STAFF));
  assert.strictEqual(staff.nextCalled, false);
  assert.strictEqual(staff.res.statusCode, 403);
  assert.strictEqual(staff.res.body.requiredPermission, PERMISSION.UPDATE);

  const owner = run(requirePermission(PERMISSION.UPDATE), makeReq("POST", ROLE.OWNER));
  assert.strictEqual(owner.nextCalled, true);
});

test("requirePermission(MANAGE_STAFF) is owner-only", () => {
  const staff = run(requirePermission(PERMISSION.MANAGE_STAFF), makeReq("POST", ROLE.STAFF));
  assert.strictEqual(staff.nextCalled, false);
  assert.strictEqual(staff.res.statusCode, 403);

  const owner = run(requirePermission(PERMISSION.MANAGE_STAFF), makeReq("POST", ROLE.OWNER));
  assert.strictEqual(owner.nextCalled, true);
});

test("allowRoles rejects roles that are not listed", () => {
  const staff = run(allowRoles(ROLE.OWNER), makeReq("GET", ROLE.STAFF));
  assert.strictEqual(staff.nextCalled, false);
  assert.strictEqual(staff.res.statusCode, 403);
});

// Static wiring checks: the permission middleware must be attached to the
// router, not only checked inside controllers. This catches a future route
// being added without a guard.
const gymDataRouters = [
  "members.route.js",
  "plans.route.js",
  "membership.routes.js",
  "payment.route.js",
  "expenses.route.js",
  "reports.routes.js",
  "attendence.route.js",
];

test("every gym-data router applies allowReadAndCreateOnly", () => {
  for (const file of gymDataRouters) {
    const source = fs.readFileSync(path.join(routesDir, file), "utf8");
    assert.match(
      source,
      /allowReadAndCreateOnly/,
      `${file} must apply allowReadAndCreateOnly`,
    );
  }
});

test("staff and subscription management routes require owner permissions", () => {
  const staff = fs.readFileSync(path.join(routesDir, "staff.route.js"), "utf8");
  assert.match(staff, /requirePermission\(PERMISSION\.MANAGE_STAFF\)/);

  const subscription = fs.readFileSync(
    path.join(routesDir, "subscription.route.js"),
    "utf8",
  );
  assert.match(subscription, /PERMISSION\.MANAGE_SUBSCRIPTION/);
});

test("membership state changes require the update permission", () => {
  const source = fs.readFileSync(
    path.join(routesDir, "membership.routes.js"),
    "utf8",
  );
  const matches = source.match(/requirePermission\(PERMISSION\.UPDATE\)/g) ?? [];
  assert.strictEqual(matches.length, 2, "freeze and cancel must both be guarded");
});
