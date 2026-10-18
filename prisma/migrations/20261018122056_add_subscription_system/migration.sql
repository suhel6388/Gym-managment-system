-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'PAST_DUE');

-- CreateEnum
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "TrialRecordType" AS ENUM ('INITIAL', 'EXTENSION');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pricePaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "durationMonths" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "features" TEXT[],
    "maxStaff" INTEGER,
    "maxBranches" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymSubscription" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "planId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "planNameSnapshot" TEXT,
    "pricePaise" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "trialStartsAt" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "paymentProvider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "planId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "orderId" TEXT,
    "paymentId" TEXT,
    "signature" TEXT,
    "failureReason" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialRecord" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "type" "TrialRecordType" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "grantedById" TEXT,
    "grantedByRole" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SELF_SERVICE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrialRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionSetting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "trialEnabled" BOOLEAN NOT NULL DEFAULT true,
    "trialDurationDays" INTEGER NOT NULL DEFAULT 14,
    "trialPricePaise" INTEGER NOT NULL DEFAULT 0,
    "trialRequiresPaymentMethod" BOOLEAN NOT NULL DEFAULT false,
    "cancellationPolicy" TEXT NOT NULL DEFAULT 'END_OF_PERIOD',
    "reminderDaysBefore" INTEGER NOT NULL DEFAULT 3,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionAuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "gymId" TEXT,
    "planId" TEXT,
    "subscriptionId" TEXT,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "reason" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_code_key" ON "SubscriptionPlan"("code");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_isActive_displayOrder_idx" ON "SubscriptionPlan"("isActive", "displayOrder");

-- CreateIndex
CREATE UNIQUE INDEX "GymSubscription_gymId_key" ON "GymSubscription"("gymId");

-- CreateIndex
CREATE INDEX "GymSubscription_status_currentPeriodEnd_idx" ON "GymSubscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "GymSubscription_trialEndsAt_idx" ON "GymSubscription"("trialEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_orderId_key" ON "SubscriptionPayment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPayment_paymentId_key" ON "SubscriptionPayment"("paymentId");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_gymId_createdAt_idx" ON "SubscriptionPayment"("gymId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionPayment_subscriptionId_status_idx" ON "SubscriptionPayment"("subscriptionId", "status");

-- CreateIndex
CREATE INDEX "TrialRecord_gymId_createdAt_idx" ON "TrialRecord"("gymId", "createdAt");

-- CreateIndex
CREATE INDEX "TrialRecord_type_createdAt_idx" ON "TrialRecord"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionAuditLog_gymId_createdAt_idx" ON "SubscriptionAuditLog"("gymId", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionAuditLog_action_createdAt_idx" ON "SubscriptionAuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "GymSubscription" ADD CONSTRAINT "GymSubscription_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymSubscription" ADD CONSTRAINT "GymSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "GymSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrialRecord" ADD CONSTRAINT "TrialRecord_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionAuditLog" ADD CONSTRAINT "SubscriptionAuditLog_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE SET NULL ON UPDATE CASCADE;
