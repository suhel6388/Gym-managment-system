import type { Response, NextFunction } from "express";
import { z } from "zod";
import { AttendanceMarkingMethod } from "../../generated/prisma/client";
import type { AuthRequest } from "../middleware/requireAuth";
import {
  AttendanceService,
  HttpError,
} from "../services/attendence.services";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const notesSchema = z.string().trim().max(500).optional();

const memberIdParam = z.object({
  memberId: z.string().trim().min(1, "memberId is required"),
});

const searchQuery = z.object({
  q: z.string().trim().default(""),
});

const attendanceDateSchema = z
  .string()
  .regex(DATE_RE, "attendanceDate must use YYYY-MM-DD")
  .transform((value, ctx) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    const valid =
      !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 10) === value;

    if (!valid) {
      ctx.addIssue({
        code: "custom",
        message: "attendanceDate must be a valid calendar date",
      });
      return z.NEVER;
    }

    return date;
  });

const checkInBody = z.object({
  memberId: z.string().trim().min(1, "Valid memberId is required"),
  attendanceDate: attendanceDateSchema,
  notes: notesSchema,
  markingMethod: z.nativeEnum(AttendanceMarkingMethod).default("MANUAL"),
});

const checkOutBody = z.object({
  memberId: z.string().trim().min(1, "Valid memberId is required"),
  notes: notesSchema,
});

const historyQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function requireGymId(req: AuthRequest): string {
  if (!req.gymId) {
    throw new HttpError(403, "Authenticated gym is missing");
  }
  return req.gymId;
}

export class AttendanceController {
  static async searchMembers(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { q } = searchQuery.parse(req.query);

      if (q.length < 2) {
        return res.json({ data: [] });
      }

      const data = await AttendanceService.searchMembers(requireGymId(req), q);

      return res.json({ data });
    } catch (error) {
      return next(error);
    }
  }

  static async checkIn(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const input = checkInBody.parse(req.body ?? {});

      const data = await AttendanceService.checkIn({
        gymId: requireGymId(req),
        ...input,
      });

      return res
        .status(201)
        .json({ data, message: "Member checked in successfully" });
    } catch (error) {
      return next(error);
    }
  }

  static async checkOut(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const input = checkOutBody.parse(req.body ?? {});

      const data = await AttendanceService.checkOut({
        gymId: requireGymId(req),
        ...input,
      });

      return res.json({ data, message: "Member checked out successfully" });
    } catch (error) {
      return next(error);
    }
  }

  static async getOpenSession(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { memberId } = memberIdParam.parse(req.params);
      const data = await AttendanceService.getOpenSession(
        requireGymId(req),
        memberId,
      );

      return res.json({ data });
    } catch (error) {
      return next(error);
    }
  }

  static async getMemberHistory(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const { memberId } = memberIdParam.parse(req.params);
      const { page, limit } = historyQuery.parse(req.query);

      const result = await AttendanceService.getMemberHistory(
        requireGymId(req),
        memberId,
        page,
        limit,
      );

      return res.json(result);
    } catch (error) {
      return next(error);
    }
  }

  static async getTodaySummary(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const data = await AttendanceService.getTodaySummary(requireGymId(req));

      return res.json({ data });
    } catch (error) {
      return next(error);
    }
  }
}
