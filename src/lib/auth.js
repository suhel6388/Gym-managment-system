import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { prisma } from "./prisma.js";
import { sendOTPEmail, sendPasswordResetEmail, sendPasswordResetOtpEmail } from "./email.js";
import {
  getClientOrigins,
  getTrustedOrigins,
  isCrossSiteFrontend,
  resolvePublicApiOrigin,
  resolveRequestClientOrigin,
} from "./origins.js";

const publicApiOrigin = resolvePublicApiOrigin();
const clientOrigin = getClientOrigins()[0];
const crossSiteFrontend = isCrossSiteFrontend();

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  baseURL: publicApiOrigin,
  trustedOrigins: getTrustedOrigins(),
  onAPIError: {
    errorURL: `${clientOrigin}/auth/callback`,
  },
  user: {
    additionalFields: {
      phone: { type: "string", required: false },
      gymId: { type: "string", required: false, input: false },
      role: { type: "string", required: false, input: false, defaultValue: "ADMIN" },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    async sendResetPassword({ user, token, url }, request) {
      const allowed = getClientOrigins();
      let origin = null;
      try {
        const callback = new URL(url).searchParams.get("callbackURL");
        const candidate = callback ? new URL(callback).origin : null;
        if (candidate && allowed.includes(candidate)) origin = candidate;
      } catch {
        origin = null;
      }
      const resetOrigin = origin ?? resolveRequestClientOrigin(request);
      const resetUrl = `${resetOrigin}/reset-password?token=${encodeURIComponent(token)}`;
      await sendPasswordResetEmail(user.email, resetUrl);
    },
  },
  emailVerification: {
    autoSignInAfterVerification: true,
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 3,
      sendVerificationOnSignUp: false,
      async sendVerificationOTP({ email, otp, type }) {
        try {
          if (type === "email-verification") {
            await sendOTPEmail(email, otp);
          } else if (type === "forget-password") {
            await sendPasswordResetOtpEmail(email, otp);
          }
        } catch (err) {
          console.error(
            `[auth] Could not deliver the ${type} code to ${email}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          throw err;
        }
      },
    }),
  ],
  socialProviders: {
    google: {
      enabled: true,
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },
  session: {
    expiresIn: 7 * 24 * 60 * 60,
  },
  advanced: {
    cookiePrefix: "gym-crm",
    useSecureCookies: publicApiOrigin.startsWith("https://"),
    ...(crossSiteFrontend
      ? { defaultCookieAttributes: { sameSite: "none", secure: true } }
      : {}),
  },
});

