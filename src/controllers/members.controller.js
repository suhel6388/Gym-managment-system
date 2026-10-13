import { prisma } from "../db.js";
import { memberInput } from "../utils/validation.js";

function parseDate(value, { endOfDay = false } = {}) {
  if (!value) return undefined;
  const str = String(value);
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null; // invalid
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(str)) d.setUTCHours(23, 59, 59, 999);
  return d;
}

function handlePrismaError(err, res, next) {
  if (err?.code === "P2002") {
    return res.status(409).json({ error: "A member with this member code already exists" });
  }
  return next(err);
}

/**
 * Generates a member code that is unique within the gym, e.g. `MEM-0001`.
 * Falls back to a timestamp-based code if the sequential space is exhausted.
 */
async function generateMemberCode(gymId) {
  const count = await prisma.member.count({ where: { gymId } });
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = `MEM-${String(count + 1 + attempt).padStart(4, "0")}`;
    const exists = await prisma.member.findUnique({
      where: { gymId_memberCode: { gymId, memberCode: code } },
      select: { id: true }
    });
    if (!exists) return code;
  }
  return `MEM-${Date.now().toString(36).toUpperCase()}`;
}

export async function listMembers(req, res, next) {
  try {
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to, { endOfDay: true });
    if (from === null || to === null) {
      return res.status(400).json({ error: "Invalid 'from' or 'to' date" });
    }

    const search = req.query.search ? String(req.query.search).trim() : "";
    const includeArchived = req.query.includeArchived === "true";

    const data = await prisma.member.findMany({
      where: {
        gymId: req.user.gymId,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(from || to
          ? { joinedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { phone: { contains: search } },
                { email: { contains: search, mode: "insensitive" } },
                { memberCode: { contains: search, mode: "insensitive" } }
              ]
            }
          : {})
      },
      include: {
        // Latest membership drives the plan + status columns in the UI.
        memberships: {
          orderBy: { endDate: "desc" },
          take: 1,
          include: { plan: true }
        }
      },
      orderBy: { joinedAt: "desc" },
      take: 500
    });
    res.json({ data });
  } catch (err) { next(err); }
}

export async function createMember(req, res, next) {
  try {
    const input = memberInput.parse(req.body);
    const memberCode = input.memberCode || (await generateMemberCode(req.user.gymId));
    const data = await prisma.member.create({
      data: { ...input, memberCode, gymId: req.user.gymId }
    });
    res.status(201).json({ data });
  } catch (err) { handlePrismaError(err, res, next); }
}

export async function updateMember(req, res, next) {
  try {
    const input = memberInput.partial().parse(req.body);
    const found = await prisma.member.findFirst({
      where: { id: req.params.id, gymId: req.user.gymId }
    });
    if (!found) return res.status(404).json({ error: "Member not found" });

    const data = await prisma.member.update({ where: { id: found.id }, data: input });
    res.json({ data });
  } catch (err) { handlePrismaError(err, res, next); }
}

// Soft delete: keeps memberships/payments history intact
export async function deleteMember(req, res, next) {
  try {
    const result = await prisma.member.updateMany({
      where: { id: req.params.id, gymId: req.user.gymId, archivedAt: null },
      data: { archivedAt: new Date() }
    });
    if (!result.count) return res.status(404).json({ error: "Member not found" });
    res.json({ message: "Member archived" });
  } catch (err) { next(err); }
}
