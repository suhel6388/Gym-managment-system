if (!process.env.DATABASE_URL) {
  try {
    const dotenv = await import("dotenv");
    (dotenv.default?.config || dotenv.config)?.();
  } catch {
    // environment variables may be provided by process/system
  }
}

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

const adapter = new PrismaPg({
  connectionString: databaseUrl,
});
const prisma = new PrismaClient({ adapter });

export { prisma };
