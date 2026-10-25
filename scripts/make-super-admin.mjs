// One-time platform administrator bootstrap.
//
// There is deliberately NO public super-admin registration endpoint and no API
// that can assign the SUPER_ADMIN role. This script is the only supported path
// and must be run by an operator with database/secret access.
//
// Create the first account (recommended):
//   SUPER_ADMIN_EMAIL=owner@platform.com \
//   SUPER_ADMIN_PASSWORD='a-strong-12+-char-password' \
//   SUPER_ADMIN_NAME='Platform Owner' \
//   npm run bootstrap-super-admin
//
// Promote an existing verified account (no password reset):
//   npm run bootstrap-super-admin -- owner@platform.com
//
// If the target account already belongs to a gym, promotion is refused by
// default. Pass --detach-gym only after confirming it is not a gym owner:
//   npm run bootstrap-super-admin -- owner@platform.com --detach-gym
//
// Rules enforced here:
//   - password is required when creating a new account (minimum 12 chars)
//   - new accounts are created emailVerified, with gymId = null
//   - the credential Account row uses Better Auth's own password hash so normal
//     email/password sign-in works without a verification email
//   - promotion through this script is audited with a console line; the
//     password is never logged

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "better-auth/crypto";

const email = (process.env.SUPER_ADMIN_EMAIL || process.argv[2] || "").trim().toLowerCase();
const password = process.env.SUPER_ADMIN_PASSWORD || "";
const name = (process.env.SUPER_ADMIN_NAME || "Platform Owner").trim();
const detachGym = process.argv.includes("--detach-gym");

function usage(message) {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    "Usage:\n" +
      "  SUPER_ADMIN_EMAIL=you@platform.com SUPER_ADMIN_PASSWORD='12+ chars' " +
      "SUPER_ADMIN_NAME='Platform Owner' npm run bootstrap-super-admin\n" +
      "  npm run bootstrap-super-admin -- existing@platform.com [--detach-gym]",
  );
  process.exit(1);
}

if (!email) usage("SUPER_ADMIN_EMAIL is required (or pass an email argument).");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage("SUPER_ADMIN_EMAIL is not a valid email.");
if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
  usage("DATABASE_URL is not configured.");
}
if (password && password.length < 12) {
  usage("SUPER_ADMIN_PASSWORD must be at least 12 characters for a new account.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
  }),
});

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, gymId: true, emailVerified: true },
  });

  if (existing) {
    if (existing.gymId && !detachGym) {
      throw new Error(
        "This account belongs to a gym. Platform admins must be separate accounts. " +
          "Re-run with --detach-gym only if this is a platform operator, not a gym owner.",
      );
    }

    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: "SUPER_ADMIN",
        emailVerified: true,
        ...(existing.gymId && detachGym ? { gymId: null } : {}),
      },
      select: { id: true, name: true, email: true, role: true, gymId: true },
    });

    console.log(
      `Promoted existing account ${updated.email} (${updated.id}) to ${updated.role}` +
        `${updated.gymId ? ` (still attached to gym ${updated.gymId})` : " with no gym attachment"}.`,
    );
    console.log("Password was not changed. Use the normal password-reset flow if needed.");
    return;
  }

  if (!password) {
    usage(
      "SUPER_ADMIN_PASSWORD is required when creating a new account " +
        "(or pass the email of an existing verified account to promote it).",
    );
  }
  if (!name || name.length < 2) usage("SUPER_ADMIN_NAME must be at least 2 characters.");

  const passwordHash = await hashPassword(password);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        role: "SUPER_ADMIN",
        emailVerified: true,
        gymId: null,
      },
      select: { id: true, name: true, email: true, role: true, gymId: true },
    });

    // This is the same credential shape Better Auth writes for email/password
    // sign-ups. The accountId is the user id for the credential provider.
    await tx.account.create({
      data: {
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
      },
    });

    return user;
  });

  console.log(`Created platform administrator ${created.email} (${created.id}).`);
  console.log("No gym is attached. Sign in at /login; the app will open /super-admin.");
}

main()
  .catch((err) => {
    console.error("Failed to bootstrap super-admin:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
