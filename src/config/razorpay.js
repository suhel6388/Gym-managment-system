// Central Razorpay / platform-billing configuration.
//
// SECURITY:
//   - Only `publicKeyId()` may ever be sent to the browser.
//   - RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET stay in the API process.
//   - Nothing in this module logs a secret.

import "dotenv/config";
import { serviceUnavailable } from "../utils/http-error.js";

export const RAZORPAY_PROVIDER = "razorpay";
export const DEFAULT_CURRENCY = "INR";
/** GST is applied on top of the discounted taxable amount. */
export const DEFAULT_GST_PERCENT = 18;
/** A single Razorpay order is reused for this long before a new one is made. */
export const DEFAULT_PENDING_ORDER_TTL_MINUTES = 30;
/** Days after expiry during which access continues (renewal grace). */
export const DEFAULT_GRACE_PERIOD_DAYS = 3;

function intFromEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : fallback;
}

/**
 * Parse `PLATFORM_COUPONS` into a lookup map.
 *
 * Format: `CODE:PERCENT[:MAX_DISCOUNT_PAISE]` separated by commas.
 * Example: `LAUNCH10:10:50000,WELCOME500:5`
 *
 * A percentage coupon is always capped by the remaining taxable amount, so it
 * can never make an order negative. Coupons live in env (not the database) so
 * promo changes do not require a migration.
 */
export function parseCoupons(raw) {
  const coupons = new Map();
  if (!raw || typeof raw !== "string") return coupons;

  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const [rawCode, rawPercent, rawMax] = trimmed.split(":");
    const code = String(rawCode ?? "").trim().toUpperCase();
    const percent = Number(rawPercent);
    const maxDiscountPaise = rawMax === undefined ? null : Number(rawMax);

    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) continue;
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) continue;
    if (maxDiscountPaise !== null && (!Number.isInteger(maxDiscountPaise) || maxDiscountPaise < 0)) {
      continue;
    }

    coupons.set(code, {
      code,
      percent,
      maxDiscountPaise,
    });
  }

  return coupons;
}

const coupons = parseCoupons(process.env.PLATFORM_COUPONS);

export const platformBillingConfig = {
  provider: RAZORPAY_PROVIDER,
  currency: String(process.env.PLATFORM_CURRENCY || DEFAULT_CURRENCY).toUpperCase(),
  pendingOrderTtlMinutes: intFromEnv(
    "PLATFORM_PENDING_ORDER_TTL_MINUTES",
    DEFAULT_PENDING_ORDER_TTL_MINUTES,
  ),
  gracePeriodDays: intFromEnv("SUBSCRIPTION_GRACE_PERIOD_DAYS", DEFAULT_GRACE_PERIOD_DAYS),
  /** Razorpay rejects anything below ₹1. */
  minimumChargePaise: 100,
  maximumChargePaise: 100_000_000,
};

/** Resolve a coupon code (case-insensitive) or return null. */
export function findCoupon(code) {
  if (!code) return null;
  return coupons.get(String(code).trim().toUpperCase()) ?? null;
}

/** Public Razorpay key id. NEVER return the secret. */
export function publicKeyId() {
  return process.env.RAZORPAY_KEY_ID || null;
}

export function isRazorpayConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

export function isWebhookConfigured() {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
}


export function assertRazorpayConfigured() {
  if (!isRazorpayConfigured()) {
    throw serviceUnavailable(
      "Payment gateway is not configured",
      "PAYMENT_NOT_CONFIGURED",
    );
  }
}

/** Safe diagnostics for boot logs — no secrets. */
export function razorpayDiagnostics() {
  return {
    configured: isRazorpayConfigured(),
    webhookConfigured: isWebhookConfigured(),
    mode: process.env.RAZORPAY_KEY_ID?.startsWith("rzp_live_") ? "live" : "test",
    currency: platformBillingConfig.currency,
    coupons: coupons.size,
    pendingOrderTtlMinutes: platformBillingConfig.pendingOrderTtlMinutes,
  };
}
