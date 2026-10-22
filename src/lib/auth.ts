import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { Pool } from "pg";
import {prisma} from "./prisma"
import { sendOTPEmail, sendPasswordResetEmail } from "./email";

import dotenv from "dotenv";
dotenv.config();

// Frontend origins allowed to call Better Auth. CLIENT_ORIGIN lists external
// frontends (e.g. a Vercel deployment); the service's own URL is always trusted
// so the frontend served by this Express app works on the same origin.
function clientOrigins(): string[] {
  return (process.env.CLIENT_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Public URL of this API. `BETTER_AUTH_URL` is often left at its local value
 * when deploying (e.g. http://localhost:5000), which makes Better Auth issue
 * non-secure, SameSite=Lax cookies. On Render, `RENDER_EXTERNAL_URL` is the
 * real HTTPS URL, so prefer it whenever the configured URL is local.
 */
function ownUrl(): string {
  const configured = process.env.BETTER_AUTH_URL?.trim();
  const isLocal = !configured || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured);
  if (isLocal) {
    const renderUrl = process.env.RENDER_EXTERNAL_URL?.trim();
    if (renderUrl) return renderUrl;
  }
  return configured || "http://localhost:5000";
}

// Frontend origin used for links in auth emails (first allowed client origin).
function clientOrigin(): string {
  return clientOrigins()[0];
}

function trustedOrigins(): string[] {
  const origins = clientOrigins();
  const own = ownUrl();
  if (!origins.includes(own)) {
    origins.push(own);
  }
  return origins;
}

/**
 * A browser frontend on a different site (for example Vercel + Render) needs
 * `SameSite=None; Secure` cookies, otherwise the session cookie set by the
 * login response is never sent on the following `/auth/me` request. When the
 * frontend is served from the same site as the API, keep the safer `Lax`
 * default.
 */
function usesCrossSiteFrontend(): boolean {
  const own = ownUrl();
  if (!own.startsWith("https://")) return false;

  let ownHost: string;
  try {
    ownHost = new URL(own).hostname;
  } catch {
    return false;
  }

  return clientOrigins().some((origin) => {
    try {
      return new URL(origin).hostname !== ownHost;
    } catch {
      return false;
    }
  });
}

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql", 
    }),
  baseURL: ownUrl(),
  trustedOrigins: trustedOrigins(),
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
     const url = `${clientOrigin()}/reset-password?token=${encodeURIComponent(token)}`;
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
  // prefix and SameSite=None always agree with the public URL.
  useSecureCookies: ownUrl().startsWith("https://"),
  ...(usesCrossSiteFrontend()
    ? { defaultCookieAttributes: { sameSite: "none" as const, secure: true } }
    : {}),
 },
});
