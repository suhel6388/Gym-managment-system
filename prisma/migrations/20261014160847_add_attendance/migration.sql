-- CreateEnum
CREATE TYPE "AttendanceMarkingMethod" AS ENUM ('MANUAL', 'QR_CODE', 'BIOMETRIC');

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "gymId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkOutAt" TIMESTAMP(3),
    "checkInNotes" TEXT,
    "checkOutNotes" TEXT,
    "markingMethod" "AttendanceMarkingMethod" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attendance_gymId_attendanceDate_idx" ON "Attendance"("gymId", "attendanceDate");

-- CreateIndex
CREATE INDEX "Attendance_gymId_memberId_attendanceDate_idx" ON "Attendance"("gymId", "memberId", "attendanceDate");

-- CreateIndex
CREATE INDEX "Attendance_memberId_checkOutAt_idx" ON "Attendance"("memberId", "checkOutAt");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_gymId_fkey" FOREIGN KEY ("gymId") REFERENCES "Gym"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
