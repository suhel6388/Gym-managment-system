import { z } from "zod";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { prisma } from "../db.js";

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

// POST /api/v1/auth/signup
export async function signup(req, res, next) {
  try {
    const input = signupSchema.parse(req.body);

    // Pre-check: email already registered?
    const existingEmail = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existingEmail) {
      return res.status(409).json({ error: "An account with this email already exists" });
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
    // Better Auth returns 422 when the email is taken — surface it as 409.
    if (response.status === 422) {
      forwardCookies(response, res);
      const body = await response.clone().json().catch(() => null);
      const msg = JSON.stringify(body ?? "").toLowerCase();
      if (msg.includes("phone")) {
        return res.status(409).json({ error: "An account with this mobile number already exists" });
      }
      return res.status(409).json({ error: "An account with this email already exists" });
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
      return res.status(409).json({ error: "An account with this email already exists" });
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
      // Email not verified — send a fresh OTP so the user can continue.
      try {
        await auth.api.sendVerificationOTP({
          body: { email: input.email, type: "email-verification" },
          headers: fromNodeHeaders(req.headers),
          asResponse: true,
        });
      } catch { /* best effort — login error below is what matters */ }
      forwardCookies(response, res);
      return res.status(403).json({ error: "Email not verified. A new code was sent to your email." });
    }
    return forwardAuthResponse(response, res);
  } catch (err) {
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
      select: { id: true, name: true, email: true, phone: true, gymId: true, role: true },
    });
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
      email: z.string().email().optional()
    }).parse(req.body);

    const gym = await prisma.$transaction(async (tx) => {
      const created = await tx.gym.create({
        data: { name: input.name, phone: input.phone, email: input.email }
      });
      await tx.user.update({
        where: { id: req.user.id },
        data: { gymId: created.id, role: "ADMIN" }
      });
      return created;
    });

    res.status(201).json({
      data: { id: gym.id, name: gym.name, phone: gym.phone },
      message: "Gym created. You can now use the gym management"
    });
  } catch (err) { next(err); }
}
