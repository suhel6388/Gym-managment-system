// Razorpay integration for SaaS subscription billing.
//
// All secrets are read from environment variables and never returned to the
// frontend. If Razorpay credentials are not configured, order creation throws
// a clear error so the caller can surface a "payment not configured" message
// instead of failing silently.
//
// Required env vars:
//   RAZORPAY_KEY_ID        - Razorpay key id (public, safe to return to frontend)
//   RAZORPAY_KEY_SECRET    - Razorpay key secret (server only)
//   RAZORPAY_WEBHOOK_SECRET- Razorpay webhook secret (server only)

import crypto from "crypto";
import Razorpay from "razorpay";

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

let razorpay = null;
if (keyId && keySecret) {
  razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
}

/** True when Razorpay credentials are configured. */
export function isConfigured() {
  return Boolean(keyId && keySecret);
}

/** The public key id that may be returned to the frontend for checkout. */
export function getKeyId() {
  return keyId ?? null;
}

/** The Razorpay client instance (null when not configured). */
export function getClient() {
  return razorpay;
}

/**
 * Create a Razorpay order for a subscription payment.
 * `amount` is in the currency's minor unit (paise for INR).
 */
export async function createOrder({ amount, currency = "INR", receipt, notes = {} }) {
  if (!razorpay) {
    throw new Error("Razorpay is not configured on the server");
  }
  return razorpay.orders.create({
    amount: Math.round(amount),
    currency,
    receipt,
    notes,
  });
}

/**
 * Verify a Razorpay payment signature.
 * Returns true when the signature matches.
 */
export function verifyPaymentSignature({ orderId, paymentId, signature }) {
  if (!keySecret) {
    throw new Error("Razorpay secret is not configured");
  }
  const body = `${orderId}|${paymentId}`;
  const expected = crypto.createHmac("sha256", keySecret).update(body).digest("hex");
  return expected === signature;
}

/**
 * Verify a Razorpay webhook signature using the RAW request body.
 * Returns true when the signature matches.
 */
export function verifyWebhookSignature(rawBody, signature) {
  if (!webhookSecret) {
    throw new Error("Razorpay webhook secret is not configured");
  }
  const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
  return expected === signature;
}

/** Fetch a payment from Razorpay (server-side verification). */
export async function fetchPayment(paymentId) {
  if (!razorpay) {
    throw new Error("Razorpay is not configured on the server");
  }
  return razorpay.payments.fetch(paymentId);
}

/** Fetch an order from Razorpay (server-side verification). */
export async function fetchOrder(orderId) {
  if (!razorpay) {
    throw new Error("Razorpay is not configured on the server");
  }
  return razorpay.orders.fetch(orderId);
}
