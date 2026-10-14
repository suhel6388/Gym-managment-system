
import {
  AttendanceMarkingMethod,
  Prisma,
} from "../../generated/prisma/client";
import { prisma } from "../lib/prisma";

export class AttendanceService {
  static async searchMembers(gymId: string, q: string) {
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
      take: 20,
      orderBy: { name: "asc" },
    });
  }

  static async checkIn(input: {
    gymId: string;
    memberId: string;
    attendanceDate: Date;
    notes?: string;
    markingMethod: AttendanceMarkingMethod;
  }) {
    const {
      gymId,
      memberId,
      attendanceDate,
      notes,
      markingMethod,
    } = input;

    const member = await prisma.member.findFirst({
      where: { id: memberId, gymId, archivedAt: null },
      select: { id: true },
    });

    if (!member) {
      throw Object.assign(new Error("Member not found in your gym"), {
        statusCode: 404,
      });
    }

    try {
      return await prisma.$transaction(
        async (tx) => {
          const open = await tx.attendance.findFirst({
            where: { gymId, memberId, checkOutAt: null },
            select: { id: true },
          });

          if (open) {
            throw Object.assign(new Error("Member is already checked in"), {
              statusCode: 409,
            });
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
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable,
        }
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2002", "P2034"].includes(error.code)
      ) {
        throw Object.assign(
          new Error("Conflicting attendance operation. Please retry."),
          { statusCode: 409 }
        );
      }

      throw error;
    }
  }

  static async checkOut(input: {
    gymId: string;
    memberId: string;
    notes?: string;
  }) {
    const { gymId, memberId, notes } = input;

    const member = await prisma.member.findFirst({
      where: { id: memberId, gymId, archivedAt: null },
      select: { id: true },
    });

    if (!member) {
      throw Object.assign(new Error("Member not found in your gym"), {
        statusCode: 404,
      });
    }

    const open = await prisma.attendance.findFirst({
      where: { gymId, memberId, checkOutAt: null },
      orderBy: { checkInAt: "desc" },
      select: { id: true },
    });

    if (!open) {
      throw Object.assign(new Error("No open check-in session found"), {
        statusCode: 409,
      });
    }

    const updated = await prisma.attendance.updateMany({
      where: {
        id: open.id,
        gymId,
        checkOutAt: null,
      },
      data: {
        checkOutAt: new Date(),
        checkOutNotes: notes?.trim() || null,
      },
    });

    if (updated.count !== 1) {
      throw Object.assign(
        new Error("Attendance session has already been closed"),
        { statusCode: 409 }
      );
    }

    return prisma.attendance.findFirst({
      where: { id: open.id, gymId },
    });
  }

  static async getOpenSession(gymId: string, memberId: string) {
    return prisma.attendance.findFirst({
      where: { gymId, memberId, checkOutAt: null },
      orderBy: { checkInAt: "desc" },
    });
  }

  static async getMemberHistory(
    gymId: string,
    memberId: string,
    page: number,
    limit: number
  ) {
    const where = { gymId, memberId };

    const [data, total] = await prisma.$transaction([
      prisma.attendance.findMany({
        where,
        orderBy: { checkInAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.attendance.count({ where }),
    ]);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getTodaySummary(gymId: string) {
    // UTC boundaries; adapt these to the gym's timezone in production.
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const where = {
      gymId,
      attendanceDate: { gte: start, lt: end },
    };

    const [totalCheckIns, currentlyCheckedIn, completedSessions] =
      await Promise.all([
        prisma.attendance.count({ where }),
        prisma.attendance.count({
          where: { ...where, checkOutAt: null },
        }),
        prisma.attendance.count({
          where: { ...where, checkOutAt: { not: null } },
        }),
      ]);

    return {
      totalCheckIns,
      currentlyCheckedIn,
      completedSessions,
    };
  }
}
