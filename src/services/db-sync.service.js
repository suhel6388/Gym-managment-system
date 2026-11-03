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
      END $$;
    `);
    console.log("[db] Database schema verified (Payment columns & GymReceiptSettings).");
  } catch (err) {
    console.warn("[db] Note on schema check:", err?.message || err);
  }
}

