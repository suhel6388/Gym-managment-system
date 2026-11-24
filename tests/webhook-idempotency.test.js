import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Tests for Razorpay webhook verification and deduplication logic

const TEST_SECRET = "whsec_test_secret_for_unit_tests_12345";

function signPayload(rawBody, secret = TEST_SECRET) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

function signaturesMatch(expected, provided) {
  const expectedBuffer = Buffer.from(String(expected ?? ""), "utf8");
  const providedBuffer = Buffer.from(String(provided ?? ""), "utf8");
  if (expectedBuffer.length !== providedBuffer.length || expectedBuffer.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function verifyWebhookSignature(rawBody, signature, secret = TEST_SECRET) {
  if (!secret) throw new Error("Webhook secret missing");
  if (!rawBody || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return signaturesMatch(expected, signature);
}

test("verifyWebhookSignature validates correct signature from raw Buffer", () => {
  const payload = JSON.stringify({
    entity: "event",
    id: "evt_1234567890",
    event: "payment.captured",
    payload: {
      payment: { entity: { id: "pay_123", order_id: "order_456", amount: 49900 } },
    },
  });
  const rawBody = Buffer.from(payload, "utf8");
  const signature = signPayload(rawBody, TEST_SECRET);

  assert.equal(verifyWebhookSignature(rawBody, signature), true);
});

test("verifyWebhookSignature rejects tampered body or invalid signature", () => {
  const rawBody = Buffer.from(JSON.stringify({ event: "payment.captured", id: "evt_1" }), "utf8");
  const signature = signPayload(rawBody, TEST_SECRET);

  // Tampered payload
  const tamperedBody = Buffer.from(JSON.stringify({ event: "payment.captured", id: "evt_TAMPERED" }), "utf8");
  assert.equal(verifyWebhookSignature(tamperedBody, signature), false);

  // Wrong signature
  assert.equal(verifyWebhookSignature(rawBody, "invalid_hex_signature_deadbeef"), false);

  // Wrong secret
  assert.equal(verifyWebhookSignature(rawBody, signature, "different_secret"), false);
});

test("verifyWebhookSignature rejects missing signature or missing body", () => {
  const rawBody = Buffer.from("{}", "utf8");
  assert.equal(verifyWebhookSignature(rawBody, null), false);
  assert.equal(verifyWebhookSignature(null, "some_sig"), false);
  assert.equal(verifyWebhookSignature("", "some_sig"), false);
});

test("webhook event deduplication handles duplicate deliveries idempotently", async () => {
  // Simulated event storage
  const processedEvents = new Set();
  let activationCount = 0;

  async function simulateHandleWebhook(rawBody, signature) {
    if (!verifyWebhookSignature(rawBody, signature)) {
      return { status: 401, body: { error: "Invalid signature" } };
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    const eventId = event.id;
    const eventType = event.event;

    // Simulate Prisma P2002 on duplicate event ID
    if (processedEvents.has(eventId)) {
      return { status: 200, body: { received: true, duplicate: true } };
    }

    processedEvents.add(eventId);

    if (eventType === "payment.captured" || eventType === "order.paid") {
      activationCount += 1;
    }

    return { status: 200, body: { received: true, event: eventType, duplicate: false } };
  }

  const eventPayload = {
    entity: "event",
    id: "evt_unique_order_paid_001",
    event: "payment.captured",
    payload: {
      payment: { entity: { id: "pay_test_001", order_id: "order_test_001" } },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(eventPayload), "utf8");
  const signature = signPayload(rawBody);

  // First delivery: processes and activates
  const first = await simulateHandleWebhook(rawBody, signature);
  assert.equal(first.status, 200);
  assert.equal(first.body.received, true);
  assert.equal(first.body.duplicate, false);
  assert.equal(activationCount, 1);

  // Second delivery (duplicate retry from Razorpay): skips idempotently
  const second = await simulateHandleWebhook(rawBody, signature);
  assert.equal(second.status, 200);
  assert.equal(second.body.received, true);
  assert.equal(second.body.duplicate, true);
  assert.equal(activationCount, 1); // activation NOT called twice

  // Third delivery: still idempotent
  const third = await simulateHandleWebhook(rawBody, signature);
  assert.equal(third.status, 200);
  assert.equal(third.body.duplicate, true);
  assert.equal(activationCount, 1);
});

test("webhook event validates event structure before database operations", () => {
  function validateEventStructure(rawBody) {
    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return { valid: false, code: "INVALID_PAYLOAD" };
    }
    if (!event?.id || !event?.event) {
      return { valid: false, code: "MALFORMED_EVENT" };
    }
    return { valid: true, eventId: event.id, eventType: event.event };
  }

  // Non-JSON payload
  assert.deepEqual(validateEventStructure(Buffer.from("invalid json text")), {
    valid: false,
    code: "INVALID_PAYLOAD",
  });

  // Missing id
  assert.deepEqual(validateEventStructure(Buffer.from(JSON.stringify({ event: "order.paid" }))), {
    valid: false,
    code: "MALFORMED_EVENT",
  });

  // Missing event
  assert.deepEqual(validateEventStructure(Buffer.from(JSON.stringify({ id: "evt_123" }))), {
    valid: false,
    code: "MALFORMED_EVENT",
  });

  // Valid event
  assert.deepEqual(
    validateEventStructure(Buffer.from(JSON.stringify({ id: "evt_123", event: "payment.captured" }))),
    { valid: true, eventId: "evt_123", eventType: "payment.captured" }
  );
});

