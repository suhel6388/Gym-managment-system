import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertPaise,
  computeDiscount,
  computeGst,
  calculatePricing,
  rupeesToPaise,
  paiseToRupees,
  formatInrPaise,
  MAX_GST_PERCENT,
} from "../src/services/pricing.service.js";

test("assertPaise accepts valid integer paise and rejects invalid values", () => {
  assert.equal(assertPaise(0), 0);
  assert.equal(assertPaise(49900), 49900);
  assert.equal(assertPaise(100000), 100000);

  assert.throws(() => assertPaise(-1), (err) => err.code === "INVALID_AMOUNT");
  assert.throws(() => assertPaise(49.9), (err) => err.code === "INVALID_AMOUNT");
  assert.throws(() => assertPaise(NaN), (err) => err.code === "INVALID_AMOUNT");
  assert.throws(() => assertPaise("500"), (err) => err.code === "INVALID_AMOUNT");
});

test("computeDiscount applies plan discount and caps it at base price", () => {
  const result = computeDiscount({
    basePricePaise: 49900,
    planDiscountPaise: 10000,
  });
  assert.equal(result.planDiscountPaise, 10000);
  assert.equal(result.couponDiscountPaise, 0);
  assert.equal(result.totalDiscountPaise, 10000);

  // Discount exceeding base is clamped
  const clamped = computeDiscount({
    basePricePaise: 49900,
    planDiscountPaise: 60000,
  });
  assert.equal(clamped.planDiscountPaise, 49900);
  assert.equal(clamped.totalDiscountPaise, 49900);
});

test("computeDiscount applies coupon percentage and respects max cap", () => {
  // 10% on 49900 = 4990
  const result = computeDiscount({
    basePricePaise: 49900,
    coupon: { code: "TEST10", percent: 10, maxDiscountPaise: null },
  });
  assert.equal(result.planDiscountPaise, 0);
  assert.equal(result.couponDiscountPaise, 4990);
  assert.equal(result.totalDiscountPaise, 4990);

  // Coupon with max discount cap
  const capped = computeDiscount({
    basePricePaise: 100000, // ₹1,000
    coupon: { code: "FLATMAX", percent: 20, maxDiscountPaise: 10000 }, // 20% would be 20000, capped at 10000
  });
  assert.equal(capped.couponDiscountPaise, 10000);
  assert.equal(capped.totalDiscountPaise, 10000);
});

test("computeGst calculates rounded GST on taxable amount", () => {
  // 18% on ₹1,000 (100000 paise) = 18000 paise
  assert.equal(computeGst(100000, 18), 18000);

  // 18% on ₹449.10 (44910 paise) = 8083.8 -> 8084 paise
  assert.equal(computeGst(44910, 18), 8084);

  // 0% GST
  assert.equal(computeGst(50000, 0), 0);

  // Error on invalid GST percentage
  assert.throws(() => computeGst(50000, -5), (err) => err.code === "INVALID_PERCENT");
  assert.throws(() => computeGst(50000, MAX_GST_PERCENT + 1), (err) => err.code === "INVALID_PERCENT");
});

test("calculatePricing end-to-end pricing calculation with GST & coupons", () => {
  // Basic plan: ₹499 base, 18% GST, no discount
  const basic = calculatePricing({
    basePricePaise: 49900,
    gstPercent: 18,
  });
  assert.equal(basic.base, 49900);
  assert.equal(basic.discount, 0);
  assert.equal(basic.couponDiscount, 0);
  assert.equal(basic.taxableAmount, 49900);
  assert.equal(basic.gst, 8982); // 49900 * 0.18 = 8982
  assert.equal(basic.total, 58882); // 49900 + 8982 = 58882

  // Pro plan with 10% coupon: ₹999 base, 10% off, 18% GST
  const proWithCoupon = calculatePricing({
    basePricePaise: 99900,
    gstPercent: 18,
    coupon: { code: "PRO10", percent: 10, maxDiscountPaise: null },
  });
  assert.equal(proWithCoupon.base, 99900);
  assert.equal(proWithCoupon.couponDiscount, 9990); // 10% of 99900
  assert.equal(proWithCoupon.taxableAmount, 89910); // 99900 - 9990
  assert.equal(proWithCoupon.gst, 16184); // 89910 * 0.18 = 16183.8 -> 16184
  assert.equal(proWithCoupon.total, 106094); // 89910 + 16184
});

test("rupeesToPaise and paiseToRupees convert accurately", () => {
  assert.equal(rupeesToPaise(499), 49900);
  assert.equal(rupeesToPaise("499.50"), 49950);
  assert.equal(paiseToRupees(49900), "499.00");
  assert.equal(formatInrPaise(49900), "₹499.00");
  assert.equal(formatInrPaise(58882), "₹588.82");
  assert.equal(formatInrPaise(0), "₹0.00");
});
