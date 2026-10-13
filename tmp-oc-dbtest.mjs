import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
const adapter = new PrismaMariaDb({ host: "localhost", port: 3306, user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME, connectionLimit: 5 });
const prisma = new PrismaClient({ adapter });
try {
  const r = await prisma.$queryRawUnsafe("SELECT 1 AS ok");
  console.log("DB OK", JSON.stringify(r));
} catch (e) { console.log("DB ERR", e?.message); }
await prisma.$disconnect();
