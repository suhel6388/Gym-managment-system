-- CreateTable
CREATE TABLE "ScheduleCall" (
    "id" SERIAL NOT NULL,
    "clientName" TEXT NOT NULL,
    "Mob" VARCHAR(13) NOT NULL,
    "callTime" TIMESTAMP(3) NOT NULL,
    "note" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleCall_pkey" PRIMARY KEY ("id")
);
