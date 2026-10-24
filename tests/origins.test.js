import { test } from "node:test";
import assert from "node:assert";

// Pure unit tests for origin resolution. No database or network required.

import {
  getClientOrigins,
  getTrustedOrigins,
  isCrossSiteFrontend,
  normalizeOrigin,
  parseOrigins,
  resolvePublicApiOrigin,
} from "../src/lib/origins.js";

const RENDER_API = "https://gym-managment-system-7yiu.onrender.com";
const VERCEL_CLIENT = "https://client-gym-iota.vercel.app";

test("normalizeOrigin trims, strips paths and trailing slashes", () => {
  assert.strictEqual(normalizeOrigin("  https://example.com/  "), "https://example.com");
  assert.strictEqual(
    normalizeOrigin("https://example.com/login?next=%2Fdashboard"),
    "https://example.com",
  );
  assert.strictEqual(normalizeOrigin("http://localhost:5000/"), "http://localhost:5000");
});

test("normalizeOrigin rejects missing schemes and credentials", () => {
  assert.strictEqual(normalizeOrigin("example.com"), null);
  assert.strictEqual(normalizeOrigin("ftp://example.com"), null);
  assert.strictEqual(normalizeOrigin("https://user:pass@example.com"), null);
  assert.strictEqual(normalizeOrigin("   "), null);
});

test("parseOrigins splits, normalizes and deduplicates", () => {
  assert.deepStrictEqual(
    parseOrigins(` ${VERCEL_CLIENT}/, ${VERCEL_CLIENT}, http://localhost:3000/ `),
    [VERCEL_CLIENT, "http://localhost:3000"],
  );
});

test("getClientOrigins falls back to the Next.js dev server", () => {
  assert.deepStrictEqual(getClientOrigins({}), ["http://localhost:3000"]);
});

test("resolvePublicApiOrigin keeps a correctly configured API origin", () => {
  assert.strictEqual(
    resolvePublicApiOrigin({
      BETTER_AUTH_URL: `${RENDER_API}/`,
      CLIENT_ORIGIN: VERCEL_CLIENT,
      RENDER_EXTERNAL_URL: RENDER_API,
    }),
    RENDER_API,
  );
});

test("resolvePublicApiOrigin uses Render when BETTER_AUTH_URL is missing", () => {
  assert.strictEqual(
    resolvePublicApiOrigin({
      CLIENT_ORIGIN: VERCEL_CLIENT,
      RENDER_EXTERNAL_URL: RENDER_API,
    }),
    RENDER_API,
  );
});

test("resolvePublicApiOrigin recovers the API host when BETTER_AUTH_URL points at the frontend", () => {
  assert.strictEqual(
    resolvePublicApiOrigin({
      BETTER_AUTH_URL: VERCEL_CLIENT,
      CLIENT_ORIGIN: VERCEL_CLIENT,
      RENDER_EXTERNAL_URL: RENDER_API,
    }),
    RENDER_API,
  );
});

test("resolvePublicApiOrigin uses RENDER_EXTERNAL_HOSTNAME when the full URL is absent", () => {
  assert.strictEqual(
    resolvePublicApiOrigin({
      BETTER_AUTH_URL: VERCEL_CLIENT,
      CLIENT_ORIGIN: VERCEL_CLIENT,
      RENDER_EXTERNAL_HOSTNAME: "gym-managment-system-7yiu.onrender.com",
    }),
    RENDER_API,
  );
});

test("resolvePublicApiOrigin recovers the API host when BETTER_AUTH_URL is local", () => {
  assert.strictEqual(
    resolvePublicApiOrigin({
      BETTER_AUTH_URL: "http://localhost:5000",
      CLIENT_ORIGIN: VERCEL_CLIENT,
      RENDER_EXTERNAL_URL: RENDER_API,
    }),
    RENDER_API,
  );
});

test("resolvePublicApiOrigin prefers an explicit PUBLIC_API_URL", () => {
  assert.strictEqual(
    resolvePublicApiOrigin({
      PUBLIC_API_URL: "https://api.example.com/",
      BETTER_AUTH_URL: VERCEL_CLIENT,
      CLIENT_ORIGIN: VERCEL_CLIENT,
      RENDER_EXTERNAL_URL: RENDER_API,
    }),
    "https://api.example.com",
  );
});

test("resolvePublicApiOrigin falls back to localhost without configuration", () => {
  assert.strictEqual(resolvePublicApiOrigin({}), "http://localhost:5000");
});

test("getTrustedOrigins contains the frontend and API origins once", () => {
  assert.deepStrictEqual(
    getTrustedOrigins({
      BETTER_AUTH_URL: VERCEL_CLIENT,
      CLIENT_ORIGIN: `${VERCEL_CLIENT}/,${VERCEL_CLIENT}`,
      RENDER_EXTERNAL_URL: RENDER_API,
    }),
    [VERCEL_CLIENT, RENDER_API],
  );
});

test("isCrossSiteFrontend is true for Vercel + Render", () => {
  assert.strictEqual(
    isCrossSiteFrontend({
      BETTER_AUTH_URL: RENDER_API,
      CLIENT_ORIGIN: VERCEL_CLIENT,
    }),
    true,
  );
});

test("isCrossSiteFrontend is false for the same host or plain HTTP", () => {
  assert.strictEqual(
    isCrossSiteFrontend({
      BETTER_AUTH_URL: RENDER_API,
      CLIENT_ORIGIN: RENDER_API,
    }),
    false,
  );
  assert.strictEqual(
    isCrossSiteFrontend({
      BETTER_AUTH_URL: "http://localhost:5000",
      CLIENT_ORIGIN: "http://localhost:3000",
    }),
    false,
  );
});
