// Idempotent seed for the SaaS subscription module.
// Run: npm run seed   (or: npx tsx prisma/seed.mjs)
// Safe to run repeatedly — plans are upserted by `code`, settings by singleton id.

import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Prices are integer paise (₹499 = 49900).
const DEFAULT_PLANS = [
  {
    code: "MONTHLY",
    name: "Monthly",
    description: "Full access for one month. Best for trying us out.",
    pricePaise: 49900,
    durationMonths: 1,
    displayOrder: 1,
    features: ["Unlimited members", "Attendance tracking", "Payments & expenses", "Reports dashboard"],
    maxStaff: 2,
    maxBranches: 1,
  },
  {
    code: "QUARTERLY",
    name: "Quarterly",
    description: "Three months of full access at a discounted price.",
    pricePaise: 139900,
    durationMonths: 3,
    displayOrder: 2,
    features: ["Unlimited members", "Attendance tracking", "Payments & expenses", "Reports dashboard", "Priority support"],
    maxStaff: 5,
    maxBranches: 1,
  },
  {
    code: "HALF_YEARLY",
    name: "Half-yearly",
    description: "Six months of full access at our best per-month rate.",
    pricePaise: 279900,
    durationMonths: 6,
    displayOrder: 3,
    features: ["Unlimited members", "Attendance tracking", "Payments & expenses", "Reports dashboard", "Priority support", "Data export"],
    maxStaff: 10,
    maxBranches: 2,
  },
  {
    code: "ANNUAL",
    name: "Annual",
    description: "Twelve months of full access — maximum savings.",
    pricePaise: 469900,
    durationMonths: 12,
    displayOrder: 4,
    features: ["Unlimited members", "Attendance tracking", "Payments & expenses", "Reports dashboard", "Dedicated support", "Data export", "Custom branding"],
    maxStaff: 25,
    maxBranches: 5,
  },
];

async function main() {
  for (const plan of DEFAULT_PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: { ...plan, isActive: true },
      update: {
        // Reseeding resets plan definition fields to defaults (existing
        // GymSubscription rows keep their own price/name snapshots, so this
        // never changes past purchase terms). Admin edits happen after seed.
        name: plan.name,
        description: plan.description,
        pricePaise: plan.pricePaise,
        durationMonths: plan.durationMonths,
        displayOrder: plan.displayOrder,
        features: plan.features,
        maxStaff: plan.maxStaff,
        maxBranches: plan.maxBranches,
      },
    });
  }

  await prisma.subscriptionSetting.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      trialEnabled: true,
      trialDurationDays: 14,
      trialPricePaise: 0,
      trialRequiresPaymentMethod: false,
      cancellationPolicy: "END_OF_PERIOD",
      reminderDaysBefore: 3,
    },
    update: {}, // settings are admin-managed after first creation — never reset on reseed
  });

  const count = await prisma.subscriptionPlan.count();
  console.log(`Seed complete: ${count} SaaS plan(s) in database, subscription settings ready.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
