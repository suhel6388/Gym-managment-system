import test from "node:test";
import assert from "node:assert/strict";

import {
  PaymentDomainError,
  getMembershipTotals,
  isIdempotencyConflict,
  recordMembershipPayment,
} from "../src/services/payment.service.js";
import { loadReceiptPayload } from "../src/services/receipt-loader.service.js";

const GYM_ID = "gym_1";

const member = {
  id: "mem_1",
  gymId: GYM_ID,
  memberCode: "MEM-0102",
  name: "Priya Sharma",
  phone: "9876543210",
  email: "priya@example.com",
};

const membership = {
  id: "ms_1",
  gymId: GYM_ID,
  memberId: member.id,
  pricePaise: 500000,
  discountPaise: 50000,
  startDate: new Date("2026-11-01T00:00:00.000Z"),
  endDate: new Date("2026-11-30T00:00:00.000Z"),
  plan: {
    id: "plan_1",
    name: "Gold Monthly",
    durationMonths: 1,
    description: "Full gym access",
  },
};

/**
 * Minimal Prisma double. It enforces gym scoping the same way the real query
 * does, so a receipt/payment can never be recorded for another gym.
 */
function makeClient({
  gymId = GYM_ID,
  startingPayments = 0,
  startingPaidPaise = 0,
  existingPayment = null,
} = {}) {
  const state = {
    payments: [],
    allocations: [],
    created: 0,
    createCalls: 0,
    allocationCalls: 0,
    updates: [],
  };
  state.allocations.push(...(startingPaidPaise ? [{ membershipId: membership.id, amount: startingPaidPaise }] : []));
  state.created = startingPayments;

  const client = {
    payment: {
      findFirst: async ({ where }) => {
        if (where.idempotencyKey && existingPayment) {
          return where.gymId === existingPayment.gymId ? existingPayment : null;
        }
        return null;
      },
      count: async ({ where }) =>
        where.gymId === gymId ? state.created + state.payments.length : 0,
      create: async ({ data }) => {
        state.createCalls += 1;
        const row = {
          id: `pay_${state.payments.length + 1}`,
          ...data,
        };
        state.payments.push(row);
        return {
          ...row,
          member,
          membership: { ...membership, plan: membership.plan },
        };
      },
      update: async ({ where, data }) => {
        state.updates.push({ where, data });
        const row = state.payments.find((payment) => payment.id === where.id);
        Object.assign(row, data);
        return {
          ...row,
          member,
          membership: { ...membership, plan: membership.plan },
        };
      },
    },
    member: {
      findFirst: async ({ where }) =>
        where.gymId === member.gymId ? member : null,
    },
    membership: {
      findFirst: async ({ where }) =>
        where.gymId === member.gymId &&
        where.memberId === member.id &&
        where.id === membership.id
          ? membership
          : null,
      // `recordMembershipPayment` re-reads the membership for a duplicate
      // idempotency-key response; the payment row only stores its id.
      findUnique: async ({ where }) =>
        where.id === membership.id
          ? { ...membership, plan: membership.plan }
          : null,
    },
    paymentAllocation: {
      create: async ({ data }) => {
        state.allocationCalls += 1;
        state.allocations.push(data);
        return data;
      },
      aggregate: async ({ where }) => ({
        _sum: {
          amount: state.allocations
            .filter((allocation) => allocation.membershipId === where.membershipId)
            .reduce((sum, allocation) => sum + allocation.amount, 0),
        },
      }),
    },
  };

  return { client, state };
}

test("a successful payment returns a receipt snapshot with correct balances", async () => {
  const { client, state } = makeClient();

  const result = await recordMembershipPayment({
    client,
    gymId: GYM_ID,
    memberId: member.id,
    membershipId: membership.id,
    amountPaise: 150000,
    paymentMode: "UPI",
    reference: "UPI-1",
    receiptPrefix: "DG",
    now: new Date("2026-11-01T10:00:00.000Z"),
  });

  assert.equal(result.duplicate, false);
  assert.equal(state.createCalls, 1);
  assert.equal(state.allocationCalls, 1);

  const created = state.payments[0];
  assert.equal(created.receiptNumber, "DG-0001");
  assert.equal(created.amount, 150000);
  assert.equal(created.membershipId, membership.id);
  assert.equal(created.status, "SUCCESS");

  assert.equal(state.allocations.at(-1).amount, 150000);
  assert.equal(state.allocations.at(-1).membershipId, membership.id);

  assert.equal(result.totals.totalPaise, 450000);
  assert.equal(result.totals.paidPaise, 150000);
  assert.equal(result.totals.balancePaise, 300000);

  const snapshot = result.payment.receiptData;
  assert.equal(snapshot.member.code, "MEM-0102");
  assert.equal(snapshot.plan.name, "Gold Monthly");
  assert.equal(snapshot.fees.subtotalPaise, 500000);
  assert.equal(snapshot.fees.discountPaise, 50000);
  assert.equal(snapshot.fees.totalPaise, 450000);
  assert.equal(snapshot.fees.paidPaise, 150000);
  assert.equal(snapshot.fees.priorPaidPaise, 0);
  assert.equal(snapshot.fees.balancePaise, 300000);
  assert.equal(snapshot.payment.mode, "UPI");
  assert.ok(result.payment.receiptIssuedAt instanceof Date);
});

test("a second instalment records the earlier amount as priorPaid", async () => {
  const { client, state } = makeClient({
    startingPayments: 1,
    startingPaidPaise: 150000,
  });

  const result = await recordMembershipPayment({
    client,
    gymId: GYM_ID,
    memberId: member.id,
    membershipId: membership.id,
    amountPaise: 100000,
    paymentMode: "CASH",
    receiptPrefix: "DG",
  });

  assert.equal(state.payments[0].receiptNumber, "DG-0002");
  assert.equal(result.totals.paidPaise, 250000);
  assert.equal(result.totals.balancePaise, 200000);
  assert.equal(result.payment.receiptData.fees.priorPaidPaise, 150000);
});

test("a retried idempotency key returns the original payment without creating a new one", async () => {
  const existingPayment = {
    id: "pay_existing",
    gymId: GYM_ID,
    membershipId: membership.id,
    amount: 150000,
    status: "SUCCESS",
    receiptNumber: "DG-0007",
    member,
    membership: { ...membership, plan: membership.plan },
  };
  const { client, state } = makeClient({ existingPayment });

  const result = await recordMembershipPayment({
    client,
    gymId: GYM_ID,
    memberId: member.id,
    membershipId: membership.id,
    amountPaise: 150000,
    paymentMode: "CASH",
    idempotencyKey: "rcpt-same-submit-key",
  });

  assert.equal(result.duplicate, true);
  assert.equal(result.payment.id, "pay_existing");
  assert.equal(state.createCalls, 0);
  assert.equal(state.allocationCalls, 0);
});

test("the same idempotency key from another gym is not returned", async () => {
  const existingPayment = {
    id: "pay_existing",
    gymId: GYM_ID,
    amount: 150000,
    status: "SUCCESS",
    member,
    membership: { ...membership, plan: membership.plan },
  };
  const { client } = makeClient({ existingPayment, gymId: "gym_2" });

  await assert.rejects(
    recordMembershipPayment({
      client,
      gymId: "gym_2",
      memberId: member.id,
      membershipId: membership.id,
      amountPaise: 150000,
      paymentMode: "CASH",
      idempotencyKey: "rcpt-same-submit-key",
    }),
    (error) => {
      assert.equal(error instanceof PaymentDomainError, true);
      assert.equal(error.code, "MEMBER_NOT_FOUND");
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test("a payment cannot use another gym's membership", async () => {
  const { client } = makeClient();
  await assert.rejects(
    recordMembershipPayment({
      client,
      gymId: GYM_ID,
      memberId: member.id,
      membershipId: "ms_other_gym",
      amountPaise: 50000,
      paymentMode: "CASH",
    }),
    (error) => {
      assert.equal(error.code, "MEMBERSHIP_NOT_FOUND");
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test("a failed status still never records a receipt for another gym", async () => {
  const { client } = makeClient();
  await assert.rejects(
    recordMembershipPayment({
      client,
      gymId: "gym_2",
      memberId: member.id,
      amountPaise: 100,
      paymentMode: "CASH",
      status: "FAILED",
    }),
    (error) => {
      assert.equal(error.code, "MEMBER_NOT_FOUND");
      return true;
    },
  );
});

test("receipt loading is scoped to the authenticated gym", async () => {
  const client = {
    payment: {
      findFirst: async ({ where }) => {
        if (where.gymId && where.gymId !== GYM_ID) return null;
        return {
          id: "pay_1",
          gymId: GYM_ID,
          memberId: member.id,
          amount: 150000,
          paymentMode: "CASH",
          paymentDate: new Date(),
          status: "SUCCESS",
          receiptNumber: "DG-0001",
          member,
          membership: { ...membership, plan: membership.plan },
          receiptData: null,
        };
      },
    },
    gym: { findUnique: async () => ({ id: GYM_ID, name: "DarkGold Gym", receiptSettings: null }) },
    paymentAllocation: { aggregate: async () => ({ _sum: { amount: 150000 } }) },
    membership: {},
  };

  await assert.rejects(
    loadReceiptPayload({
      client,
      paymentId: "pay_1",
      gymId: "gym_2",
      baseUrl: "https://example.com",
    }),
    (error) => {
      assert.equal(error.code, "RECEIPT_NOT_FOUND");
      return true;
    },
  );

  const payload = await loadReceiptPayload({
    client,
    paymentId: "pay_1",
    gymId: GYM_ID,
    baseUrl: "https://example.com",
  });
  assert.equal(payload.receipt.receiptNumber, "DG-0001");
});

test("getMembershipTotals uses successful allocations", async () => {
  const { client } = makeClient({ startingPaidPaise: 125000 });
  const totals = await getMembershipTotals(client, membership);
  assert.equal(totals.subtotalPaise, 500000);
  assert.equal(totals.totalPaise, 450000);
  assert.equal(totals.paidPaise, 125000);
  assert.equal(totals.balancePaise, 325000);
});

test("Prisma uniqueness errors on idempotencyKey are treated as duplicates", () => {
  assert.equal(
    isIdempotencyConflict({ code: "P2002", meta: { target: ["gymId", "idempotencyKey"] } }),
    true,
  );
  assert.equal(
    isIdempotencyConflict({ code: "P2002", meta: { target: ["gymId", "receiptNumber"] } }),
    false,
  );
  assert.equal(isIdempotencyConflict(new Error("other")), false);
});
