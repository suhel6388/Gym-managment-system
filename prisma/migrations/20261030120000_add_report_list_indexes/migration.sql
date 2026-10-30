-- Speed up the members list / reports join-date feed, which filter on
-- gymId + archivedAt and order by joinedAt.
CREATE INDEX IF NOT EXISTS "Member_gymId_archivedAt_joinedAt_idx"
  ON "Member"("gymId", "archivedAt", "joinedAt");

-- Speed up the memberships list, which filters on gymId and orders by endDate
-- when no status filter is supplied.
CREATE INDEX IF NOT EXISTS "Membership_gymId_endDate_idx"
  ON "Membership"("gymId", "endDate");
