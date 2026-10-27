import { z } from "zod";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { prisma } from "../db.js";
import { sendOTPEmail, sendPasswordResetOtpEmail } from "../lib/email.js";
import { startTrial } from "../services/subscription.service.js";
import { getClientOrigins, resolveClientOriginFromRequest } from "../lib/origins.js";

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
  errorCallbackURL: z.string().url().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  /** `link` emails a reset URL; `otp` emails a 6-digit code. */
  method: z.enum(["link", "otp"]).optional().default("link"),
});

const resetPasswordSchema = z
  .object({
    method: z.enum(["link", "otp"]).optional(),
    token: z.string().trim().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    otp: z.string().trim().optional(),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password must be 128 characters or fewer"),
  })
  .superRefine((value, ctx) => {
    // Infer the method from the fields supplied when the client omits it.
    const method = value.method ?? (value.token ? "link" : "otp");
    if (method === "link") {
      if (!value.token) {
        ctx.addIssue({
          code: "custom",
          path: ["token"],
          message: "Reset token is required",
        });
      }
      return;
    }
    if (!value.email) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "Email is required for a code reset",
      });
    }
    if (!value.otp || !/^\d{6}$/.test(value.otp)) {
      ctx.addIssue({
        code: "custom",
        path: ["otp"],
        message: "OTP must be a 6-digit code",
      });
    }
  });

/**
 * Accept a redirect URL only when it belongs to a configured frontend origin.
 * The callback page is the default because it knows how to finish onboarding
 * (dashboard, verify-email or gym setup).
 */
function resolveAllowedUrl(input, fallbackPath = "/auth/callback") {
  const origins = getClientOrigins();
  if (!input) return `${origins[0]}${fallbackPath}`;
  try {
    const target = new URL(input);
    if (!origins.includes(target.origin)) return null;
    return target.toString();
  } catch {
    return null;
  }
}

function resolveErrorCallbackURL(input, callbackURL) {
  if (input) return resolveAllowedUrl(input);
  // Errors must be shown by the frontend callback page, not Better Auth's
  // error page on the API host. Keep the origin the caller chose, so multiple
  // allowed frontends each return to their own site.
  try {
    return `${new URL(callbackURL).origin}/auth/callback`;
  } catch {
    return null;
  }
}

// Copy Set-Cookie headers from a Better Auth Response onto the Express res.
export function forwardCookies(authResponse, res) {
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
 * Generate and deliver a fresh email-verification OTP.
 *
 * Returns true only when the email was actually handed to the SMTP transport.
 * Better Auth's own sendVerificationOTP endpoint swallows delivery errors
 * internally, so the OTP is created here and sent explicitly. That lets the
 * resend endpoint tell the user the truth instead of pretending a code went
 * out while the SMTP server is unreachable.
 */
async function sendVerificationOtp(email) {
  try {
    const otp = await auth.api.createVerificationOTP({
      body: { email, type: "email-verification" },
    });
    return await sendOTPEmail(email, otp);
  } catch (err) {
    console.error(
      `[auth] Could not deliver the verification code to ${email}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}

/**
 * Response for a signup whose email already exists but was never verified.
 * The account is not duplicated: a new OTP is sent and the client continues
 * the same verification flow.
 */
function unverifiedSignupResponse(res, email, emailSent = true) {
  return res.status(200).json({
    code: "EMAIL_NOT_VERIFIED",
    message: emailSent
      ? "This email is already registered but not verified. A new 6-digit code was sent to your email."
      : "This email is already registered but not verified. We couldn't send a new code — use Resend code on the next screen.",
    email,
    emailSent,
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
        const emailSent = await sendVerificationOtp(input.email);
        return unverifiedSignupResponse(res, input.email, emailSent);
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
        const emailSent = await sendVerificationOtp(input.email);
        return unverifiedSignupResponse(res, input.email, emailSent);
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
    // The account exists at this point. Send the verification code explicitly
    // so delivery failures can be reported instead of turning into a timeout.
    const emailSent = await sendVerificationOtp(input.email);
    return res.status(201).json({
      message: emailSent
        ? "Account created. Enter the 6-digit code sent to your email to verify."
        : "Account created, but we couldn't send the verification email. Use Resend code on the next screen.",
      emailSent,
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
        const emailSent = await sendVerificationOtp(email);
        return unverifiedSignupResponse(res, email, emailSent);
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
    const emailSent = await sendVerificationOtp(input.email);
    if (!emailSent) {
      return res.status(502).json({
        error: "Could not send the verification code right now. Please try again in a moment.",
      });
    }
    return res.json({ message: "If an account exists for this email, a new code was sent." });
  } catch (err) {
    if (err?.statusCode ?? err?.status) {
      return res.status(authErrorStatus(err)).json({ error: authErrorMessage(err) });
    }
    next(err);
  }
}

// POST /api/v1/auth/google — { callbackURL?, errorCallbackURL? } -> { url }
export async function googleSignIn(req, res, next) {
  try {
    const input = googleSchema.parse(req.body ?? {});
    const callbackURL = resolveAllowedUrl(input.callbackURL);
    if (!callbackURL) {
      return res.status(400).json({ error: "callbackURL must belong to an allowed frontend origin" });
    }
    const errorCallbackURL = resolveErrorCallbackURL(input.errorCallbackURL, callbackURL);
    if (!errorCallbackURL) {
      return res.status(400).json({
        error: "errorCallbackURL must belong to an allowed frontend origin",
      });
    }
    const response = await auth.api.signInSocial({
      body: { provider: "google", callbackURL, errorCallbackURL },
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
      const emailSent = await sendVerificationOtp(input.email);
      forwardCookies(response, res);
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        error: emailSent
          ? "Email not verified. A new 6-digit code was sent to your email."
          : "Email not verified, and we couldn't send a new code. Use Resend code on the next screen.",
        emailSent,
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

// POST /api/v1/auth/forgot-password — { email, method? }
// Always answers with the same neutral message for unknown emails so the
// endpoint cannot be used to enumerate accounts. When the email exists but
// SMTP delivery fails, returns 502 so the client shows a real error instead
// of false success. `method: "link"` (default) emails a reset URL via Better
// Auth's sendResetPassword hook; `method: "otp"` emails a 6-digit code
// through the emailOTP plugin (see src/lib/auth.ts).
export async function forgotPassword(req, res, next) {
  try {
    const input = forgotPasswordSchema.parse(req.body);
    const message =
      input.method === "otp"
        ? "If an account exists for this email, a password reset code was sent."
        : "If an account exists for this email, a password reset link was sent.";

    // Never reveal whether the email has an account: unknown emails get the
    // same neutral response as successfully delivered emails.
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (!user) {
      return res.json({ message, method: input.method });
    }

    if (input.method === "otp") {
      const otp = await auth.api.createVerificationOTP({
        body: { email: input.email, type: "forget-password" },
        headers: fromNodeHeaders(req.headers),
      });
      const emailSent = await sendPasswordResetOtpEmail(input.email, otp);
      if (!emailSent) {
        return res.status(502).json({
          error: "We couldn't send the reset code right now. Please try again in a moment.",
        });
      }
    } else {
      await auth.api.requestPasswordReset({
        body: {
          email: input.email,
          // Used by sendResetPassword to build a link for the frontend that
          // made this request instead of always the first configured origin.
          redirectTo: `${resolveClientOriginFromRequest(req)}/reset-password`,
        },
        headers: fromNodeHeaders(req.headers),
      });
      // If sendResetPassword hook threw (SMTP failure), we won't reach here.
    }

    return res.json({ message, method: input.method });
  } catch (err) {
    if (err?.name === "ZodError") {
      const first = err?.issues?.[0];
      return res.status(400).json({ error: first?.message ?? "Validation failed" });
    }
    // Better Auth "user not found" or validation errors — neutral response.
    if (err?.statusCode ?? err?.status) {
      return res.json({
        message:
          "If an account exists for this email, a password reset link or code was sent.",
      });
    }
    // SMTP/delivery failure with no statusCode — report truthfully.
    return res.status(502).json({
      error: "We couldn't send the reset email right now. Please try again in a moment.",
    });
  }
}

// GET /api/v1/auth/reset-password/verify?token=...
// Lets the reset page reject an invalid/expired link before the user types a
// new password. The token itself is the secret, so this reveals only whether
// the caller already holds a valid one.
export async function verifyResetToken(req, res, next) {
  try {
    const token = String(req.query.token ?? "").trim();
    if (!token) {
      return res.status(400).json({
        code: "INVALID_TOKEN",
        error: "This reset link is missing its token. Request a new one.",
      });
    }
    const record = await prisma.verification.findFirst({
      where: { identifier: `reset-password:${token}` },
      select: { expiresAt: true },
    });
    if (!record || record.expiresAt.getTime() <= Date.now()) {
      return res.status(400).json({
        code: "INVALID_TOKEN",
        error: "This reset link is invalid or has expired. Request a new one.",
      });
    }
    return res.json({ valid: true, expiresAt: record.expiresAt });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/auth/reset-password — { token, newPassword } for a link reset
// or { email, otp, newPassword } for an OTP reset.
export async function resetPassword(req, res, next) {
  try {
    const input = resetPasswordSchema.parse(req.body);
    const method = input.method ?? (input.token ? "link" : "otp");

    const response =
      method === "otp"
        ? await auth.api.resetPasswordEmailOTP({
            body: {
              email: input.email,
              otp: input.otp,
              password: input.newPassword,
            },
            headers: fromNodeHeaders(req.headers),
            asResponse: true,
          })
        : await auth.api.resetPassword({
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
          : code === "OTP_EXPIRED"
            ? "That code has expired. Request a new one."
            : code === "TOO_MANY_ATTEMPTS"
              ? "Too many attempts. Request a new code and try again."
              : code === "INVALID_OTP"
                ? "Invalid code. Check the 6-digit code and try again."
                : body?.message ??
                  "Could not reset the password. Request a new link and try again.";
      return res.status(response.status).json({ error: message, code });
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
    // A platform admin must never be converted into a gym owner (or get a gym
    // attached to the platform account). SUPER_ADMIN is intentionally not a
    // gym role and is managed only by the bootstrap script.
    if (req.user.role === "SUPER_ADMIN") {
      return res.status(403).json({
        error: "Platform administrators cannot create gyms",
        code: "SUPER_ADMIN_CANNOT_CREATE_GYM",
      });
    }
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
