import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import app, { publicPath } from "./src/app.js"
import { prisma } from "./src/db.js";
import {
  getClientOrigins,
  isCrossSiteFrontend,
  normalizeOrigin,
  resolvePublicApiOrigin,
} from "./src/lib/origins.js";

if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32) {
  console.error("BETTER_AUTH_SECRET must be configured with at least 32 characters.");
  process.exit(1);
}

// Startup diagnostics only — never log secrets, tokens or connection strings.
const publicApiOrigin = resolvePublicApiOrigin();
const configuredAuthOrigin = normalizeOrigin(process.env.BETTER_AUTH_URL);

console.log(`[auth] Public API origin: ${publicApiOrigin}`);
if (configuredAuthOrigin && configuredAuthOrigin !== publicApiOrigin) {
  console.warn(
    `[auth] BETTER_AUTH_URL is ${configuredAuthOrigin}, which is not this API's public origin. ` +
      `Using ${publicApiOrigin} for OAuth callbacks. Set BETTER_AUTH_URL=${publicApiOrigin}.`,
  );
}
if (isCrossSiteFrontend()) {
  console.log(
    `[auth] Cross-site frontend (${getClientOrigins().join(", ")}) — session cookies use SameSite=None; Secure.`,
  );
}
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn(
    "[auth] GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are missing — Google sign-in will fail until both are set.",
  );
}

const port = Number(process.env.PORT) || 5000;
const server = app.listen(port, 
  () => {
    console.log(`Gym CRM API running on http://localhost:${port}`);

    const indexHtml = path.join(publicPath, "index.html");
    if (fs.existsSync(indexHtml)) {
      console.log(`Serving frontend from ${publicPath}`);
    } else {
      console.warn(
        `Frontend build missing at ${publicPath} (expected ${indexHtml}). ` +
          `Run "npm run build:frontend" to generate it.`,
      );
    }
  });

async function shutdown() {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

