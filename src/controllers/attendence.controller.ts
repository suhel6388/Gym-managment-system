
import type { Response, NextFunction } from "express";
import {
  AttendanceMarkingMethod,
} from "../../generated/prisma/client";
import type { AuthRequest } from "../middleware/requireAuth";
import { AttendanceService } from "../services/attendance.service";

function fail(
  res: Response,
  error: unknown,
  next: NextFunction
) {
  const err = error as Error & { statusCode?: number };

  if (err.statusCode) {
    return res.status(err.statusCode).json({
      success: false,
      message: err.message,
    });
  }

  next(error);
}

function validNotes(notes: unknown): notes is string | undefined {
  return (
    notes === undefined ||
    (typeof notes === "string" && notes.length <= 500)
  );
}

function parseDate(value: unknown): Date | null {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) return null;

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}

function gymId(req: AuthRequest): string {
  if (!req.gymId) throw new Error("Authenticated gym is missing");
  return req.gymId;
}

export class AttendanceController {
  static async searchMembers(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const q = String(req.query.q ?? "").trim();

      if (q.length < 2) {
        return res.json({ success: true, data: [] });
      }

      const data = await AttendanceService.searchMembers(gymId(req), q);

      return res.json({
        success: true,
        data: data.map((member) => ({
          ...member,
          memberId: member.id,
        })),
      });
    } catch (error) {
      return fail(res, error, next);
    }
  }

  static async checkIn(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { memberId, attendanceDate, notes, markingMethod } =
        req.body ?? {};

      if (
        typeof memberId !== "string" ||
        !memberId.trim() ||
        !validNotes(notes)
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid memberId and notes are required",
        });
      }

      const date = parseDate(attendanceDate);

      if (!date) {
        return res.status(400).json({
          success: false,
          message: "attendanceDate must use YYYY-MM-DD",
        });
      }

      const method = markingMethod ?? "MANUAL";

      if (
        typeof method !== "string" ||
        !Object.values(AttendanceMarkingMethod).includes(
          method as AttendanceMarkingMethod
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid marking method",
        });
      }

      const data = await AttendanceService.checkIn({
        gymId: gymId(req),
        memberId,
        attendanceDate: date,
        notes,
        markingMethod: method as AttendanceMarkingMethod,
      });

      return res.status(201).json({
        success: true,
        message: "Member checked in successfully",
        data,
      });
    } catch (error) {
      return fail(res, error, next);
    }
  }

  static async checkOut(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const { memberId, notes } = req.body ?? {};

      if (
        typeof memberId !== "string" ||
        !memberId.trim() ||
        !validNotes(notes)
      ) {
        return res.status(400).json({
          success: false,
          message: "Valid memberId and notes are required",
        });
      }

      const data = await AttendanceService.checkOut({
        gymId: gymId(req),
        memberId,
        notes,
      });

      return res.json({
        success: true,
        message: "Member checked out successfully",
        data,
      });
    } catch (error) {
      return fail(res, error, next);
    }
  }

  static async getOpenSession(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const data = await AttendanceService.getOpenSession(
        gymId(req),
        String(req.params.memberId)
      );

      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, next);
    }
  }

  static async getMemberHistory(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(
        100,
        Math.max(1, Number(req.query.limit) || 20)
      );

      const data = await AttendanceService.getMemberHistory(
        gymId(req),
        String(req.params.memberId),
        page,
        limit
      );

      return res.json({ success: true, ...data });
    } catch (error) {
      return fail(res, error, next);
    }
  }

  static async getTodaySummary(
    req: AuthRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const data = await AttendanceService.getTodaySummary(gymId(req));

      return res.json({ success: true, data });
    } catch (error) {
      return fail(res, error, next);
    }
  }
}
