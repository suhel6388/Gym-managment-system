/**
 * Loads everything a receipt needs and assembles the shared JSON payload.
 *
 * A saved `Payment.receiptData` snapshot is authoritative for member, plan and
 * money figures so reprinting an old receipt never reflects a newer plan price.
 * Current branding (logo, footer, QR toggle) always comes from live settings.
 */

import {
  buildReceiptPayload,
  computeMembershipBalance,
  resolveBranding,
  signReceiptToken,
  toPaise,
} from "./receipt.service.js";
import { getMembershipTotals, PaymentDomainError } from "./payment.service.js";

export function receiptPublicBaseUrl(req) {
  const configured = (
    process.env.RECEIPT_PUBLIC_BASE_URL ||
    process.env.PUBLIC_API_URL ||
    ""
  ).trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

function snapshotMember(snapshot) {
  if (!snapshot?.member) return null;
  return {
    id: snapshot.member.id,
    memberCode: snapshot.member.code,
    name: snapshot.member.name,
    phone: snapshot.member.phone,
    email: snapshot.member.email ?? null,
  };
}

function snapshotMembership(snapshot) {
  if (!snapshot?.membership) return null;
  return {
    id: snapshot.membership.id,
    startDate: snapshot.membership.startDate,
    endDate: snapshot.membership.endDate,
    plan: snapshot.plan
      ? {
          id: snapshot.plan.id,
          name: snapshot.plan.name,
          durationMonths: snapshot.plan.durationMonths,
          description: snapshot.plan.description ?? "",
        }
      : null,
  };
}

export async function loadReceiptPayload({
  client,
  paymentId,
  gymId = null,
  baseUrl,
  now = new Date(),
}) {
  let payment;
  try {
    payment = await client.payment.findFirst({
      where: {
        id: paymentId,
        ...(gymId ? { gymId } : {}),
      },
      include: {
        member: true,
      },
    });
  } catch (lookupErr) {
    payment = await client.payment.findFirst({
      where: {
        id: paymentId,
        ...(gymId ? { gymId } : {}),
      },
    });
    if (payment && payment.memberId) {
      payment.member = await client.member
        .findUnique({ where: { id: payment.memberId } })
        .catch(() => null);
    }
  }

  if (!payment) {
    throw new PaymentDomainError("Receipt not found", 404, "RECEIPT_NOT_FOUND");
  }

  if (payment.membershipId) {
    payment.membership = await client.membership
      .findUnique({
        where: { id: payment.membershipId },
        include: { plan: true },
      })
      .catch(() => null);
  } else if (!payment.membership && payment.memberId) {
    payment.membership = await client.membership
      .findFirst({
        where: { gymId: payment.gymId, memberId: payment.memberId },
        orderBy: { endDate: "desc" },
        include: { plan: true },
      })
      .catch(() => null);
  }

  let gym;
  try {
    gym = await client.gym.findUnique({
      where: { id: payment.gymId },
      include: { receiptSettings: true },
    });
  } catch {
    gym = await client.gym.findUnique({
      where: { id: payment.gymId },
    });
    if (gym) gym.receiptSettings = null;
  }
  if (!gym) {
    throw new PaymentDomainError("Gym not found", 404, "GYM_NOT_FOUND");
  }

  const snapshot =
    payment.receiptData && typeof payment.receiptData === "object"
      ? payment.receiptData
      : null;

  const member = snapshotMember(snapshot) ?? payment.member;
  const membership = snapshotMembership(snapshot) ?? payment.membership;

  let totals;
  if (snapshot?.fees) {
    totals = {
      subtotalPaise: toPaise(snapshot.fees.subtotalPaise),
      discountPaise: toPaise(snapshot.fees.discountPaise),
      totalPaise: toPaise(snapshot.fees.totalPaise),
      paidPaise: toPaise(snapshot.fees.paidPaise),
      balancePaise: toPaise(snapshot.fees.balancePaise),
    };
  } else if (payment.membership) {
    totals = await getMembershipTotals(client, payment.membership);
  } else {
    totals = computeMembershipBalance({
      pricePaise: payment.amount,
      discountPaise: 0,
      paidPaise: payment.amount,
    });
  }

  const branding = resolveBranding({
    gym,
    settings: gym.receiptSettings,
  });

  const { token, expiresAt } = signReceiptToken(payment.id);
  const pdfUrl = `${String(baseUrl).replace(/\/+$/, "")}/api/v1/receipts/public/${encodeURIComponent(
    payment.id,
  )}/pdf?token=${encodeURIComponent(token)}`;

  const receipt = buildReceiptPayload({
    payment,
    member,
    membership,
    totals,
    branding,
    links: { pdf: pdfUrl, expiresAt },
    now,
  });

  return { payment, gym, settings: gym.receiptSettings, branding, receipt };
}

/** Public payloads must never carry another gym's data or raw credentials. */
export function receiptResponse(receipt) {
  return {
    ...receipt,
    links: {
      pdf: receipt.links?.pdf ?? "",
      expiresAt: receipt.links?.expiresAt ?? null,
    },
  };
}
