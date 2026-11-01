/**
 * Transactional membership-payment recording.
 *
 * The controller runs this inside `prisma.$transaction`, so the payment row,
 * its allocation to a membership and the immutable receipt snapshot commit (or
 * roll back) together. The module receives the Prisma client as an argument so
 * unit tests can supply a fake and so the same code runs in a transaction.
 */

import {
  RECEIPT_VERSION,
  computeMembershipBalance,
  formatReceiptNumber,
  sanitizeReceiptPrefix,
  toPaise,
} from "./receipt.service.js";

export const MAX_RECEIPT_ATTEMPTS = 5;
export const SUCCESS_STATUS = "SUCCESS";

export class PaymentDomainError extends Error {
  constructor(message, status = 400, code = "PAYMENT_ERROR") {
    super(message);
    this.name = "PaymentDomainError";
    this.status = status;
    this.code = code;
  }
}

/** A concurrent duplicate submission — the caller should return the original. */
export class DuplicatePaymentError extends Error {
  constructor(idempotencyKey) {
    super("This payment was already recorded.");
    this.name = "DuplicatePaymentError";
    this.code = "DUPLICATE_PAYMENT";
    this.idempotencyKey = idempotencyKey;
  }
}

export function isIdempotencyConflict(error) {
  if (error instanceof DuplicatePaymentError) return true;
  if (error?.code !== "P2002") return false;
  const target = error?.meta?.target;
  if (Array.isArray(target)) return target.includes("idempotencyKey");
  return String(target ?? error?.meta?.constraint ?? error?.message ?? "").includes(
    "idempotencyKey",
  );
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Sums successful payments allocated to one membership. Legacy payments (from
 * before `membershipId` existed) fall back to the membership date window, which
 * is exactly how the memberships screen attributed them.
 */
export async function getMembershipPaidPaise(client, membership) {
  const aggregate = await client.paymentAllocation.aggregate({
    where: {
      membershipId: membership.id,
      payment: { status: SUCCESS_STATUS },
    },
    _sum: { amount: true },
  });
  const allocated = toPaise(aggregate?._sum?.amount);
  if (allocated > 0) return allocated;

  const legacy = await client.payment.findMany({
    where: {
      gymId: membership.gymId,
      memberId: membership.memberId,
      membershipId: null,
      status: SUCCESS_STATUS,
      paymentDate: { gte: membership.startDate, lte: membership.endDate },
    },
    select: { amount: true },
  });
  return (legacy ?? []).reduce((sum, row) => sum + toPaise(row.amount), 0);
}

export async function getMembershipTotals(client, membership) {
  const paidPaise = await getMembershipPaidPaise(client, membership);
  return computeMembershipBalance({
    pricePaise: membership.pricePaise,
    discountPaise: membership.discountPaise,
    paidPaise,
  });
}

function buildSnapshot({ payment, member, membership, totals, now }) {
  const plan = membership?.plan ?? null;
  return {
    version: RECEIPT_VERSION,
    receiptNumber: payment.receiptNumber,
    issuedAt: iso(now),
    member: {
      id: member.id,
      code: member.memberCode,
      name: member.name,
      phone: member.phone,
      email: member.email ?? null,
    },
    membershipId: membership?.id ?? null,
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          durationMonths: plan.durationMonths,
          description: plan.description ?? null,
        }
      : null,
    membership: membership
      ? {
          id: membership.id,
          startDate: iso(membership.startDate),
          endDate: iso(membership.endDate),
        }
      : null,
    fees: {
      subtotalPaise: totals.subtotalPaise,
      discountPaise: totals.discountPaise,
      totalPaise: totals.totalPaise,
      paidPaise: totals.paidPaise,
      priorPaidPaise: Math.max(0, totals.paidPaise - toPaise(payment.amount)),
      balancePaise: totals.balancePaise,
    },
    payment: {
      amountPaise: toPaise(payment.amount),
      mode: payment.paymentMode,
      date: iso(payment.paymentDate),
      reference: payment.reference ?? null,
      status: payment.status,
    },
  };
}

/**
 * Records one membership payment.
 *
 * @param {object} options
 * @param {object} options.client Prisma client or transaction client.
 * @param {string} options.gymId Authenticated gym — never from the body.
 * @param {string} options.memberId
 * @param {string} [options.membershipId] Defaults to the member's latest membership.
 * @param {number} options.amountPaise Positive integer paise.
 * @param {string} options.paymentMode
 * @param {string|null} [options.reference]
 * @param {Date} [options.paymentDate]
 * @param {string} [options.status]
 * @param {string|null} [options.idempotencyKey]
 * @param {string} [options.receiptPrefix]
 * @param {Date} [options.now]
 */
export async function recordMembershipPayment({
  client,
  gymId,
  memberId,
  membershipId = null,
  amountPaise,
  paymentMode,
  reference = null,
  paymentDate = new Date(),
  status = SUCCESS_STATUS,
  idempotencyKey = null,
  receiptPrefix = "RCPT",
  now = new Date(),
}) {
  if (!gymId) throw new PaymentDomainError("Gym context is required", 403);
  const amount = toPaise(amountPaise);
  if (!Number.isFinite(Number(amountPaise)) || amount <= 0) {
    throw new PaymentDomainError(
      "Enter a payment amount greater than zero.",
      400,
      "INVALID_AMOUNT",
    );
  }

  const key = idempotencyKey ? String(idempotencyKey).trim().slice(0, 120) : null;
  if (key) {
    const existing = await client.payment.findFirst({
      where: { gymId, idempotencyKey: key },
      include: {
        member: true,
        membership: { include: { plan: true } },
      },
    });
    if (existing) {
      return {
        payment: existing,
        member: existing.member,
        membership: existing.membership,
        duplicate: true,
      };
    }
  }

  const member = await client.member.findFirst({
    where: { id: memberId, gymId, archivedAt: null },
    select: {
      id: true,
      memberCode: true,
      name: true,
      phone: true,
      email: true,
    },
  });
  if (!member) {
    throw new PaymentDomainError("Member not found", 404, "MEMBER_NOT_FOUND");
  }

  let membership = null;
  if (membershipId) {
    membership = await client.membership.findFirst({
      where: { id: membershipId, gymId, memberId: member.id },
      include: { plan: true },
    });
    if (!membership) {
      throw new PaymentDomainError(
        "Membership not found for this member",
        404,
        "MEMBERSHIP_NOT_FOUND",
      );
    }
  } else {
    membership = await client.membership.findFirst({
      where: { gymId, memberId: member.id },
      orderBy: { endDate: "desc" },
      include: { plan: true },
    });
  }

  const prefix = sanitizeReceiptPrefix(receiptPrefix);
  let lastError = null;

  for (let attempt = 0; attempt < MAX_RECEIPT_ATTEMPTS; attempt += 1) {
    const count = await client.payment.count({ where: { gymId } });
    const receiptNumber = formatReceiptNumber(prefix, count + 1 + attempt);

    try {
      const created = await client.payment.create({
        data: {
          gymId,
          memberId: member.id,
          membershipId: membership?.id ?? null,
          amount,
          paymentMode,
          receiptNumber,
          reference: reference ? String(reference).trim().slice(0, 191) : null,
          paymentDate,
          status,
          idempotencyKey: key,
          receiptIssuedAt: now,
        },
        include: {
          member: true,
          membership: { include: { plan: true } },
        },
      });

      if (membership) {
        await client.paymentAllocation.create({
          data: {
            paymentId: created.id,
            membershipId: membership.id,
            amount,
          },
        });
      }

      const totals = membership
        ? await getMembershipTotals(client, membership)
        : computeMembershipBalance({
            pricePaise: amount,
            discountPaise: 0,
            paidPaise: amount,
          });

      const snapshot = buildSnapshot({
        payment: created,
        member,
        membership,
        totals,
        now,
      });

      const payment = await client.payment.update({
        where: { id: created.id },
        data: {
          receiptIssuedAt: now,
          receiptData: snapshot,
        },
        include: {
          member: true,
          membership: { include: { plan: true } },
        },
      });

      return { payment, member, membership, totals, duplicate: false };
    } catch (error) {
      if (isIdempotencyConflict(error)) {
        throw new DuplicatePaymentError(key);
      }
      // Only the auto-allocated receipt number may be retried.
      if (error?.code === "P2002" && attempt < MAX_RECEIPT_ATTEMPTS - 1) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw new PaymentDomainError(
    "Could not allocate a receipt number. Please retry.",
    409,
    "RECEIPT_NUMBER_CONFLICT",
  );
}
