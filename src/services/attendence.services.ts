import {
  AttendanceMarkingMethod,
  Prisma,
} from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

type CheckInInput = {
  gymId: string;
  memberId: string;
  attendanceDate: Date;
  notes?: string;
  markingMethod: AttendanceMarkingMethod;
};

type CheckOutInput = {
  gymId: string;
  memberId: string;
  notes?: string;
};

const openSessionFilter = (gymId: string, memberId: string) => ({
  gymId,
  memberId,
  checkOutAt: null,
});

async function requireGymMember(gymId: string, memberId: string) {
  const member = await prisma.member.findFirst({
    where: { id: memberId, gymId, archivedAt: null },
    select: { id: true },
  });

  if (!member) {
    throw new HttpError(404, "Member not found in your gym");
  }

  return member;
}

function toConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    ["P2002", "P2034"].includes(error.code)
  ) {
    throw new HttpError(409, "Conflicting attendance operation. Please retry.");
  }

  throw error;
}

export class AttendanceService {
  static searchMembers(gymId: string, query: string, take = 20) {
    const q = query.trim();

    return prisma.member.findMany({
      where: {
        gymId,
        archivedAt: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { phone: { contains: q } },
          { memberCode: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        memberCode: true,
        name: true,
        phone: true,
      },
      orderBy: { name: "asc" },
      take,
    });
  }

  static async checkIn(input: CheckInInput) {
    const { gymId, memberId, attendanceDate, notes, markingMethod } = input;

    await requireGymMember(gymId, memberId);

    try {
      return await prisma.$transaction(
        async (tx) => {
          const open = await tx.attendance.findFirst({
            where: openSessionFilter(gymId, memberId),
            select: { id: true },
          });

          if (open) {
            throw new HttpError(409, "Member is already checked in");
          }

          return tx.attendance.create({
            data: {
              gymId,
              memberId,
              attendanceDate,
              checkInAt: new Date(),
              checkInNotes: notes?.trim() || null,
              markingMethod,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      toConflict(error);
    }
  }

  static async checkOut(input: CheckOutInput) {
    const { gymId, memberId, notes } = input;

    await requireGymMember(gymId, memberId);

    return prisma.$transaction(async (tx) => {
      const open = await tx.attendance.findFirst({
        where: openSessionFilter(gymId, memberId),
        orderBy: { checkInAt: "desc" },
        select: { id: true },
      });

      if (!open) {
        throw new HttpError(409, "No open check-in session found");
      }

      const updated = await tx.attendance.updateMany({
        where: { id: open.id, gymId, checkOutAt: null },
        data: {
          checkOutAt: new Date(),
          checkOutNotes: notes?.trim() || null,
        },
      });

      if (updated.count !== 1) {
        throw new HttpError(409, "Attendance session has already been closed");
      }

      return tx.attendance.findUniqueOrThrow({ where: { id: open.id } });
    });
  }

  static getOpenSession(gymId: string, memberId: string) {
    return prisma.attendance.findFirst({
      where: openSessionFilter(gymId, memberId),
      orderBy: { checkInAt: "desc" },
    });
  }

  static async getMemberHistory(
    gymId: string,
    memberId: string,
    page = 1,
    limit = 20,
  ) {
    await requireGymMember(gymId, memberId);

    const safePage = Math.max(1, Math.floor(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit) || 20));
    const where: Prisma.AttendanceWhereInput = { gymId, memberId };

    const [data, total] = await prisma.$transaction([
      prisma.attendance.findMany({
        where,
        orderBy: { checkInAt: "desc" },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      prisma.attendance.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  static async getTodaySummary(gymId: string, now = new Date()) {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const where: Prisma.AttendanceWhereInput = {
      gymId,
      attendanceDate: { gte: start, lt: end },
    };

    const [totalCheckIns, currentlyCheckedIn, completedSessions] =
      await Promise.all([
        prisma.attendance.count({ where }),
        prisma.attendance.count({ where: { ...where, checkOutAt: null } }),
        prisma.attendance.count({
          where: { ...where, checkOutAt: { not: null } },
        }),
      ]);

    return { totalCheckIns, currentlyCheckedIn, completedSessions };
  }
}
