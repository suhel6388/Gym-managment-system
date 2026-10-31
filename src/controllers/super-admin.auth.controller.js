// Platform-owner login, additive to the existing /api/v1/auth/login.
//
// Differences from the normal login:
//   - only database rows with role = SUPER_ADMIN can obtain a session here;
//     gym owners/staff get the same generic 401, and no session is created;
//   - it never sends an OTP. Platform accounts are created already verified,
//     so SMTP (blocked on Render's free tier) is never on the critical path.
//
// Credentials live in the existing User + Account tables and the password is
// verified by Better Auth, exactly like the normal login.

import { z } from "zod";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.ts";
import { prisma } from "../db.js";
import { forwardCookies } from "./auth.controller.js";

const INVALID = {
  error: "Invalid email or password",
  code: "INVALID_CREDENTIALS",
};

export const superAdminLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
});

export async function superAdminLogin(req, res, next) {
  try {
    const input = superAdminLoginSchema.parse(req.body ?? {});

    // Check the role BEFORE handing the credentials to Better Auth: a gym
    // user posting here must not receive a session through this route, and
    // unknown emails return the same generic error (no account enumeration).
    const account = await prisma.user.findUnique({
      where: { email: input.email },
      select: { role: true },
    });
    if (!account || account.role !== "SUPER_ADMIN") {
      return res.status(401).json(INVALID);
    }

    const response = await auth.api.signInEmail({
      body: {
        email: input.email,
        password: input.password,
        rememberMe: input.rememberMe ?? true,
      },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });

    if (response.status === 401) {
      return res.status(401).json(INVALID);
    }
    if (response.status === 403) {
      // Deliberately no OTP is generated or sent here.
      return res.status(403).json({
        error:
          "This platform account is not verified. Sign in from the account that created it.",
        code: "EMAIL_NOT_VERIFIED",
      });
    }
    if (response.status >= 400) {
      const body = await response.json().catch(() => null);
      return res.status(response.status).json({
        error: body?.message ?? "Sign-in failed",
        ...(body?.code ? { code: body.code } : {}),
      });
    }

    forwardCookies(response, res);
    const body = await response.json().catch(() => null);
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        gymId: true,
      },
    });

    // Body mirrors the normal login (Better Auth payload) plus the role and
    // the console path, so a client can redirect without a second call.
    return res.json({
      ...(body ?? {}),
      user,
      redirect: "/super-admin",
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      const first = err?.issues?.[0];
      return res.status(400).json({
        error: first?.message ?? "Validation failed",
        code: "VALIDATION_FAILED",
      });
    }
    if (err?.statusCode) {
      return res.status(err.statusCode).json({ error: err.message, code: err.code });
    }
    next(err);
  }
}
