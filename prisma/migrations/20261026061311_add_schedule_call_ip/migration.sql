/*
  Warnings:

  - Added the required column `ipAddress` to the `ScheduleCall` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "ScheduleCall" ADD COLUMN     "ipAddress" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "ScheduleCall_ipAddress_createdAt_idx" ON "ScheduleCall"("ipAddress", "createdAt");
