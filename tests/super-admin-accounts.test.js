import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAdminSchema } from "../src/controllers/super-admin.accounts.controller.js";
import { superAdminLoginSchema } from "../src/controllers/super-admin.auth.controller.js";
import {
  MAX_PLATFORM_ADMINS,
  isPlatformAdmin,
} from "../src/services/super-admin-accounts.service.js";

// Pure unit tests: validation, the two-account cap and route wiring. No
// database, session or network access.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const VALID = {
  name: "  Second Owner  ",
  email: "Co-Owner@Platform.COM",
  password: "a-strong-12+-char-password",
};

test("the platform administrator cap is two", () => {
  assert.strictEqual(MAX_PLATFORM_ADMINS, 2);
});

test("create-admin schema accepts name, email and password and normalizes them", () => {
  const parsed = createAdminSchema.parse(VALID);
  assert.strictEqual(parsed.name, "Second Owner");
  assert.strictEqual(parsed.email, "co-owner@platform.com");
  assert.strictEqual(parsed.password, VALID.password);
});

test("create-admin schema rejects short passwords, short names and bad emails", () => {
  assert.throws(
    () => createAdminSchema.parse({ ...VALID, password: "short-pass1" }),
    (err) => err.name === "ZodError" && /12 characters/.test(err.issues[0].message),
  );
  assert.throws(
    () => createAdminSchema.parse({ ...VALID, name: "A" }),
    (err) => err.name === "ZodError",
  );
  assert.throws(
    () => createAdminSchema.parse({ ...VALID, email: "nope" }),
    (err) => err.name === "ZodError",
  );
});

test("create-admin schema strips a client-supplied role", () => {
  const parsed = createAdminSchema.parse({ ...VALID, role: "RECEPTIONIST" });
  assert.strictEqual("role" in parsed, false);
});

test("super-admin login schema requires email and password", () => {
  const parsed = superAdminLoginSchema.parse({
    email: " Owner@Platform.com ",
    password: "x",
  });
  assert.strictEqual(parsed.email, "owner@platform.com");
  assert.throws(
    () => superAdminLoginSchema.parse({ email: "owner@platform.com" }),
    (err) => err.name === "ZodError",
  );
});

test("isPlatformAdmin accepts only SUPER_ADMIN rows", () => {
  assert.strictEqual(isPlatformAdmin({ role: "SUPER_ADMIN" }), true);
  assert.strictEqual(isPlatformAdmin({ role: "ADMIN" }), false);
  assert.strictEqual(isPlatformAdmin({ role: "RECEPTIONIST" }), false);
  assert.strictEqual(isPlatformAdmin(null), false);
  assert.strictEqual(isPlatformAdmin(undefined), false);
});

// --- static wiring checks -------------------------------------------------

test("creating an admin requires an authenticated SUPER_ADMIN session", () => {
  const route = fs.readFileSync(
    path.join(root, "src", "routes", "super-admin.route.js"),
    "utf8",
  );
  assert.match(route, /router\.use\(authenticate, requireSuperAdmin\)/);
  assert.match(route, /router\.post\("\/admins", mutationLimit, createAdmin\)/);
});

test("the service enforces the cap, the lock and verified credentials", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "services", "super-admin-accounts.service.js"),
    "utf8",
  );
  assert.match(source, /MAX_PLATFORM_ADMINS = 2/);
  assert.match(source, /SUPER_ADMIN_LIMIT_REACHED/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /emailVerified: true/);
  assert.match(source, /providerId: "credential"/);
  assert.match(source, /role !== "SUPER_ADMIN"/);
  assert.match(source, /ACCOUNT_BELONGS_TO_GYM/);
  assert.match(source, /ALREADY_SUPER_ADMIN/);
});

test("the platform login never sends an OTP and rejects non-super-admins", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "controllers", "super-admin.auth.controller.js"),
    "utf8",
  );
  assert.match(source, /account\.role !== "SUPER_ADMIN"/);
  assert.doesNotMatch(source, /sendVerificationOtp|sendOTPEmail|createVerificationOTP/);
  assert.match(source, /signInEmail/);
  assert.match(source, /redirect: "\/super-admin"/);
});

test("both new routes are mounted alongside the untouched auth router", () => {
  const app = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
  assert.match(app, /app\.use\("\/api\/v1\/auth", superAdminBootstrapRoutes\)/);
  assert.match(app, /app\.use\("\/api\/v1\/auth", superAdminAuthRoutes\)/);
  assert.strictEqual(
    (app.match(/app\.use\("\/api\/v1\/auth", authRoutes\)/g) ?? []).length,
    1,
  );

  const authRoute = fs.readFileSync(
    path.join(root, "src", "routes", "auth.route.js"),
    "utf8",
  );
  assert.doesNotMatch(authRoute, /super-admin\/login|bootstrap-super-admin|\/admins/);
});
