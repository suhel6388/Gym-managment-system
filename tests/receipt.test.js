import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReceiptPayload,
  buildWhatsAppUrl,
  computeMembershipBalance,
  formatReceiptNumber,
  normalizePhoneForWhatsApp,
  renderFooterMessage,
  resolveBranding,
  signReceiptToken,
  verifyReceiptToken,
} from "../src/services/receipt.service.js";
import { generateReceiptPdf } from "../src/services/receipt-pdf.service.js";

const member = {
  id: "mem_1",
  memberCode: "MEM-0102",
  name: "Priya Sharma",
  phone: "98765 43210",
  email: "priya@example.com",
};

const membership = {
  id: "ms_1",
  startDate: new Date("2026-11-01T00:00:00.000Z"),
  endDate: new Date("2026-11-30T00:00:00.000Z"),
  plan: {
    id: "plan_1",
    name: "Gold Monthly",
    durationMonths: 1,
    description: "Full gym access",
  },
};

const branding = {
  gymName: "DarkGold Gym",
  tagline: "Premium Fitness Club",
  address: "12 MG Road, Bengaluru",
  phone: "+91 98765 43210",
  email: "hello@darkgoldgym.com",
  website: "www.darkgoldgym.com",
  footerMessage: "Thank you for choosing {gymName}, {memberName}!",
  authorizedSignatory: "Arjun Mehta",
  signatureDataUrl: null,
  logoDataUrl: null,
  qrEnabled: true,
  receiptPrefix: "DG",
};

function makeReceipt({ amount = 150000, totals } = {}) {
  const payment = {
    id: "pay_1",
    receiptNumber: "DG-0042",
    amount,
    paymentMode: "UPI",
    paymentDate: new Date("2026-11-01T10:42:00.000Z"),
    status: "SUCCESS",
    reference: "UPI-8842199",
    receiptIssuedAt: new Date("2026-11-01T10:42:01.000Z"),
  };
  return buildReceiptPayload({
    payment,
    member,
    membership,
    totals:
      totals ??
      computeMembershipBalance({
        pricePaise: 450000,
        discountPaise: 0,
        paidPaise: amount,
      }),
    branding,
    links: { pdf: "https://example.com/receipt.pdf", expiresAt: null },
    now: new Date("2026-11-01T10:42:01.000Z"),
  });
}

test("receipt maths clamps discounts and balances", () => {
  assert.deepEqual(
    computeMembershipBalance({ pricePaise: 500000, discountPaise: 50000, paidPaise: 200000 }),
    {
      subtotalPaise: 500000,
      discountPaise: 50000,
      totalPaise: 450000,
      paidPaise: 200000,
      balancePaise: 250000,
    },
  );

  // A discount larger than the fee cannot create a negative total.
  assert.equal(
    computeMembershipBalance({ pricePaise: 100000, discountPaise: 200000 }).totalPaise,
    0,
  );

  // Prepayment/overpayment cannot create a negative outstanding balance.
  assert.equal(
    computeMembershipBalance({ pricePaise: 100000, paidPaise: 150000 }).balancePaise,
    0,
  );

  // Fractional legacy values are rounded to whole paise.
  assert.equal(
    computeMembershipBalance({ pricePaise: 1000.6, paidPaise: 99.4 }).paidPaise,
    99,
  );
});

test("receipt numbers are per-prefix and zero padded", () => {
  assert.equal(formatReceiptNumber("dg", 42), "DG-0042");
  assert.equal(formatReceiptNumber("  ", 1), "RCPT-0001");
  assert.equal(formatReceiptNumber("DG 2026", 7), "DG2026-0007");
});

test("footer placeholders support camelCase, snake_case and double braces", () => {
  const rendered = renderFooterMessage(
    "Thanks {gymName}, {member_name} and {{gym_name}}!",
    { gymName: "DarkGold Gym", memberName: "Priya" },
  );
  assert.equal(rendered, "Thanks DarkGold Gym, Priya and DarkGold Gym!");
});

test("resolved branding keeps footer placeholders for the receipt member", () => {
  const resolved = resolveBranding({
    gym: { id: "gym_1", name: "DarkGold Gym" },
    settings: { footerMessage: "Thanks {gymName}, {memberName}!" },
  });

  // Placeholders must survive branding resolution; only the receipt knows the
  // member it belongs to.
  assert.equal(resolved.footerMessage, "Thanks {gymName}, {memberName}!");

  const receipt = buildReceiptPayload({
    payment: {
      id: "pay_2",
      receiptNumber: "DG-0043",
      amount: 100000,
      paymentMode: "CASH",
      paymentDate: new Date("2026-11-01T10:42:00.000Z"),
      status: "SUCCESS",
    },
    member,
    membership,
    totals: computeMembershipBalance({ pricePaise: 100000, paidPaise: 100000 }),
    branding: resolved,
  });

  assert.equal(receipt.footerMessage, "Thanks DarkGold Gym, Priya Sharma!");
});

test("a partial payment receipt reports the outstanding balance", () => {
  const receipt = makeReceipt({ amount: 150000 });

  assert.equal(receipt.status, "PARTIAL PAYMENT");
  assert.equal(receipt.fees.totalPaise, 450000);
  assert.equal(receipt.fees.paidPaise, 150000);
  assert.equal(receipt.fees.balancePaise, 300000);
  assert.equal(receipt.fees.priorPaidPaise, 0);
  assert.equal(receipt.payment.amountPaise, 150000);
  assert.equal(receipt.footerMessage, "Thank you for choosing DarkGold Gym, Priya Sharma!");
});

test("the second instalment keeps the earlier amount as priorPaid", () => {
  const receipt = makeReceipt({
    amount: 150000,
    totals: computeMembershipBalance({
      pricePaise: 450000,
      paidPaise: 300000,
    }),
  });

  assert.equal(receipt.fees.paidPaise, 300000);
  assert.equal(receipt.fees.priorPaidPaise, 150000);
  assert.equal(receipt.fees.balancePaise, 150000);
});

test("a fully paid (or overpaid) receipt never shows a negative balance", () => {
  const settled = makeReceipt({
    amount: 150000,
    totals: computeMembershipBalance({ pricePaise: 450000, paidPaise: 450000 }),
  });
  assert.equal(settled.status, "FULLY PAID");
  assert.equal(settled.fees.balancePaise, 0);

  const overpaid = makeReceipt({
    amount: 100000,
    totals: computeMembershipBalance({ pricePaise: 450000, paidPaise: 550000 }),
  });
  assert.equal(overpaid.status, "FULLY PAID");
  assert.equal(overpaid.fees.balancePaise, 0);
});

test("WhatsApp links use international digits and the receipt PDF", () => {
  assert.equal(normalizePhoneForWhatsApp("098765 43210"), "919876543210");
  assert.equal(normalizePhoneForWhatsApp("+44 7700 900123"), "447700900123");
  assert.equal(normalizePhoneForWhatsApp("12"), null);

  const receipt = makeReceipt();
  assert.equal(receipt.whatsapp.phone, "919876543210");
  assert.match(receipt.whatsapp.message, /DG-0042/);
  assert.match(receipt.whatsapp.message, /Receipt PDF/);
  assert.equal(buildWhatsAppUrl(receipt).startsWith("https://wa.me/919876543210?text="), true);
});

test("signed receipt links reject tampering and expiry", () => {
  const { token } = signReceiptToken("pay_1", { now: 1_000_000, ttlSeconds: 60 });
  assert.equal(verifyReceiptToken(token, { now: 1_030_000 }).ok, true);
  assert.equal(verifyReceiptToken(token, { now: 1_030_000 }).paymentId, "pay_1");

  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.deepEqual(verifyReceiptToken(tampered, { now: 1_030_000 }), {
    ok: false,
    reason: "invalid",
  });

  assert.deepEqual(verifyReceiptToken(token, { now: 1_100_000 }), {
    ok: false,
    reason: "expired",
  });

  assert.deepEqual(verifyReceiptToken("not-a-token", { now: 1_030_000 }), {
    ok: false,
    reason: "invalid",
  });
});

test("the PDF renderer produces a real PDF buffer", async () => {
  const buffer = await generateReceiptPdf(makeReceipt());
  assert.equal(Buffer.isBuffer(buffer), true);
  assert.equal(buffer.subarray(0, 5).toString("utf8"), "%PDF-");
  assert.ok(buffer.length > 4000, "the PDF should contain a rendered page");
});
