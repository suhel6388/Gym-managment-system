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
  return [
    `Hello ${receipt.member.name}!`,
    `Payment received at ${receipt.gym.gymName}.`,
    `Receipt No: ${receipt.receiptNumber}`,
    `Membership: ${receipt.plan.name}`,
    `Paid: ${formatInr(receipt.payment.amountPaise)} (${receipt.payment.modeLabel})`,
    `Balance: ${formatInr(receipt.fees.balancePaise)}`,
  ]
    .join("\n")
    .slice(0, 1000);
}

/**
 * Sends the receipt PDF as a WhatsApp document message.
 * @returns {Promise<{ messageId: string|null }>}
 */
export async function sendReceiptDocument(receipt) {
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
  if (!link) {
    throw new WhatsAppDeliveryError(
      "Receipt download link is missing. Retry receipt generation.",
      500,
    );
  }

  const endpoint = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
  let response;
  try {
    response = await fetch(endpoint, {
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
        document: {
          link,
          filename: `Receipt-${receipt.receiptNumber}.pdf`,
          caption: buildReceiptDocumentCaption(receipt),
        },
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

  return { messageId: payload?.messages?.[0]?.id ?? null };
}
