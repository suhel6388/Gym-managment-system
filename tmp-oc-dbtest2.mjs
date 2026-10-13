import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "./generated/prisma/client.ts";
async function test(label, opts) {
  const adapter = new PrismaMariaDb({ ...opts, connectionLimit: 5 });
  const prisma = new PrismaClient({ adapter });
  try { const r = await prisma.$queryRawUnsafe("SELECT 1 AS ok"); console.log(label, "OK", JSON.stringify(r)); }
  catch (e) { console.log(label, "ERR", (e?.message||"").split("\n").slice(0,3).join(" ")); }
  await prisma.$disconnect();
}
const base = { user: process.env.DATABASE_USER, password: process.env.DATABASE_PASSWORD, database: process.env.DATABASE_NAME };
await test("127.0.0.1", { ...base, host: "127.0.0.1", port: 3306 });
await test("undefined-host", { ...base });
