// Idempotent seed for the SaaS subscription module.
// Run: npm run seed   (or: npx tsx prisma/seed.mjs)
// Safe to run repeatedly — plans are upserted by `code`, settings by singleton id.

import { PrismaClient } from "../generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Configurable trial days via DEFAULT_TRIAL_DAYS env var (default: 7 days)
const DEFAULT_TRIAL_DAYS = Math.max(
  1,
  Number.parseInt(process.env.DEFAULT_TRIAL_DAYS || "7", 10) || 7
);

// Prices are integer paise (₹499 = 49900).
// 3 Core default plans (Basic, Pro, Premium) + duration tiers.
const DEFAULT_PLANS = [
  {
    code: "BASIC",
    slug: "basic",
    name: "Basic",
    description: "Essential gym operations for single-location clubs.",
    pricePaise: 49900,
    currency: "INR",
    durationMonths: 1,
    durationDays: 30,
    displayOrder: 1,
    features: [
      "Up to 200 members",
      "QR & Manual attendance",
      "Fee payment receipts & WhatsApp share",
      "Expense tracking",
      "Basic financial reports",
    ],
    maxStaff: 2,
    maxBranches: 1,
  },
  {
    code: "PRO",
    slug: "pro",
    name: "Pro",
    description: "Advanced growth tools, AI assistant, and deeper automation.",
    pricePaise: 99900,
    currency: "INR",
    durationMonths: 1,
    durationDays: 30,
    displayOrder: 2,
    features: [
      "Unlimited active members",
      "Attendance & automated check-out",
      "AI Gym Assistant with insights",
      "Payment receipts with custom branding",
      "Full revenue & retention analytics",
      "Priority WhatsApp support",
    ],
    maxStaff: 5,
    maxBranches: 2,
  },
  {
    code: "PREMIUM",
    slug: "premium",
    name: "Premium",
    description: "Full enterprise power with multi-branch management & VIP support.",
    pricePaise: 199900,
    currency: "INR",
    durationMonths: 1,
    durationDays: 30,
    displayOrder: 3,
    features: [
      "Unlimited members & branches",
      "Multi-location gym management",
      "AI Gym Assistant with predictive analytics",
      "White-labeled PDF receipts & invoices",
      "Custom role & staff permissions",
      "24/7 dedicated account manager",
      "Automated WhatsApp message dispatch",
      "Full CSV & accounting data export",
    ],
    maxStaff: 20,
    maxBranches: 5,
  },
  // Legacy duration-based tiers kept for seamless backwards compatibility
  {
    code: "MONTHLY",
    slug: "monthly",
    name: "Monthly",
    description: "Standard full access for one month.",
    pricePaise: 49900,
    currency: "INR",
    durationMonths: 1,
    durationDays: 30,
    displayOrder: 4,
    features: ["Unlimited members", "Attendance tracking", "Payments & expenses", "Reports dashboard"],
    maxStaff: 2,
    maxBranches: 1,
  },
  {
    code: "QUARTERLY",
    slug: "quarterly",
    name: "Quarterly",
    description: "Three months of full access with discount.",
    pricePaise: 139900,
    currency: "INR",
    durationMonths: 3,
    durationDays: 90,
    displayOrder: 5,
    features: ["Unlimited members", "Attendance tracking", "Payments & expenses", "Reports dashboard", "Priority support"],
    maxStaff: 5,
    maxBranches: 1,
  },
  {
    code: "ANNUAL",
    slug: "annual",
    name: "Annual",
    description: "Twelve months of full access — maximum savings.",
    pricePaise: 469900,
    currency: "INR",
    durationMonths: 12,
    durationDays: 365,
    displayOrder: 6,
    features: ["Unlimited members", "Attendance tracking", "Payments & expenses", "Reports dashboard", "Dedicated support", "Data export", "Custom branding"],
    maxStaff: 25,
    maxBranches: 5,
  },
];

async function main() {
  console.log(`[seed] Seeding subscription plans and settings (Default Trial: ${DEFAULT_TRIAL_DAYS} days)...`);

  for (const plan of DEFAULT_PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: { ...plan, isActive: true },
      update: {
        name: plan.name,
        slug: plan.slug,
        description: plan.description,
        pricePaise: plan.pricePaise,
        currency: plan.currency,
        durationMonths: plan.durationMonths,
        durationDays: plan.durationDays,
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
      trialDurationDays: DEFAULT_TRIAL_DAYS,
      trialPricePaise: 0,
      trialRequiresPaymentMethod: false,
      cancellationPolicy: "END_OF_PERIOD",
      reminderDaysBefore: 3,
      gracePeriodDays: 3,
    },
    update: {
      // Keep existing settings if already modified, but ensure trial duration default exists
    },
  });

  const count = await prisma.subscriptionPlan.count();
  console.log(`[seed] Seed complete: ${count} SaaS plan(s) ready in database. Default trial: ${DEFAULT_TRIAL_DAYS} days.`);
}

main()
  .catch((e) => {
    console.error("[seed] Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
