import { prisma } from "../db.js";

/**
 * Non-destructive, idempotent verification of receipt columns and tables.
 * Runs once on server startup so the PostgreSQL database automatically has
 * the required columns even if manual migrations were skipped.
 */
export async function ensureDatabaseSchema() {
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        BEGIN
          ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "membershipId" TEXT;
          ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
          ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "receiptData" JSONB;
          ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "receiptIssuedAt" TIMESTAMP(3);
        EXCEPTION
          WHEN OTHERS THEN NULL;
        END;

        BEGIN
          CREATE TABLE IF NOT EXISTS "GymReceiptSettings" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "gymId" TEXT NOT NULL UNIQUE,
            "gymName" TEXT,
            "tagline" TEXT,
            "address" TEXT,
            "phone" TEXT,
            "email" TEXT,
            "website" TEXT,
            "footerMessage" TEXT,
            "authorizedSignatory" TEXT,
            "signatureDataUrl" TEXT,
            "logoDataUrl" TEXT,
            "qrEnabled" BOOLEAN NOT NULL DEFAULT true,
            "receiptPrefix" TEXT NOT NULL DEFAULT 'RCPT',
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        EXCEPTION
          WHEN OTHERS THEN NULL;
        END;

        -- Platform (SaaS) billing columns. Additive and idempotent so a
        -- deployment that skipped `prisma migrate deploy` still works.
        BEGIN
          ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "slug" TEXT;
          ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "durationDays" INTEGER;
          ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "gstPercent" INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "discountPaise" INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
          ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "createdBy" TEXT;
          ALTER TABLE "SubscriptionPlan" ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_slug_key" ON "SubscriptionPlan" ("slug");
          CREATE INDEX IF NOT EXISTS "SubscriptionPlan_deletedAt_idx" ON "SubscriptionPlan" ("deletedAt");
        EXCEPTION
          WHEN OTHERS THEN NULL;
        END;

        BEGIN
          ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "amountBreakdown" JSONB;
          ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "planSnapshot" JSONB;
          ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "couponCode" TEXT;
          ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "processedEventIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
          ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'SUBSCRIPTION';
          CREATE INDEX IF NOT EXISTS "SubscriptionPayment_status_createdAt_idx" ON "SubscriptionPayment" ("status", "createdAt");
        EXCEPTION
          WHEN OTHERS THEN NULL;
        END;

        BEGIN
          ALTER TABLE "SubscriptionSetting" ADD COLUMN IF NOT EXISTS "gracePeriodDays" INTEGER NOT NULL DEFAULT 3;
          ALTER TABLE "SubscriptionAuditLog" ADD COLUMN IF NOT EXISTS "oldValues" JSONB;
          ALTER TABLE "SubscriptionAuditLog" ADD COLUMN IF NOT EXISTS "newValues" JSONB;
          CREATE INDEX IF NOT EXISTS "SubscriptionAuditLog_planId_createdAt_idx" ON "SubscriptionAuditLog" ("planId", "createdAt");
        EXCEPTION
          WHEN OTHERS THEN NULL;
        END;
      END $$;
    `);
    console.log("[db] Database schema verified (Payment columns, receipts & platform billing).");
  } catch (err) {
    console.warn("[db] Note on schema check:", err?.message || err);
  }
}

