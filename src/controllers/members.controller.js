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
 * Turn a Zod failure into a 400 that names the offending field. The client
 * shows `error` directly, so "Member name is required" is more useful than the
 * generic "Validation failed" the shared error handler would produce.
 */
function handleMemberError(err, res, next) {
  if (err?.name === "ZodError") {
    const first = err.issues?.[0];
    return res.status(400).json({
      error: first?.message ?? "Validation failed",
      field: typeof first?.path?.[0] === "string" ? first.path[0] : null,
      details: (err.issues ?? []).map((issue) => ({
        field: typeof issue.path?.[0] === "string" ? issue.path[0] : null,
        message: issue.message,
      })),
    });
  }
  return handlePrismaError(err, res, next);
}

/** Number of code collisions tolerated before surfacing the conflict. */
const AUTO_CODE_ATTEMPTS = 5;

/**
 * Builds the next sequential member code, e.g. `MEM-0001`.
 *
 * The `(gymId, memberCode)` unique constraint is the real guard: two requests
 * that read the same count at the same moment will both try the same code and
 * one will get P2002. `createMember` retries that collision with a fresh
 * count, which is cheaper than pre-checking every candidate before inserting.
 */
async function nextMemberCode(gymId) {
  const count = await prisma.member.count({ where: { gymId } });
  return `MEM-${String(count + 1).padStart(4, "0")}`;
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
    const autoCode = !input.memberCode;
    let data;

    for (let attempt = 0; ; attempt += 1) {
      const memberCode = input.memberCode || (await nextMemberCode(req.user.gymId));
      try {
        data = await prisma.member.create({
          data: { ...input, memberCode, gymId: req.user.gymId }
        });
        break;
      } catch (err) {
        // Only an auto-generated code may be retried. A caller-supplied code
        // that collides is a real 409.
        if (autoCode && err?.code === "P2002" && attempt < AUTO_CODE_ATTEMPTS - 1) {
          continue;
        }
        throw err;
      }
    }

    res.status(201).json({ data });
  } catch (err) { handleMemberError(err, res, next); }
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
  } catch (err) { handleMemberError(err, res, next); }
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
