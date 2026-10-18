/*
  Warnings:

  - You are about to drop the column `amountPaise` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `paymentMode` on the `Expense` table. All the data in the column will be lost.
  - You are about to drop the column `amountPaise` on the `PaymentAllocation` table. All the data in the column will be lost.
  - You are about to drop the column `amountPaise` on the `SubscriptionPayment` table. All the data in the column will be lost.
  - Added the required column `amount` to the `Expense` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amount` to the `PaymentAllocation` table without a default value. This is not possible if the table is not empty.
  - Added the required column `amount` to the `SubscriptionPayment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Expense" DROP COLUMN "amountPaise",
DROP COLUMN "paymentMode",
ADD COLUMN     "amount" DOUBLE PRECISION NOT NULL;

-- AlterTable
ALTER TABLE "PaymentAllocation" DROP COLUMN "amountPaise",
ADD COLUMN     "amount" DOUBLE PRECISION NOT NULL;

-- AlterTable
ALTER TABLE "SubscriptionPayment" DROP COLUMN "amountPaise",
ADD COLUMN     "amount" DOUBLE PRECISION NOT NULL;
