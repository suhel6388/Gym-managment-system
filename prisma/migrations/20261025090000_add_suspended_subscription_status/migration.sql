-- AlterEnum
-- Platform admins can suspend a gym without deleting or resetting its billing
-- period. Keeping this as a real subscription status makes entitlement checks
-- and audit trails unambiguous.
ALTER TYPE "SubscriptionStatus" ADD VALUE 'SUSPENDED';
