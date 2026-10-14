import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { Pool } from "pg";
import {prisma} from "./prisma"
import { Pool } from "pg";
import dotenv from "dotenv";
dotenv.config();
export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql", 
    }),
 emailAndPassword:{
  enabled:true,
 },
 socialProviders:{
  google:{
    enabled:true,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
 },
 },
 session:{
  expiresIn: "7d",
 },
 advanced:{
  cookiePrefix:"gym-crm",
 },
});
