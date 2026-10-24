import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { Pool } from "pg";
import {prisma} from "./prisma"
import { sendOTPEmail, sendPasswordResetEmail } from "./email";

import dotenv from "dotenv";
import {
  getClientOrigins,
  getTrustedOrigins,
  isCrossSiteFrontend,
  resolvePublicApiOrigin,
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
   // to POST /api/v1/auth/reset-password.
   async sendResetPassword({ user, token }) {
     const url = `${clientOrigin}/reset-password?token=${encodeURIComponent(token)}`;
     await sendPasswordResetEmail(user.email, url);
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
     sendVerificationOnSignUp: true,
     async sendVerificationOTP({ email, otp, type }) {
       if (type !== "email-verification") return;
       await sendOTPEmail(email, otp);
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
