/**
 * Membership receipt domain logic.
 *
 * Everything in this module is deliberately free of database imports so it can
 * be unit tested (amount maths, link signing, message rendering) without a
 * Postgres connection. Controllers pass in Prisma-backed rows.
 */

import crypto from "node:crypto";

export const RECEIPT_VERSION = 1;

/** Used when an owner has not saved a footer message yet. */
export const DEFAULT_RECEIPT_FOOTER =
  "Thank you for choosing {gymName}! Your support keeps our community strong. Stay Fit, Stay Strong!";

export const DEFAULT_TAGLINE = "Premium Fitness Club";

export const DEFAULT_RECEIPT_PREFIX = "RCPT";

/** Public receipt links are temporary. Override with RECEIPT_LINK_TTL_DAYS. */
export const DEFAULT_RECEIPT_LINK_TTL_DAYS = 7;

export const RECEIPT_PAYMENT_MODE_LABELS = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  BANK_TRANSFER: "Bank Transfer",
  OTHER: "Other",
};

/** A PNG/JPEG data URL, used for the logo and signature images. */
const IMAGE_DATA_URL = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i;

export function parseImageDataUrl(value) {
  if (typeof value !== "string") return null;
  const match = IMAGE_DATA_URL.exec(value.trim());
  if (!match) return null;
  try {
    const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    if (!buffer.length) return null;
    return { mime: `image/${match[1].toLowerCase()}`, buffer };
  } catch {
    return null;
  }
}

export function toPaise(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

/**
 * Fee maths for one membership.
 *
 * Amounts are integer paise. The discount can never make the total negative,
 * and the balance can never go below zero even when a member prepays.
 */
export function computeMembershipBalance({
  pricePaise,
  discountPaise = 0,
  paidPaise = 0,
}) {
  const subtotalPaise = toPaise(pricePaise);
  const discount = Math.min(subtotalPaise, toPaise(discountPaise));
  const totalPaise = Math.max(0, subtotalPaise - discount);
  const paid = toPaise(paidPaise);
  return {
    subtotalPaise,
    discountPaise: discount,
    totalPaise,
    paidPaise: paid,
    balancePaise: Math.max(0, totalPaise - paid),
  };
}

/** "RCPT" / "dg 2026" -> "DG2026"; empty input falls back to the default. */
export function sanitizeReceiptPrefix(value) {
  const cleaned = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12);
  return cleaned || DEFAULT_RECEIPT_PREFIX;
}

/** `formatReceiptNumber("DG", 42)` -> `"DG-0042"`. */
export function formatReceiptNumber(prefix, sequence) {
  const safePrefix = sanitizeReceiptPrefix(prefix);
  const safeSequence = Math.max(1, Math.floor(Number(sequence) || 1));
  return `${safePrefix}-${String(safeSequence).padStart(4, "0")}`;
}

export function paymentModeLabel(mode) {
  return RECEIPT_PAYMENT_MODE_LABELS[mode] ?? String(mode ?? "Other");
}

export function receiptStatusLabel({ balancePaise }) {
  if (toPaise(balancePaise) <= 0) return "FULLY PAID";
  return "PARTIAL PAYMENT";
}

/** Indian rupee formatting for WhatsApp (PDF renders "Rs." for font safety). */
export function formatInr(paise) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(toPaise(paise) / 100);
}

export function formatInrPlain(paise) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toPaise(paise) / 100);
}

export function formatReceiptDate(iso) {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatReceiptTime(iso) {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** ISO calendar day (`YYYY-MM-DD`) in the server's local timezone. */
export function toDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function membershipDurationLabel(months) {
  const value = Math.max(1, Math.round(Number(months) || 1));
  return `${value} month${value === 1 ? "" : "s"}`;
}

/**
 * Replaces `{placeholders}` in owner-authored footer copy.
 * Accepts both `{gymName}` / `{{gymName}}` and `{gym_name}` spellings so copy
 * written in either convention renders identically in the PDF and the UI.
 */
export function renderFooterMessage(template, { gymName, memberName }) {
  const source = String(template ?? "").trim() || DEFAULT_RECEIPT_FOOTER;
  const values = {
    gymname: gymName ?? "",
    membername: memberName ?? "",
  };
  return source.replace(
    /\{\{?\s*(gym[_\s]?name|member[_\s]?name)\s*\}?\}/gi,
    (match, token) => {
      const key = token.toLowerCase().replace(/[_\s]/g, "");
      const replacement = values[key];
      return replacement === undefined ? match : replacement;
    },
  );
}

/**
 * Merges saved branding over the gym row. Marketing defaults live here so the
 * same fallbacks apply to the PDF, the API payload and the UI preview.
 */
export function resolveBranding({ gym, settings }) {
  const pick = (saved, fallback) => {
    const value = typeof saved === "string" ? saved.trim() : "";
    return value || fallback;
  };

  return {
    gymName: pick(settings?.gymName, pick(gym?.name, "Your Gym")),
    tagline: pick(settings?.tagline, DEFAULT_TAGLINE),
    address: pick(settings?.address, pick(gym?.address, "")),
    phone: pick(settings?.phone, pick(gym?.phone, "")),
    email: pick(settings?.email, pick(gym?.email, "")),
    website: pick(settings?.website, ""),
    // Keep placeholders intact: `buildReceiptPayload` renders them once the
    // member is known, so a `{memberName}` token never resolves to "" here.
    footerMessage: pick(settings?.footerMessage, DEFAULT_RECEIPT_FOOTER),
    authorizedSignatory: pick(
      settings?.authorizedSignatory,
      "Authorised Signatory",
    ),
    signatureDataUrl: settings?.signatureDataUrl ?? null,
    logoDataUrl: settings?.logoDataUrl ?? null,
    qrEnabled: settings?.qrEnabled !== false,
    receiptPrefix: sanitizeReceiptPrefix(settings?.receiptPrefix),
  };
}

/* ------------------------------------------------------------------------- */
/* Receipt access tokens                                                     */
/* ------------------------------------------------------------------------- */

function receiptLinkSecret() {
  const secret =
    process.env.RECEIPT_LINK_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    // Keeping a deterministic dev fallback avoids crashing local unit tests.
    // Production startup already refuses to boot without BETTER_AUTH_SECRET.
    return "darkgoldgym-receipt-dev-secret";
  }
  return secret;
}

export function receiptLinkTtlSeconds() {
  const days = Number(process.env.RECEIPT_LINK_TTL_DAYS);
  const safeDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_RECEIPT_LINK_TTL_DAYS;
  return Math.round(safeDays * 24 * 60 * 60);
}

/**
 * Signs `paymentId + expiry` so a member can download exactly one receipt
 * without a CRM login. The token is not a session and grants nothing else.
 */
export function signReceiptToken(
  paymentId,
  { ttlSeconds = receiptLinkTtlSeconds(), now = Date.now() } = {},
) {
  if (!paymentId) throw new Error("paymentId is required");
  const expiresAt = Math.floor(now / 1000) + Math.max(60, Math.floor(ttlSeconds));
  const payload = `${paymentId}.${expiresAt}`;
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", receiptLinkSecret())
    .update(payload)
    .digest("base64url");
  return { token: `${encoded}.${signature}`, expiresAt: expiresAt * 1000 };
}

export function verifyReceiptToken(token, { now = Date.now() } = {}) {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "invalid" };
  }

  const lastDot = token.lastIndexOf(".");
  const encoded = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  if (!encoded || !signature) return { ok: false, reason: "invalid" };

  let payload;
  try {
    payload = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const dot = payload.lastIndexOf(".");
  if (dot <= 0) return { ok: false, reason: "invalid" };
  const paymentId = payload.slice(0, dot);
  const expiresAt = Number(payload.slice(dot + 1));
  if (!paymentId || !Number.isFinite(expiresAt)) {
    return { ok: false, reason: "invalid" };
  }

  const expected = crypto
    .createHmac("sha256", receiptLinkSecret())
    .update(payload)
    .digest("base64url");

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (expiresAt * 1000 < now) return { ok: false, reason: "expired" };

  return { ok: true, paymentId, expiresAt: expiresAt * 1000 };
}

/**
 * Absolute public PDF link. `baseUrl` is the API origin (the Express server
 * also serves the exported frontend), so members can open it on any device.
 */
export function buildReceiptPublicUrl(paymentId, baseUrl, options = {}) {
  const base = String(baseUrl ?? "").replace(/\/+$/, "");
  if (!base) throw new Error("A public base URL is required");
  const { token } = signReceiptToken(paymentId, options);
  return `${base}/api/v1/receipts/public/${encodeURIComponent(paymentId)}/pdf?token=${encodeURIComponent(token)}`;
}

/** Builds the click-to-chat message. Includes the PDF link because wa.me
 * cannot attach files. */
export function buildReceiptWhatsAppMessage(receipt) {
  const { member, gym, plan, payment, fees, receiptNumber } = receipt;
  const lines = [
    `Hello ${member.name}!`,
    "",
    `Your membership payment at ${gym.gymName} has been received successfully.`,
    "",
    `Receipt No: ${receiptNumber}`,
    `Membership: ${plan.name}`,
    `Paid Amount: ${formatInr(payment.amountPaise)}`,
    `Payment Mode: ${payment.modeLabel}`,
    `Payment Date: ${payment.dateLabel}`,
    `Remaining Balance: ${formatInr(fees.balancePaise)}`,
    "",
  ];

  if (receipt.links?.pdf) {
    lines.push("Receipt PDF:", receipt.links.pdf, "");
  }

  lines.push(
    `Thank you for choosing ${gym.gymName}!`,
    "",
    "Stay Fit, Stay Strong!",
  );

  return lines.join("\n");
}

/**
 * Assembles the JSON contract consumed by both the React preview and the PDF.
 * Amounts come from `totals` (computed inside the payment transaction) so a
 * later plan-price edit cannot rewrite the receipt.
 */
export function buildReceiptPayload({
  payment,
  member,
  membership,
  totals,
  branding,
  links = {},
  now = new Date(),
}) {
  const plan = membership?.plan ?? null;
  const planName = plan?.name?.trim() || "Membership Fee";
  const durationMonths = Math.max(1, Math.round(Number(plan?.durationMonths) || 1));
  const durationLabel = membershipDurationLabel(durationMonths);
  const paymentDate = payment?.paymentDate ?? payment?.paidAt ?? now;
  const issuedAt = payment?.receiptIssuedAt ?? now;
  const amountPaise = toPaise(payment?.amount);

  const subtotalPaise = toPaise(totals?.subtotalPaise);
  const discountPaise = Math.min(subtotalPaise, toPaise(totals?.discountPaise));
  const totalPaise = Math.max(0, subtotalPaise - discountPaise);
  const paidPaise = Math.max(toPaise(totals?.paidPaise), amountPaise);
  const balancePaise = Math.max(0, totalPaise - paidPaise);
  const priorPaidPaise = Math.max(0, paidPaise - amountPaise);

  const footerMessage = renderFooterMessage(
    branding?.footerMessage,
    {
      gymName: branding?.gymName ?? "Your Gym",
      memberName: member?.name ?? "",
    },
  );

  const receipt = {
    version: RECEIPT_VERSION,
    id: payment?.id ?? null,
    receiptNumber: payment?.receiptNumber ?? "—",
    issuedAt: new Date(issuedAt).toISOString(),
    status: receiptStatusLabel({ balancePaise, priorPaidPaise }),
    member: {
      id: member?.id ?? null,
      code: member?.memberCode ?? "—",
      name: member?.name ?? "Member",
      phone: member?.phone ?? "",
      email: member?.email ?? "",
    },
    gym: {
      gymName: branding?.gymName ?? "Your Gym",
      tagline: branding?.tagline ?? DEFAULT_TAGLINE,
      address: branding?.address ?? "",
      phone: branding?.phone ?? "",
      email: branding?.email ?? "",
      website: branding?.website ?? "",
      logoDataUrl: branding?.logoDataUrl ?? null,
      signatureDataUrl: branding?.signatureDataUrl ?? null,
      authorizedSignatory: branding?.authorizedSignatory ?? "Authorised Signatory",
      qrEnabled: branding?.qrEnabled !== false,
    },
    plan: {
      name: planName,
      durationMonths,
      durationLabel,
      description: plan?.description ?? "",
    },
    membership: {
      id: membership?.id ?? null,
      startDate: membership?.startDate ?? null,
      endDate: membership?.endDate ?? null,
      startDateLabel: membership?.startDate
        ? formatReceiptDate(membership.startDate)
        : "—",
      endDateLabel: membership?.endDate
        ? formatReceiptDate(membership.endDate)
        : "—",
    },
    fees: {
      description: plan?.name?.trim()
        ? `${plan.name.trim()} membership fee (${durationLabel})`
        : `Membership fee (${durationLabel})`,
      subtotalPaise,
      discountPaise,
      totalPaise,
      paidPaise,
      priorPaidPaise,
      balancePaise,
    },
    payment: {
      amountPaise,
      mode: payment?.paymentMode ?? "OTHER",
      modeLabel: paymentModeLabel(payment?.paymentMode),
      date: paymentDate,
      dateKey: toDateKey(paymentDate),
      dateLabel: formatReceiptDate(paymentDate),
      timeLabel: formatReceiptTime(paymentDate),
      reference: payment?.reference ?? "",
      status: payment?.status ?? "SUCCESS",
    },
    footerMessage,
    links: {
      pdf: links.pdf ?? "",
      expiresAt: links.expiresAt ? new Date(links.expiresAt).toISOString() : null,
    },
    whatsapp: {
      phone: normalizePhoneForWhatsApp(member?.phone ?? ""),
      message: "",
    },
  };

  receipt.whatsapp.message = buildReceiptWhatsAppMessage(receipt);
  return receipt;
}

/**
 * Same rules as the existing renewal links: strip formatting, drop a leading
 * trunk zero and assume +91 for bare 10-digit Indian numbers.
 */
export function normalizePhoneForWhatsApp(phone) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  digits = digits.replace(/^0+/, "");
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

/** `https://wa.me/<phone>?text=<message>` — no PDF attachment is implied. */
export function buildWhatsAppUrl(receipt) {
  const phone = receipt?.whatsapp?.phone;
  if (!phone) return null;
  return `https://wa.me/${phone}?text=${encodeURIComponent(
    receipt.whatsapp.message,
  )}`;
}

