/**
 * Optional WhatsApp Business Cloud API delivery.
 *
 * The default sharing path is a `wa.me` deep link (message prefilled, PDF link
 * inside it). This module adds true document delivery when a gym platform
 * operator has configured Cloud API credentials. Everything runs server-side;
 * the access token is never sent to the browser.
 */

import { formatInr } from "./receipt.service.js";

export class WhatsAppNotConfiguredError extends Error {
  constructor() {
    super(
      "WhatsApp Business Cloud API is not configured. Use the share link instead.",
    );
    this.name = "WhatsAppNotConfiguredError";
    this.code = "WHATSAPP_NOT_CONFIGURED";
  }
}

export class WhatsAppDeliveryError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = "WhatsAppDeliveryError";
    this.status = status;
  }
}

export function whatsAppConfig() {
  const token = (process.env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
  const phoneNumberId = (process.env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const apiVersion = (process.env.WHATSAPP_API_VERSION ?? "v21.0").trim();
  return {
    configured: Boolean(token && phoneNumberId),
    token,
    phoneNumberId,
    apiVersion,
  };
}

export function buildReceiptDocumentCaption(receipt) {
  const footer = String(receipt.footerMessage ?? "").trim();
  return [
    `Hello ${receipt.member.name}!`,
    `Payment received at ${receipt.gym.gymName}.`,
    `Receipt No: ${receipt.receiptNumber}`,
    `Membership: ${receipt.plan.name}`,
    `Paid: ${formatInr(receipt.payment.amountPaise)} (${receipt.payment.modeLabel})`,
    `Balance: ${formatInr(receipt.fees.balancePaise)}`,
    ...(footer ? ["", footer] : []),
  ]
    .join("\n")
    .slice(0, 1000);
}

function graphEndpoint(config, resource) {
  return `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/${resource}`;
}

export function receiptDocumentFileName(receipt) {
  const safe = String(receipt?.receiptNumber ?? "receipt").replace(
    /[^A-Za-z0-9._-]/g,
    "-",
  );
  return `Receipt-${safe}.pdf`;
}

/**
 * Uploads the PDF to WhatsApp's media endpoint so delivery does not depend on
 * the receipt link being reachable by Meta's servers. WhatsApp stores the file
 * for 30 days; the message refers to it by id.
 *
 * @returns {Promise<string|null>} media id, or null when the upload failed.
 */
async function uploadReceiptMedia(config, buffer, fileName) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "application/pdf");
  form.append(
    "file",
    new Blob([buffer], { type: "application/pdf" }),
    fileName,
  );

  let response;
  try {
    response = await fetch(graphEndpoint(config, "media"), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      body: form,
    });
  } catch {
    return null;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.id) {
    console.warn("[whatsapp] receipt media upload failed", {
      status: response.status,
      message: payload?.error?.message,
    });
    return null;
  }
  return payload.id;
}

/**
 * Sends the receipt PDF as a WhatsApp document message.
 *
 * When the caller supplies the rendered PDF (`pdfBuffer`), it is uploaded to
 * the Cloud API first and sent by media id. If the upload fails, delivery falls
 * back to the signed public link, which Meta fetches itself.
 *
 * @returns {Promise<{ messageId: string|null, delivery: "media"|"link" }>}
 */
export async function sendReceiptDocument(receipt, { pdfBuffer = null } = {}) {
  const config = whatsAppConfig();
  if (!config.configured) throw new WhatsAppNotConfiguredError();

  const to = receipt.whatsapp?.phone;
  const link = receipt.links?.pdf;
  if (!to) {
    throw new WhatsAppDeliveryError(
      "Member mobile number is not usable for WhatsApp.",
      400,
    );
  }

  const fileName = receiptDocumentFileName(receipt);
  let mediaId = null;
  if (Buffer.isBuffer(pdfBuffer) && pdfBuffer.length > 0) {
    mediaId = await uploadReceiptMedia(config, pdfBuffer, fileName);
  }

  if (!mediaId && !link) {
    throw new WhatsAppDeliveryError(
      "Receipt PDF could not be uploaded and no public link is available. Retry receipt generation.",
      500,
    );
  }

  const document = mediaId
    ? { id: mediaId, filename: fileName }
    : { link, filename: fileName };
  document.caption = buildReceiptDocumentCaption(receipt);

  let response;
  try {
    response = await fetch(graphEndpoint(config, "messages"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "document",
        document,
      }),
    });
  } catch {
    throw new WhatsAppDeliveryError(
      "Could not reach WhatsApp. The payment is still recorded.",
    );
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload?.error?.message ??
      `WhatsApp rejected the message (HTTP ${response.status}).`;
    throw new WhatsAppDeliveryError(message);
  }

  return {
    messageId: payload?.messages?.[0]?.id ?? null,
    delivery: mediaId ? "media" : "link",
  };
}
