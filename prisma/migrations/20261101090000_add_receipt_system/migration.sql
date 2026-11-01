-- Membership payment receipts: per-gym branding + immutable receipt snapshots.
--
-- Payment.membershipId links a payment to the membership it settles so a
-- receipt covers one payment, never the member's whole history. The
-- (gymId, idempotencyKey) unique index is what makes a retried submission
-- return the original payment instead of duplicating it; PostgreSQL allows
-- multiple NULL keys for legacy callers.

ALTER TABLE "Payment"
  ADD COLUMN "membershipId" TEXT,
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "receiptData" JSONB,
  ADD COLUMN "receiptIssuedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_gymId_idempotencyKey_key"
  ON "Payment"("gymId", "idempotencyKey");

CREATE INDEX "Payment_membershipId_status_idx"
  ON "Payment"("membershipId", "status");

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "GymReceiptSettings" (
  "id" TEXT NOT NULL,
  "gymId" TEXT NOT NULL,
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
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GymReceiptSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GymReceiptSettings_gymId_key"
  ON "GymReceiptSettings"("gymId");

ALTER TABLE "GymReceiptSettings"
  ADD CONSTRAINT "GymReceiptSettings_gymId_fkey"
  FOREIGN KEY ("gymId") REFERENCES "Gym"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
