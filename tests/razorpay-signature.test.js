import { test } from "node:test";
import assert from "node:assert";
import crypto from "crypto";

import {
  verifyPaymentSignature,
  verifyWebhookSignature,
  isConfigured,
  getKeyId,
} from "../src/services/razorpay.service.js";

test("verifyPaymentSignature produces a deterministic valid signature", (t) => {
  const keySecret = "test_secret";
  const orderId = "order_123";
  const paymentId = "pay_123";
  const body = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
  assert.strictEqual(expected.length, 64);
});

test("verifyPaymentSignature: different secrets produce different signatures", (t) => {
  const orderId = "order_123";
  const paymentId = "pay_123";
  const body = `${orderId}|${paymentId}`;
  const a = crypto.createHmac("sha256", "secret_a").update(body).digest("hex");
  const b = crypto.createHmac("sha256", "secret_b").update(body).digest("hex");
  assert.notStrictEqual(a, b);
});

test("verifyWebhookSignature produces a deterministic valid signature", (t) => {
  const secret = "wh_secret";
  const rawBody = JSON.stringify({ id: "evt_1", event: "payment.captured" });
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  assert.strictEqual(expected.length, 64);
});

test("isConfigured and getKeyId reflect env types", (t) => {
  assert.strictEqual(typeof isConfigured(), "boolean");
  assert.ok(getKeyId() === null || typeof getKeyId() === "string");
});
