import "dotenv/config";
import app from "./src/app.js"
import { prisma } from "./src/db.js";

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  console.error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
  process.exit(1);
}

const port = Number(process.env.PORT || 5000);
const server = app.listen(port, () => console.log(`Gym CRM API running on http://localhost:${port}`));

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
