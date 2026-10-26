import test from "node:test";
import assert from "node:assert/strict";

import { memberInput } from "../src/utils/validation.js";

const requiredFields = {
  name: "Rahul Sharma",
  phone: "9876543210",
  gender: "male",
  dateOfBirth: "1998-04-21",
  timing: "MORNING",
};

test("memberInput accepts the five required fields on their own", () => {
  const parsed = memberInput.parse(requiredFields);

  assert.equal(parsed.name, "Rahul Sharma");
  assert.equal(parsed.phone, "9876543210");
  assert.equal(parsed.gender, "male");
  assert.ok(parsed.dateOfBirth instanceof Date);
  assert.equal(parsed.timing, "MORNING");
});

test("memberInput leaves email, address, joinedAt and notes optional", () => {
  const parsed = memberInput.parse(requiredFields);

  assert.equal(parsed.email, undefined);
  assert.equal(parsed.address, undefined);
  assert.equal(parsed.joinedAt, undefined);
  assert.equal(parsed.notes, undefined);
});

test("memberInput rejects each missing required field", () => {
  for (const field of ["name", "phone", "gender", "dateOfBirth", "timing"]) {
    const body = { ...requiredFields };
    delete body[field];

    assert.throws(
      () => memberInput.parse(body),
      (error) => error?.name === "ZodError",
      `expected a ZodError when ${field} is missing`,
    );
  }
});

test("memberInput requires a valid batch timing", () => {
  assert.throws(
    () => memberInput.parse({ ...requiredFields, timing: undefined }),
    /Batch timing is required/,
  );
  assert.throws(
    () => memberInput.parse({ ...requiredFields, timing: "NIGHT" }),
    /Batch timing must be/i,
  );
});

test("memberInput rejects a future date of birth", () => {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);

  assert.throws(
    () =>
      memberInput.parse({
        ...requiredFields,
        dateOfBirth: future.toISOString().slice(0, 10),
      }),
    /future/i,
  );
});

test("memberInput accepts an empty email as omitted and validates a real one", () => {
  assert.equal(memberInput.parse({ ...requiredFields, email: "" }).email, undefined);

  assert.throws(
    () => memberInput.parse({ ...requiredFields, email: "not-an-email" }),
    (error) => error?.name === "ZodError",
  );

  assert.equal(
    memberInput.parse({ ...requiredFields, email: "member@example.com" }).email,
    "member@example.com",
  );
});

test("memberInput.partial() allows patching only the changed field", () => {
  const parsed = memberInput.partial().parse({ notes: "Updated note" });

  assert.deepEqual(parsed, { notes: "Updated note" });
});
