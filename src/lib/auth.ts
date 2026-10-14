import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { emailOTP } from "better-auth/plugins";
import { Pool } from "pg";
import {prisma} from "./prisma"
import { sendOTPEmail } from "./email";

import dotenv from "dotenv";
dotenv.config();
export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql", 
    }),
  baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",
  trustedOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  user: {
    additionalFields: {
      gymId: { type: "string", required: false, input: false },
      role: { type: "string", required: false, input: false, defaultValue: "ADMIN" },
    },
  },
 emailAndPassword:{
  enabled:true,
  requireEmailVerification: true,
 },
 emailVerification: {
   autoSignInAfterVerification: true,
 },
 plugins: [
   emailOTP({
     otpLength: 6,
     expiresIn: 300,
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
 },
});
