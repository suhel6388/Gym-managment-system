import { z } from "zod";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { prisma } from "../db.js";
import { startTrial } from "../services/subscription.service.js";

const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ""))
  .pipe(
    z
      .string()
      .min(10, "Mobile number must be 10-15 digits")
      .max(16, "Mobile number must be 10-15 digits")
      .regex(/^\+?\d{10,15}$/, "Invalid mobile number")
  );

const signupSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  phone: phoneSchema,
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, "Password is required"),
  rememberMe: z.boolean().optional(),
});

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const verifyOTPSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  otp: z.string().trim().regex(/^\d{6}$/, "OTP must be a 6-digit code"),
});

const googleSchema = z.object({
  callbackURL: z.string().url().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(1, "Reset token is required"),
  newPassword: z.string().min(8).max(128),
});

function trustedOrigins() {
  return (process.env.CLIENT_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function resolveCallbackURL(input) {
  const origins = trustedOrigins();
  if (!input) return origins[0];
  try {
    const target = new URL(input);
    const allowed = origins.some((origin) => {
      try {
        const o = new URL(origin);
        return o.origin === target.origin;
      } catch {
        return false;
      }
    });
    if (!allowed) return null;
    return input;
  } catch {
    return null;
  }
}

// Copy Set-Cookie headers from a Better Auth Response onto the Express res.
function forwardCookies(authResponse, res) {
  const getSetCookie =
    typeof authResponse.headers.getSetCookie === "function"
      ? authResponse.headers.getSetCookie()
      : null;
  const cookies = getSetCookie ??
    (authResponse.headers.get("set-cookie")
      ? [authResponse.headers.get("set-cookie")]
      : []);
  for (const cookie of cookies) {
    if (cookie) res.append("Set-Cookie", cookie);
  }
}

async function forwardAuthResponse(authResponse, res) {
  forwardCookies(authResponse, res);
  let body = null;
  try {
    body = await authResponse.json();
  } catch {
    body = null;
  }
  return res.status(authResponse.status).json(body ?? {});
}

function authErrorStatus(err) {
  return err?.statusCode ?? err?.status ?? 400;
}

function authErrorMessage(err) {
  return err?.body?.message ?? err?.message ?? "Authentication failed";
}

/**
 * Request a fresh email-verification OTP. Best effort: signup and login must
 * still redirect the user to the verify-email screen even if SMTP/rate limits
 * prevent the email from going out — that screen offers "Resend OTP".
 */
async function sendVerificationOtp(email, headers) {
  try {
    await auth.api.sendVerificationOTP({
      body: { email, type: "email-verification" },
      headers,
      asResponse: true,
    });
  } catch {
    // Ignore — the user can request another code from the verification screen.
  }
}

/**
 * Response for a signup whose email already exists but was never verified.
 * The account is not duplicated: a new OTP is sent and the client continues
 * the same verification flow.
 */
function unverifiedSignupResponse(res, email) {
  return res.status(200).json({
    code: "EMAIL_NOT_VERIFIED",
    message: "This email is already registered but not verified. A new 6-digit code was sent to your email.",
    email,
    requiresEmailVerification: true,
    user: null,
  });
}

// POST /api/v1/auth/signup
export async function signup(req, res, next) {
  try {
    const input = signupSchema.parse(req.body);

    // Pre-check: email already registered?
    // - verified account  -> real conflict; tell the user to sign in.
    // - unverified account -> resume verification: resend the OTP and redirect
    //   the client to the verify-email screen instead of blocking signup.
    const existingEmail = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true, emailVerified: true },
    });
    if (existingEmail) {
      if (!existingEmail.emailVerified) {
        await sendVerificationOtp(input.email, fromNodeHeaders(req.headers));
        return unverifiedSignupResponse(res, input.email);
      }
      return res.status(409).json({
        code: "EMAIL_ALREADY_REGISTERED",
        error: "An account with this email already exists",
      });
    }

    // Pre-check: mobile number already registered?
    const existingPhone = await prisma.user.findUnique({
      where: { phone: input.phone },
      select: { id: true },
    });
    if (existingPhone) {
      return res.status(409).json({ error: "An account with this mobile number already exists" });
    }

    const response = await auth.api.signUpEmail({
      body: { ...input, rememberMe: true },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    // Better Auth returns 422 when the email is taken — surface it as 409,
    // except for an unverified account, which resumes OTP verification.
    if (response.status === 422) {
      forwardCookies(response, res);
      const body = await response.clone().json().catch(() => null);
      const msg = JSON.stringify(body ?? "").toLowerCase();
      if (msg.includes("phone")) {
        return res.status(409).json({ error: "An account with this mobile number already exists" });
      }
      const existing = await prisma.user.findUnique({
        where: { email: input.email },
        select: { emailVerified: true },
      });
      if (existing && !existing.emailVerified) {
        await sendVerificationOtp(input.email, fromNodeHeaders(req.headers));
        return unverifiedSignupResponse(res, input.email);
      }
      return res.status(409).json({
        code: "EMAIL_ALREADY_REGISTERED",
        error: "An account with this email already exists",
      });
    }
    if (response.status >= 400) {
      return forwardAuthResponse(response, res);
    }
    forwardCookies(response, res);
    const body = await response.json().catch(() => null);
    return res.status(201).json({
      message: "Account created. Enter the 6-digit code sent to your email to verify.",
      user: body?.user ?? null,
    });
  } catch (err) {
    // Bad input — return 400 with the first validation message, no stack spam.
    if (err?.name === "ZodError") {
      const first = err?.issues?.[0];
      return res.status(400).json({ error: first?.message ?? "Validation failed" });
    }
    // Race: two signups at once hit the DB unique constraint.
    if (err?.code === "P2002") {
      const target = JSON.stringify(err?.meta?.target ?? "").toLowerCase();
      if (target.includes("phone")) {
        return res.status(409).json({ error: "An account with this mobile number already exists" });
      }
      const email = String(req.body?.email ?? "").trim().toLowerCase();
      const existing = email
        ? await prisma.user.findUnique({
            where: { email },
            select: { emailVerified: true },
          })
        : null;
      if (existing && !existing.emailVerified) {
        await sendVerificationOtp(email, fromNodeHeaders(req.headers));
        return unverifiedSignupResponse(res, email);
      }
      return res.status(409).json({
        code: "EMAIL_ALREADY_REGISTERED",
        error: "An account with this email already exists",
      });
    }
    if (err?.statusCode ?? err?.status) {
      return res.status(authErrorStatus(err)).json({ error: authErrorMessage(err) });
    }
    next(err);
  }
}

// POST /api/v1/auth/verify-email — { email, otp }
export async function verifyEmail(req, res, next) {
  try {
    const input = verifyOTPSchema.parse(req.body);
    const response = await auth.api.verifyEmailOTP({
      body: input,
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    if (response.status >= 400) {
      const body = await response.json().catch(() => null);
      const code = body?.code;
      const message =
        code === "OTP_EXPIRED"
          ? "Code expired. Request a new one."
          : code === "TOO_MANY_ATTEMPTS"
            ? "Too many attempts. Request a new code."
            : "Invalid code. Check the 6-digit code and try again.";
      return res.status(response.status).json({ error: message });
    }
    // autoSignInAfterVerification signs the user in — session cookie forwarded.
    return forwardAuthResponse(response, res);
  } catch (err) {
    if (err?.statusCode ?? err?.status) {
      return res.status(authErrorStatus(err)).json({ error: authErrorMessage(err) });
    }
    next(err);
  }
}

// POST /api/v1/auth/resend-otp — { email }
export async function resendOTP(req, res, next) {
  try {
    const input = emailSchema.parse(req.body);
    // Only unverified accounts need a new code. Unknown or already-verified
    // emails get the same neutral response without sending anything.
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: { emailVerified: true },
    });
    if (!user || user.emailVerified) {
      return res.json({ message: "If an account exists for this email, a new code was sent." });
    }
    const response = await auth.api.sendVerificationOTP({
      body: { email: input.email, type: "email-verification" },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    if (response.status >= 400) {
      return forwardAuthResponse(response, res);
    }
    return res.json({ message: "If an account exists for this email, a new code was sent." });
  } catch (err) {
    if (err?.statusCode ?? err?.status) {
      return res.status(authErrorStatus(err)).json({ error: authErrorMessage(err) });
    }
    next(err);
  }
}

// POST /api/v1/auth/google — { callbackURL? } -> { url } (redirect the browser there)
export async function googleSignIn(req, res, next) {
  try {
    const input = googleSchema.parse(req.body ?? {});
    const callbackURL = resolveCallbackURL(input.callbackURL);
    if (!callbackURL) {
      return res.status(400).json({ error: "callbackURL must belong to an allowed frontend origin" });
    }
    const response = await auth.api.signInSocial({
      body: { provider: "google", callbackURL },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    return forwardAuthResponse(response, res);
  } catch (err) {
    if (err?.statusCode ?? err?.status) {
      return res.status(authErrorStatus(err)).json({ error: authErrorMessage(err) });
    }
    next(err);
  }
}

// POST /api/v1/auth/login
export async function login(req, res, next) {
  try {
    const input = loginSchema.parse(req.body);
    const response = await auth.api.signInEmail({
      body: { ...input, rememberMe: input.rememberMe ?? true },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    if (response.status === 401) {
      forwardCookies(response, res);
      return res.status(401).json({ error: "Invalid email or password" });
    }
    if (response.status === 403) {
      // Email not verified — send a fresh OTP and let the client redirect to
      // the verify-email screen to finish signing in.
      await sendVerificationOtp(input.email, fromNodeHeaders(req.headers));
      forwardCookies(response, res);
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        error: "Email not verified. A new 6-digit code was sent to your email.",
      });
    }
    return forwardAuthResponse(response, res);
  } catch (err) {
    if (err?.statusCode ?? err?.status) {
      return res.status(authErrorStatus(err)).json({ error: authErrorMessage(err) });
    }
    next(err);
  }
}

// POST /api/v1/auth/forgot-password — { email }
// Always answers with the same neutral message so the endpoint cannot be used
// to enumerate accounts. The reset link is delivered by Better Auth's
// sendResetPassword hook (see src/lib/auth.ts).
export async function forgotPassword(req, res, next) {
  try {
    const input = forgotPasswordSchema.parse(req.body);
    await auth.api.requestPasswordReset({
      body: { email: input.email },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    return res.json({ message: "If an account exists for this email, a password reset link was sent." });
  } catch (err) {
    if (err?.name === "ZodError") {
      const first = err?.issues?.[0];
      return res.status(400).json({ error: first?.message ?? "Validation failed" });
    }
    // Never surface Better Auth's "user not found" style errors here.
    if (err?.statusCode ?? err?.status) {
      return res.json({ message: "If an account exists for this email, a password reset link was sent." });
    }
    next(err);
  }
}

// POST /api/v1/auth/reset-password — { token, newPassword }
export async function resetPassword(req, res, next) {
  try {
    const input = resetPasswordSchema.parse(req.body);
    const response = await auth.api.resetPassword({
      body: { token: input.token, newPassword: input.newPassword },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    if (response.status >= 400) {
      const body = await response.json().catch(() => null);
      const code = body?.code;
      const message =
        code === "INVALID_TOKEN"
          ? "This reset link is invalid or has expired. Request a new one."
          : body?.message ?? "Could not reset the password. Request a new link and try again.";
      return res.status(response.status).json({ error: message });
    }
    return res.json({ message: "Password updated. Sign in with your new password." });
  } catch (err) {
    if (err?.name === "ZodError") {
      const first = err?.issues?.[0];
      return res.status(400).json({ error: first?.message ?? "Validation failed" });
    }
    if (err?.statusCode ?? err?.status) {
      return res.status(authErrorStatus(err)).json({ error: authErrorMessage(err) });
    }
    next(err);
  }
}

// POST /api/v1/auth/logout
export async function logout(req, res, next) {
  try {
    const response = await auth.api.signOut({
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });
    return forwardAuthResponse(response, res);
  } catch (err) {
    if (err?.statusCode ?? err?.status) {
      return res.status(authErrorStatus(err)).json({ error: authErrorMessage(err) });
    }
    next(err);
  }
}

// GET /api/v1/auth/me
export async function me(req, res, next) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    if (!session?.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        gymId: true,
        role: true,
        emailVerified: true,
      },
    });
    // `emailVerified` is included so the client can route an unverified
    // session to the OTP screen. Gym data endpoints are still gated by the
    // authenticate middleware, which rejects unverified users outright.
    return res.json({ data: { user: user ?? session.user, session: session.session ?? null } });
  } catch (err) {
    next(err);
  }
}

// After email or Google sign-in, the user creates/attaches their gym here.
export async function setupGym(req, res, next) {
  try {
    if (req.user.gymId) {
      return res.status(409).json({ error: "Your account already belongs to a gym" });
    }
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().max(30).optional(),
      email: z.string().email().optional(),
      address: z.string().trim().max(300).optional()
    }).parse(req.body);

    const gym = await prisma.$transaction(async (tx) => {
      const created = await tx.gym.create({
        data: {
          name: input.name,
          phone: input.phone || null,
          email: input.email || null,
          address: input.address || null
        }
      });
      await tx.user.update({
        where: { id: req.user.id },
        data: { gymId: created.id, role: "ADMIN" }
      });
      return created;
    });

    // Auto-start a free trial for the new gym when trials are enabled.
    // This is best-effort: a failure here must not break gym creation.
    try {
      await startTrial(gym.id, req.user);
    } catch {
      // Trial already started or trials disabled — gym can retry via POST /api/v1/subscription/trial.
    }

    res.status(201).json({
      data: { id: gym.id, name: gym.name, phone: gym.phone },
      message: "Gym created. You can now use the gym management"
    });
  } catch (err) { next(err); }
}
