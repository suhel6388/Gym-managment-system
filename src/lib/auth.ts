import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { Pool } from "pg";
import {prisma} from "./prisma"
import { sendOTPEmail, sendPasswordResetEmail, sendPasswordResetOtpEmail } from "./email";

import dotenv from "dotenv";
import {
  getClientOrigins,
  getTrustedOrigins,
  isCrossSiteFrontend,
  resolvePublicApiOrigin,
  resolveRequestClientOrigin,
} from "./origins";
dotenv.config();

// `BETTER_AUTH_URL` must be this API's public origin. `resolvePublicApiOrigin`
// also recovers Render's URL when the variable was pointed at the frontend.
const publicApiOrigin = resolvePublicApiOrigin();

// Frontend origin used for links in auth emails (first allowed client origin).
const clientOrigin = getClientOrigins()[0];

// Vercel + Render is a cross-site setup: without `SameSite=None; Secure` the
// browser drops the session cookie before the next `/auth/me` request. A
// same-site deployment keeps Better Auth's safer `SameSite=Lax` default.
const crossSiteFrontend = isCrossSiteFrontend();

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql", 
    }),
  baseURL: publicApiOrigin,
  trustedOrigins: getTrustedOrigins(),
  // OAuth failures that happen before a state is available (for example a
  // missing/blocked state cookie) cannot use the per-request errorCallbackURL.
  // Send those to the frontend callback page instead of `/api/auth/error`.
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
 emailAndPassword:{
  enabled:true,
  requireEmailVerification: true,
   // Password-reset emails go through the existing SMTP service. The link
   // points at the frontend reset page, which posts token+newPassword back
   // to POST /api/v1/auth/reset-password. The origin is taken from the request
   // that asked for the reset so each allowed deployment gets its own link.
   async sendResetPassword({ user, token, url }, request) {
     // Prefer the reset page origin passed as `redirectTo` by the controller
     // (it already validated the request's Origin header). Better Auth encodes
     // it as the `callbackURL` query parameter on its own reset URL.
     const allowed = getClientOrigins();
     let origin: string | null = null;
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
     // The signup controller creates and sends the OTP itself so it can tell
     // the client whether delivery actually succeeded. Keeping this disabled
     // also means a slow SMTP server cannot block the signup response.
     sendVerificationOnSignUp: false,
     async sendVerificationOTP({ email, otp, type }) {
       // Email verification codes and password-reset codes both go through
       // the SMTP service. Delivery failures are logged AND re-thrown so the
       // caller can report the truth instead of pretending a code was sent.
       // The forgot-password controller checks user existence before calling,
       // so this does not leak account existence.
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
 socialProviders:{
  google:{
    enabled:true,
   clientId: process.env.GOOGLE_CLIENT_ID!,
   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 },
 },
 session:{
    expiresIn: 7 * 24 * 60 * 60,
 },
 advanced:{
  cookiePrefix:"gym-crm",
  // Match Better Auth's inferred setting explicitly so the secure-cookie
  // prefix and SameSite=None always agree with the public API URL.
  useSecureCookies: publicApiOrigin.startsWith("https://"),
  ...(crossSiteFrontend
    ? { defaultCookieAttributes: { sameSite: "none" as const, secure: true } }
    : {}),
 },
});
