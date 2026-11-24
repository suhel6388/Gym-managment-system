// ---------------------------------------------------------------------------
// Platform subscription pricing — the ONLY place order amounts are computed.
//
// Rules:
//   base (paise) - discount (paise) + GST = total (paise)
//   * All values are integers in paise. No floats are accepted from clients.
//   * The client sends `planId` and an optional `couponCode`; never an amount.
//   * Coupons and plan-level discounts are applied before GST.
//   * GST is charged on the discounted taxable amount (GST-exclusive pricing).
//   * Every function is pure and unit-tested (tests/pricing-service.test.js).
// ---------------------------------------------------------------------------

import { badRequest } from "../utils/http-error.js";

/** GST above this is almost certainly a configuration mistake. */
export const MAX_GST_PERCENT = 50;

/** Assert an integer paise value and return it. */
export function assertPaise(value, field = "amount") {
  if (!Number.isInteger(value)) {
    throw badRequest(`${field} must be an integer amount in paise`, "INVALID_AMOUNT");
  }
  if (value < 0) {
    throw badRequest(`${field} cannot be negative`, "INVALID_AMOUNT");
  }
  return value;
}

function normalizePercent(value, field) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0 || value > MAX_GST_PERCENT) {
    throw badRequest(
      `${field} must be a whole number between 0 and ${MAX_GST_PERCENT}`,
      "INVALID_PERCENT",
    );
  }
  return value;
}

/**
 * Compute the total discount for an order.
 *
 * @param {object} input
 * @param {number} input.basePricePaise
 * @param {number} [input.planDiscountPaise] Super-admin flat discount.
 * @param {{code: string, percent: number, maxDiscountPaise?: number|null}|null} [input.coupon]
 * @returns {{ planDiscountPaise: number, couponDiscountPaise: number, totalDiscountPaise: number }}
 */
export function computeDiscount({
  basePricePaise,
  planDiscountPaise = 0,
  coupon = null,
}) {
  const base = assertPaise(basePricePaise, "basePricePaise");
  const planDiscount = Math.min(assertPaise(planDiscountPaise, "planDiscountPaise"), base);

  let couponDiscount = 0;
  if (coupon) {
    if (!Number.isFinite(coupon.percent) || coupon.percent <= 0 || coupon.percent > 100) {
      throw badRequest("Coupon percentage is invalid", "INVALID_COUPON");
    }

    // Percentage is calculated on the list price, then capped by the coupon's
    // own maximum and by whatever discount room is left after the plan offer.
    const percentDiscount = Math.round((base * coupon.percent) / 100);
    const couponMax =
      coupon.maxDiscountPaise === null || coupon.maxDiscountPaise === undefined
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Math.floor(coupon.maxDiscountPaise));

    couponDiscount = Math.max(
      0,
      Math.min(percentDiscount, couponMax, base - planDiscount),
    );
  }

  return {
    planDiscountPaise: planDiscount,
    couponDiscountPaise: couponDiscount,
    totalDiscountPaise: planDiscount + couponDiscount,
  };
}

/**
 * GST on the taxable (post-discount) amount. Rounded once, half-up.
 * @param {number} taxableAmountPaise
 * @param {number} gstPercent whole percent, 0..MAX_GST_PERCENT
 */
export function computeGst(taxableAmountPaise, gstPercent = 0) {
  const taxable = assertPaise(taxableAmountPaise, "taxableAmountPaise");
  const percent = normalizePercent(gstPercent, "gstPercent");
  return Math.round((taxable * percent) / 100);
}

/**
 * Full server-side price calculation.
 *
 * @param {object} input
 * @param {number} input.basePricePaise
 * @param {number} [input.gstPercent]
 * @param {number} [input.planDiscountPaise]
 * @param {{code: string, percent: number, maxDiscountPaise?: number|null}|null} [input.coupon]
 * @returns {{
 *   base: number, discount: number, couponDiscount: number,
 *   taxableAmount: number, gst: number, total: number,
 *   gstPercent: number, couponCode: string|null, couponPercent: number
 * }}
 */
export function calculatePricing({
  basePricePaise,
  gstPercent = 0,
  planDiscountPaise = 0,
  coupon = null,
}) {
  const base = assertPaise(basePricePaise, "basePricePaise");
  const percent = normalizePercent(gstPercent, "gstPercent");
  const { planDiscountPaise: planDiscount, couponDiscountPaise, totalDiscountPaise } =
    computeDiscount({ basePricePaise: base, planDiscountPaise, coupon });

  const taxableAmount = base - totalDiscountPaise;
  const gst = computeGst(taxableAmount, percent);
  const total = taxableAmount + gst;

  return {
    base,
    discount: planDiscount,
    couponDiscount: couponDiscountPaise,
    taxableAmount,
    gst,
    total,
    gstPercent: percent,
    couponCode: coupon?.code ?? null,
    couponPercent: coupon ? coupon.percent : 0,
  };
}

/**
 * Money helper for admin tooling / seeds: rupees to integer paise.
 * Accepts a number or a numeric string; rejects fractional paise.
 */
export function rupeesToPaise(rupees) {
  const value = typeof rupees === "string" ? Number(rupees.replace(/,/g, "").trim()) : rupees;
  if (!Number.isFinite(value) || value < 0) {
    throw badRequest("Invalid rupee amount", "INVALID_AMOUNT");
  }
  const paise = Math.round(value * 100);
  if (Math.abs(paise - value * 100) > 1e-6) {
    throw badRequest("Amount cannot have fractional paise", "INVALID_AMOUNT");
  }
  return paise;
}

/** Format integer paise as a plain rupee string (no symbol, 2 decimals). */
export function paiseToRupees(paise) {
  return (assertPaise(paise, "paise") / 100).toFixed(2);
}

/** Format integer paise as standard INR currency string. */
export function formatInrPaise(paise) {
  return `₹${paiseToRupees(paise)}`;
}
