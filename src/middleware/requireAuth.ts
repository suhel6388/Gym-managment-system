
import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth";
import { prisma } from "../lib/prisma";

export interface AuthRequest extends Request {
  authUserId?: string;
  gymId?: string;
}

export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user?.id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        gymId: true,
        emailVerified: true,
      },
    });

    // Only verified accounts may reach gym data (attendance included).
    const emailVerified = user?.emailVerified ?? session.user.emailVerified;
    if (!emailVerified) {
      return res.status(403).json({
        success: false,
        code: "EMAIL_NOT_VERIFIED",
        message: "Email not verified. Verify your email to continue.",
        email: session.user.email,
      });
    }

    if (!user?.gymId) {
      return res.status(403).json({
        success: false,
        message: "No gym is associated with this account",
      });
    }

    req.authUserId = user.id;
    req.gymId = user.gymId;

    next();
  } catch (error) {
    next(error);
  }
}
