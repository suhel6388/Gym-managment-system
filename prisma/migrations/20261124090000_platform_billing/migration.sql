-- Platform (SaaS) billing: GST / discount pricing, price snapshots, structured
-- audits and per-payment webhook event tracking.
--
-- Purely additive. Existing plans, subscriptions, payments and admin screens
-- keep working: every new column has a default or is nullable.

-- ---------------------------------------------------------------------------
-- SubscriptionPlan: pricing inputs + lifecycle metadata
-- ---------------------------------------------------------------------------
ALTER TABLE "SubscriptionPlan"
  ADD COLUMN IF NOT EXISTS "slug" TEXT,
  ADD COLUMN IF NOT EXISTS "durationDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "gstPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "discountPaise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "createdBy" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedBy" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_slug_key"
  ON "SubscriptionPlan" ("slug");
CREATE INDEX IF NOT EXISTS "SubscriptionPlan_deletedAt_idx"
  ON "SubscriptionPlan" ("deletedAt");

-- ---------------------------------------------------------------------------
-- SubscriptionPayment: immutable snapshot + webhook idempotency trail
-- ---------------------------------------------------------------------------
ALTER TABLE "SubscriptionPayment"
  ADD COLUMN IF NOT EXISTS "amountBreakdown" JSONB,
  ADD COLUMN IF NOT EXISTS "planSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "couponCode" TEXT,
  ADD COLUMN IF NOT EXISTS "processedEventIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'SUBSCRIPTION';

CREATE INDEX IF NOT EXISTS "SubscriptionPayment_status_createdAt_idx"
  ON "SubscriptionPayment" ("status", "createdAt");

-- ---------------------------------------------------------------------------
-- SubscriptionSetting: configurable post-expiry grace window
-- ---------------------------------------------------------------------------
ALTER TABLE "SubscriptionSetting"
  ADD COLUMN IF NOT EXISTS "gracePeriodDays" INTEGER NOT NULL DEFAULT 3;

-- ---------------------------------------------------------------------------
-- SubscriptionAuditLog: explicit old/new values for price/plan changes
-- ---------------------------------------------------------------------------
ALTER TABLE "SubscriptionAuditLog"
  ADD COLUMN IF NOT EXISTS "oldValues" JSONB,
  ADD COLUMN IF NOT EXISTS "newValues" JSONB;

CREATE INDEX IF NOT EXISTS "SubscriptionAuditLog_planId_createdAt_idx"
  ON "SubscriptionAuditLog" ("planId", "createdAt");
