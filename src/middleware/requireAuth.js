import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

export async function requireAuth(req, res, next) {
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
        role: true,
        email: true,
        emailVerified: true,
      },
    });

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
    req.user = {
      id: user.id,
      gymId: user.gymId,
      role: user.role,
      email: user.email ?? session.user.email,
    };

    next();
  } catch (error) {
    next(error);
  }
}

