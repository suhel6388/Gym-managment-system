// Promote a user to SaaS SUPER_ADMIN (out-of-band, one-time operation).
//
// Usage:
//   tsx scripts/make-super-admin.mjs <email>
//
// The SUPER_ADMIN role is never assignable from client input (better-auth
// marks the `role` additional field input:false). This script is the only
// supported path to grant platform-owner privileges.

import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const email = process.argv[2];
if (!email) {
  console.error('Usage: tsx scripts/make-super-admin.mjs <email>');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const user = await prisma.user.update({
    where: { email },
    data: { role: "SUPER_ADMIN" },
    select: { id: true, name: true, email: true, role: true },
  });
  console.log(`Promoted ${user.email} (${user.id}) to role ${user.role}.`);
}

main()
  .catch((err) => {
    console.error("Failed to promote super-admin:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
