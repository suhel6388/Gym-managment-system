import test from "node:test";
import assert from "node:assert/strict";

import { membershipInput } from "../src/utils/validation.js";

const requiredFields = {
  memberId: "member-1",
  planId: "plan-1",
  startDate: "2026-10-10",
  discountPaise: 0,
};

test("membershipInput accepts all required fields with a zero discount", () => {
  const parsed = membershipInput.parse(requiredFields);

  assert.equal(parsed.memberId, "member-1");
  assert.equal(parsed.planId, "plan-1");
  assert.ok(parsed.startDate instanceof Date);
  assert.equal(parsed.discountPaise, 0);
});

test("membershipInput rejects each missing required field", () => {
  for (const field of ["memberId", "planId", "startDate", "discountPaise"]) {
    const body = { ...requiredFields };
    delete body[field];

    assert.throws(
      () => membershipInput.parse(body),
      (error) => error?.name === "ZodError",
      `expected a ZodError when ${field} is missing`,
    );
  }
});

test("membershipInput requires a discount even when it is zero", () => {
  assert.throws(
    () => membershipInput.parse({ ...requiredFields, discountPaise: undefined }),
    /Discount is required/,
  );

  assert.equal(
    membershipInput.parse({ ...requiredFields, discountPaise: 0 }).discountPaise,
    0,
  );
});

test("membershipInput rejects negative and fractional discounts", () => {
  assert.throws(
    () => membershipInput.parse({ ...requiredFields, discountPaise: -100 }),
    (error) => error?.name === "ZodError",
  );
  assert.throws(
    () => membershipInput.parse({ ...requiredFields, discountPaise: 10.5 }),
    (error) => error?.name === "ZodError",
  );
});

test("membershipInput rejects an invalid start date", () => {
  assert.throws(
    () => membershipInput.parse({ ...requiredFields, startDate: "not-a-date" }),
    /valid start date/i,
  );
});
