// Regression tests for shared-prefix router mounting.
//
// The receipts router is mounted at the shared `/api/v1` prefix so it can own
// `/api/v1/receipt-settings` and `/api/v1/payments/:id/receipt`. Its auth guard
// must therefore be scoped to those paths: a router-level
// `router.use(authenticate, requireGym)` also runs for every request to routers
// mounted later (super-admin, admin/subscription, schedule, ...), and platform
// owners have no gymId. That produced `403 {"error":"Gym setup required"}` on
// the whole super-admin dashboard, including "create gym owner".

import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

import express from "express";

import receiptRouter from "../src/routes/receipt.route.js";

async function withServer(configure, run) {
  const app = express();
  configure(app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test("the /api/v1 receipt router does not guard unrelated API routes", async () => {
  await withServer(
    (app) => {
      // Same mount order as src/app.js: the receipts router is mounted at the
      // shared prefix, then the platform routers.
      app.use("/api/v1", receiptRouter);
      app.get("/api/v1/super-admin/stats", (req, res) =>
        res.json({ reached: "super-admin" }),
      );
      app.get("/api/v1/subscription/plans", (req, res) =>
        res.json({ reached: "subscription" }),
      );
      app.post("/api/v1/super-admin/gyms", (req, res) =>
        res.status(201).json({ reached: "create-gym" }),
      );
    },
    async (base) => {
      for (const path of [
        "/api/v1/super-admin/stats",
        "/api/v1/subscription/plans",
      ]) {
        const res = await fetch(`${base}${path}`);
        assert.equal(
          res.status,
          200,
          `${path} must reach its own router, not the receipt gym guard`,
        );
      }

      const created = await fetch(`${base}/api/v1/super-admin/gyms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gymName: "Test Gym" }),
      });
      assert.equal(created.status, 201);
    },
  );
});

test("the receipt routes themselves still require an authenticated gym user", async () => {
  await withServer(
    (app) => {
      app.use("/api/v1", receiptRouter);
      // If the guard were removed entirely, this fallback would answer 200.
      app.use("/api/v1", (req, res) => res.json({ reached: "fallback" }));
    },
    async (base) => {
      const res = await fetch(`${base}/api/v1/receipt-settings`);
      assert.notEqual(
        res.status,
        200,
        "receipt settings must not be readable without a session",
      );
      assert.equal(res.status, 401);
    },
  );
});
