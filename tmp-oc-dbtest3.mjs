import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
const adapter = new PrismaMariaDb({ host: "127.0.0.1", port: 3306, user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME, connectionLimit: 5, connectTimeout: 8000 });
const prisma = new PrismaClient({ adapter });
try { await prisma.$queryRawUnsafe("SELECT 1 AS ok"); console.log("OK"); }
catch (e) { console.log("MSG:", e?.message); console.log("META:", JSON.stringify(e?.meta?.driverAdapterError ?? e?.meta, null, 2)); }
await prisma.$disconnect();
