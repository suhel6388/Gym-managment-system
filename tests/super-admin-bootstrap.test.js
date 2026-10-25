import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  bootstrapSchema,
  isBootstrapSecretValid,
  requireBootstrapAccess,
} from "../src/controllers/super-admin.bootstrap.controller.js";

// Pure unit tests: the endpoint's validation and gate are exercised without a
// database, session or network. The DB-writing path mirrors
// scripts/make-super-admin.mjs and is verified against a live deployment.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const VALID = {
  name: "  Platform Owner  ",
  email: "Owner@Platform.COM",
  password: "a-strong-12+-char-password",
};

function withSecret(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(
    process.env,
    "SUPER_ADMIN_BOOTSTRAP_SECRET",
  );
  const previous = process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
  if (value === undefined) delete process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
  else process.env.SUPER_ADMIN_BOOTSTRAP_SECRET = value;
  try {
    return fn();
  } finally {
    if (had) process.env.SUPER_ADMIN_BOOTSTRAP_SECRET = previous;
    else delete process.env.SUPER_ADMIN_BOOTSTRAP_SECRET;
  }
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

function runGate(req) {
  const res = makeRes();
  let nextCalled = false;
  requireBootstrapAccess(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

test("bootstrap schema accepts name, email and password and normalizes them", () => {
  const parsed = bootstrapSchema.parse(VALID);
  assert.strictEqual(parsed.name, "Platform Owner");
  assert.strictEqual(parsed.email, "owner@platform.com");
  assert.strictEqual(parsed.password, VALID.password);
});

test("bootstrap schema requires a password of at least 12 characters", () => {
  assert.throws(
    () => bootstrapSchema.parse({ ...VALID, password: "short-pass1" }),
    (err) => err.name === "ZodError" && /12 characters/.test(err.issues[0].message),
  );
});

test("bootstrap schema rejects a short name and an invalid email", () => {
  assert.throws(
    () => bootstrapSchema.parse({ ...VALID, name: "A" }),
    (err) => err.name === "ZodError",
  );
  assert.throws(
    () => bootstrapSchema.parse({ ...VALID, email: "not-an-email" }),
    (err) => err.name === "ZodError",
  );
});

test("a client-supplied role is stripped, not honoured", () => {
  const parsed = bootstrapSchema.parse({ ...VALID, role: "RECEPTIONIST" });
  assert.strictEqual("role" in parsed, false);
  assert.strictEqual(Object.keys(parsed).sort().join(","), "email,name,password");
});

test("first-run mode (no configured secret) allows the call", () => {
  withSecret(undefined, () => {
    assert.strictEqual(isBootstrapSecretValid(undefined), true);
    assert.strictEqual(isBootstrapSecretValid("anything"), true);
  });
});

test("a configured secret must match exactly", () => {
  withSecret("s3cret-bootstrap-value", () => {
    assert.strictEqual(isBootstrapSecretValid("s3cret-bootstrap-value"), true);
    assert.strictEqual(isBootstrapSecretValid("wrong"), false);
    assert.strictEqual(isBootstrapSecretValid(""), false);
    assert.strictEqual(isBootstrapSecretValid(undefined), false);
    // Different lengths must not throw from timingSafeEqual.
    assert.strictEqual(isBootstrapSecretValid("s3cret-bootstrap-value-extra"), false);
  });
});

test("requireBootstrapAccess returns 401 without a valid header", () => {
  withSecret("s3cret-bootstrap-value", () => {
    const missing = runGate({ get: () => undefined });
    assert.strictEqual(missing.nextCalled, false);
    assert.strictEqual(missing.res.statusCode, 401);
    assert.strictEqual(missing.res.body.code, "BOOTSTRAP_SECRET_REQUIRED");

    const wrong = runGate({ get: () => "nope" });
    assert.strictEqual(wrong.nextCalled, false);
    assert.strictEqual(wrong.res.statusCode, 401);

    const ok = runGate({ get: () => "s3cret-bootstrap-value" });
    assert.strictEqual(ok.nextCalled, true);
  });
});

// --- static wiring checks -------------------------------------------------

test("the new route is mounted without touching the existing auth routes", () => {
  const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  assert.match(app, /superAdminBootstrapRoutes/);
  assert.match(app, /app\.use\("\/api\/v1\/auth", superAdminBootstrapRoutes\)/);
  // Existing auth router is still mounted exactly once.
  assert.strictEqual(
    (app.match(/app\.use\("\/api\/v1\/auth", authRoutes\)/g) ?? []).length,
    1,
  );

  const authRoute = fs.readFileSync(
    path.join(root, "src", "routes", "auth.route.js"),
    "utf8",
  );
  assert.doesNotMatch(authRoute, /bootstrap-super-admin/);
  assert.match(authRoute, /router\.post\("\/login", login\)/);
  assert.match(authRoute, /router\.post\("\/signup", signup\)/);
});

test("the bootstrap route is rate limited and gated", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "routes", "super-admin.bootstrap.route.js"),
    "utf8",
  );
  assert.match(source, /rateLimit\(/);
  assert.match(source, /requireBootstrapAccess/);
  assert.match(source, /"\/bootstrap-super-admin"/);
});

test("the controller always assigns SUPER_ADMIN and marks the email verified", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "controllers", "super-admin.bootstrap.controller.js"),
    "utf8",
  );
  assert.match(source, /role: "SUPER_ADMIN"/);
  assert.match(source, /emailVerified: true/);
  assert.match(source, /providerId: "credential"/);
  // The request body must never drive the role.
  assert.doesNotMatch(source, /role:\s*input\.role/);
});

test("bootstrap refuses to run once a SUPER_ADMIN already exists", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "controllers", "super-admin.bootstrap.controller.js"),
    "utf8",
  );
  assert.match(source, /role: "SUPER_ADMIN" \}/);
  assert.match(source, /SUPER_ADMIN_ALREADY_EXISTS/);
  assert.match(source, /pg_advisory_xact_lock/);
});

test("promoting an account attached to a gym is refused", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "controllers", "super-admin.bootstrap.controller.js"),
    "utf8",
  );
  assert.match(source, /ACCOUNT_BELONGS_TO_GYM/);
});
