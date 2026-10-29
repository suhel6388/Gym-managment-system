import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prisma } from "../src/db.js";
import { ROLE } from "../src/middleware/permissions.js";
import {
  createGymOwnerSchema,
  listGymOwnersSchema,
} from "../src/controllers/super-admin.owners.controller.js";
import {
  createGymOwner,
  listGymOwners,
} from "../src/services/super-admin-gym-owners.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREFIX = `go_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const SUPER_ADMIN = {
  id: `super-${PREFIX}`,
  role: "SUPER_ADMIN",
  email: `super-${PREFIX}@example.com`,
  gymId: null,
};

const VALID = {
  ownerName: "  Gym Owner  ",
  ownerEmail: "Owner@Example.COM",
  ownerPhone: "+91 98765 43210",
  gymName: "  Iron House  ",
  gymEmail: "",
  gymPhone: "",
  gymAddress: "  12 Main Street  ",
  mode: "PASSWORD",
  password: "strong-password-123",
};

// --- pure validation tests -------------------------------------------------

test("create-gym-owner schema normalizes owner and gym fields", () => {
  const parsed = createGymOwnerSchema.parse(VALID);
  assert.strictEqual(parsed.ownerName, "Gym Owner");
  assert.strictEqual(parsed.ownerEmail, "owner@example.com");
  assert.strictEqual(parsed.ownerPhone, "+919876543210");
  assert.strictEqual(parsed.gymName, "Iron House");
  assert.strictEqual(parsed.gymEmail, undefined);
  assert.strictEqual(parsed.gymPhone, undefined);
  assert.strictEqual(parsed.gymAddress, "12 Main Street");
  assert.strictEqual(parsed.mode, "PASSWORD");
});

test("create-gym-owner schema defaults to PASSWORD and rejects short passwords", () => {
  const parsed = createGymOwnerSchema.parse({
    ...VALID,
    mode: undefined,
  });
  assert.strictEqual(parsed.mode, "PASSWORD");

  assert.throws(
    () => createGymOwnerSchema.parse({ ...VALID, password: "short1" }),
    (err) => err.name === "ZodError" && /8 characters/.test(err.issues[0].message),
  );
  assert.throws(
    () => createGymOwnerSchema.parse({ ...VALID, password: undefined }),
    (err) => err.name === "ZodError",
  );
});

test("invite mode does not require a password", () => {
  const parsed = createGymOwnerSchema.parse({
    ...VALID,
    mode: "INVITE",
    password: undefined,
  });
  assert.strictEqual(parsed.mode, "INVITE");
  assert.strictEqual(parsed.password, undefined);
});

test("create-gym-owner schema rejects invalid email, phone and missing names", () => {
  assert.throws(
    () => createGymOwnerSchema.parse({ ...VALID, ownerEmail: "nope" }),
    (err) => err.name === "ZodError",
  );
  assert.throws(
    () => createGymOwnerSchema.parse({ ...VALID, ownerPhone: "123" }),
    (err) => err.name === "ZodError",
  );
  assert.throws(
    () => createGymOwnerSchema.parse({ ...VALID, ownerPhone: undefined }),
    (err) => err.name === "ZodError",
  );
  assert.throws(
    () => createGymOwnerSchema.parse({ ...VALID, gymName: "A" }),
    (err) => err.name === "ZodError",
  );
});

test("create-gym-owner schema strips a client-supplied role or gymId", () => {
  const parsed = createGymOwnerSchema.parse({
    ...VALID,
    role: "SUPER_ADMIN",
    gymId: "someone-elses-gym",
  });
  assert.strictEqual("role" in parsed, false);
  assert.strictEqual("gymId" in parsed, false);
});

test("owner list schema paginates and caps the page size", () => {
  const parsed = listGymOwnersSchema.parse({ page: "2", limit: "100", q: " iron " });
  assert.strictEqual(parsed.page, 2);
  assert.strictEqual(parsed.limit, 100);
  assert.strictEqual(parsed.q, "iron");
  assert.throws(() => listGymOwnersSchema.parse({ limit: "101" }), (err) => err.name === "ZodError");
});

test("ROLE.OWNER maps to the existing ADMIN role, so permissions keep working", () => {
  assert.strictEqual(ROLE.OWNER, "ADMIN");
});

// --- static route wiring ---------------------------------------------------

test("creating a gym owner requires an authenticated SUPER_ADMIN session", () => {
  const route = fs.readFileSync(
    path.join(__dirname, "..", "src", "routes", "super-admin.route.js"),
    "utf8",
  );
  assert.match(route, /router\.use\(authenticate, requireSuperAdmin\)/);
  assert.match(route, /router\.post\("\/gyms", mutationLimit, createGym\)/);
  assert.match(route, /router\.get\("\/owners", getGymOwners\)/);
});

test("the onboarding service hashes credentials with Better Auth", () => {
  const service = fs.readFileSync(
    path.join(__dirname, "..", "src", "services", "super-admin-gym-owners.service.js"),
    "utf8",
  );
  assert.match(service, /import \{ hashPassword \} from "better-auth\/crypto"/);
  assert.match(service, /providerId: "credential"/);
  assert.match(service, /role: ROLE\.OWNER/);
  assert.match(service, /emailVerified: true/);
  assert.match(service, /source: "ADMIN_CREATED"/);
});

// --- database integration --------------------------------------------------

async function cleanup(gymId, ownerId, planId) {
  await prisma.subscriptionAuditLog.deleteMany({ where: { gymId } });
  await prisma.trialRecord.deleteMany({ where: { gymId } });
  await prisma.gymSubscription.deleteMany({ where: { gymId } });
  if (ownerId) {
    await prisma.account.deleteMany({ where: { userId: ownerId } }).catch(() => {});
    await prisma.session.deleteMany({ where: { userId: ownerId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: ownerId } }).catch(() => {});
  }
  await prisma.gym.deleteMany({ where: { id: gymId } }).catch(() => {});
  if (planId) {
    await prisma.subscriptionPlan.deleteMany({ where: { id: planId } }).catch(() => {});
  }
}

test("createGymOwner creates the gym, OWNER account, paid subscription and audit log", async () => {
  const plan = await prisma.subscriptionPlan.create({
    data: {
      code: `${PREFIX}_PLAN`.toUpperCase(),
      name: `${PREFIX} plan`,
      pricePaise: 49900,
      durationMonths: 1,
      features: ["Integration test"],
    },
  });

  let gymId = null;
  let ownerId = null;
  try {
    const result = await createGymOwner(SUPER_ADMIN, {
      ownerName: `${PREFIX} Owner`,
      ownerEmail: `owner-${PREFIX}@example.com`,
      ownerPhone: `9${String(Date.now()).slice(-9)}`,
      gymName: `${PREFIX} Gym`,
      gymAddress: "Test address",
      mode: "PASSWORD",
      password: "owner-password-123",
      planId: plan.id,
    });

    gymId = result.data.gym.id;
    ownerId = result.data.owner.id;

    const [gym, owner, account, subscription, trial, audit] = await Promise.all([
      prisma.gym.findUnique({ where: { id: gymId } }),
      prisma.user.findUnique({ where: { id: ownerId } }),
      prisma.account.findFirst({ where: { userId: ownerId, providerId: "credential" } }),
      prisma.gymSubscription.findUnique({ where: { gymId } }),
      prisma.trialRecord.findFirst({ where: { gymId } }),
      prisma.subscriptionAuditLog.findFirst({ where: { gymId, action: "GYM_CREATED" } }),
    ]);

    assert.ok(gym);
    assert.strictEqual(owner.gymId, gymId);
    assert.strictEqual(owner.role, ROLE.OWNER);
    assert.strictEqual(owner.emailVerified, true);
    assert.ok(account?.password, "credential password hash is stored");
    assert.strictEqual(subscription.status, "ACTIVE");
    assert.strictEqual(subscription.planId, plan.id);
    assert.strictEqual(trial, null, "a paid plan must not also record a trial");
    assert.strictEqual(audit.actorUserId, SUPER_ADMIN.id);
    assert.strictEqual(result.data.owner.roleLabel, "OWNER");
    assert.strictEqual(result.data.subscription.effectiveStatus, "ACTIVE");

    const search = await listGymOwners(SUPER_ADMIN, {
      q: `owner-${PREFIX}@example.com`,
      limit: 10,
    });
    assert.strictEqual(search.data.pagination.total, 1);
    assert.strictEqual(search.data.owners[0].gym.id, gymId);
  } finally {
    if (gymId) await cleanup(gymId, ownerId, plan.id);
    else await prisma.subscriptionPlan.deleteMany({ where: { id: plan.id } });
  }
});

test("createGymOwner rejects a duplicate email without creating anything", async () => {
  const email = `duplicate-${PREFIX}@example.com`;
  const phone = `8${String(Date.now()).slice(-9)}`;
  const owner = await prisma.user.create({
    data: { name: `${PREFIX} Existing`, email, phone, role: "ADMIN", emailVerified: true },
    select: { id: true },
  });

  try {
    await assert.rejects(
      () =>
        createGymOwner(SUPER_ADMIN, {
          ownerName: `${PREFIX} Duplicate`,
          ownerEmail: email,
          ownerPhone: `7${String(Date.now()).slice(-9)}`,
          gymName: `${PREFIX} Duplicate Gym`,
          mode: "PASSWORD",
          password: "owner-password-123",
        }),
      (err) => err.statusCode === 409 && err.code === "EMAIL_ALREADY_REGISTERED",
    );
  } finally {
    await prisma.user.deleteMany({ where: { id: owner.id } });
  }
});

test("createGymOwner is forbidden for non-super-admin actors", async () => {
  await assert.rejects(
    () =>
      createGymOwner(
        { id: "admin", role: "ADMIN", email: "admin@example.com" },
        {
          ownerName: "Nope",
          ownerEmail: `nope-${PREFIX}@example.com`,
          ownerPhone: "9999999999",
          gymName: "Nope Gym",
          mode: "PASSWORD",
          password: "owner-password-123",
        },
      ),
    (err) => err.statusCode === 403 && err.code === "SUPER_ADMIN_REQUIRED",
  );
});
