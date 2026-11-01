import { prisma } from "../db.js";
import { idParam, receiptSettingsInput } from "../utils/validation.js";
import {
  PaymentDomainError,
} from "../services/payment.service.js";
import {
  DEFAULT_TAGLINE,
  DEFAULT_RECEIPT_FOOTER,
  DEFAULT_RECEIPT_PREFIX,
  RECEIPT_PAYMENT_MODE_LABELS,
  resolveBranding,
  sanitizeReceiptPrefix,
  verifyReceiptToken,
} from "../services/receipt.service.js";
import {
  loadReceiptPayload,
  receiptPublicBaseUrl,
} from "../services/receipt-loader.service.js";
import { generateReceiptPdf } from "../services/receipt-pdf.service.js";
import {
  WhatsAppDeliveryError,
  WhatsAppNotConfiguredError,
  whatsAppConfig,
  sendReceiptDocument,
} from "../services/whatsapp.service.js";

function handleError(err, res, next) {
  if (err?.name === "ZodError") {
    const first = err.issues?.[0];
    return res.status(400).json({
      error: first?.message ?? "Validation failed",
      field: typeof first?.path?.[0] === "string" ? first.path[0] : null,
      details: (err.issues ?? []).map((issue) => ({
        field: typeof issue.path?.[0] === "string" ? issue.path[0] : null,
        message: issue.message,
      })),
    });
  }
  if (err instanceof PaymentDomainError) {
    return res.status(err.status ?? 400).json({ error: err.message, code: err.code });
  }
  if (err instanceof WhatsAppNotConfiguredError) {
    return res.status(501).json({ error: err.message, code: err.code });
  }
  if (err instanceof WhatsAppDeliveryError) {
    return res.status(err.status ?? 502).json({ error: err.message, code: "WHATSAPP_DELIVERY_FAILED" });
  }
  return next(err);
}

function settingsPayload(gym) {
  const saved = gym.receiptSettings;
  const branding = resolveBranding({ gym, settings: saved });
  return {
    gym: {
      id: gym.id,
      name: gym.name,
      phone: gym.phone,
      email: gym.email,
      address: gym.address,
    },
    settings: {
      gymName: saved?.gymName ?? null,
      tagline: saved?.tagline ?? null,
      address: saved?.address ?? null,
      phone: saved?.phone ?? null,
      email: saved?.email ?? null,
      website: saved?.website ?? null,
      footerMessage: saved?.footerMessage ?? null,
      authorizedSignatory: saved?.authorizedSignatory ?? null,
      signatureDataUrl: saved?.signatureDataUrl ?? null,
      logoDataUrl: saved?.logoDataUrl ?? null,
      qrEnabled: saved?.qrEnabled !== false,
      receiptPrefix: sanitizeReceiptPrefix(saved?.receiptPrefix),
    },
    branding,
    defaults: {
      tagline: DEFAULT_TAGLINE,
      footerMessage: DEFAULT_RECEIPT_FOOTER,
      receiptPrefix: DEFAULT_RECEIPT_PREFIX,
      paymentModes: RECEIPT_PAYMENT_MODE_LABELS,
    },
  };
}

async function loadGymSettings(gymId) {
  const gym = await prisma.gym.findUnique({
    where: { id: gymId },
    include: { receiptSettings: true },
  });
  if (!gym) throw new PaymentDomainError("Gym not found", 404, "GYM_NOT_FOUND");
  return gym;
}

/** GET /api/v1/receipt-settings */
export async function getReceiptSettings(req, res, next) {
  try {
    const gym = await loadGymSettings(req.user.gymId);
    res.json({ data: settingsPayload(gym) });
  } catch (err) {
    handleError(err, res, next);
  }
}

/** PUT /api/v1/receipt-settings */
export async function updateReceiptSettings(req, res, next) {
  try {
    const input = receiptSettingsInput.parse(req.body);
    const data = { ...input };

    if (data.receiptPrefix !== undefined) {
      data.receiptPrefix = sanitizeReceiptPrefix(data.receiptPrefix);
    }

    const gym = await prisma.$transaction(async (tx) => {
      await tx.gymReceiptSettings.upsert({
        where: { gymId: req.user.gymId },
        create: { gymId: req.user.gymId, ...data },
        update: data,
      });
      return tx.gym.findUnique({
        where: { id: req.user.gymId },
        include: { receiptSettings: true },
      });
    });

    if (!gym) {
      throw new PaymentDomainError("Gym not found", 404, "GYM_NOT_FOUND");
    }
    res.json({ data: settingsPayload(gym) });
  } catch (err) {
    handleError(err, res, next);
  }
}

/** GET /api/v1/payments/:id/receipt */
export async function getPaymentReceipt(req, res, next) {
  try {
    const { id } = idParam.parse(req.params);
    const payload = await loadReceiptPayload({
      client: prisma,
      paymentId: id,
      gymId: req.user.gymId,
      baseUrl: receiptPublicBaseUrl(req),
    });
    if (payload.payment.status !== "SUCCESS") {
      return res.status(409).json({
        error: "A receipt is only available for successful payments.",
        code: "PAYMENT_NOT_SUCCESSFUL",
      });
    }
    res.json({ data: payload.receipt });
  } catch (err) {
    handleError(err, res, next);
  }
}

function sendPdf(res, buffer, receiptNumber) {
  const filename = `Receipt-${String(receiptNumber).replace(/[^A-Za-z0-9._-]/g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", String(buffer.length));
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(buffer);
}

/** GET /api/v1/payments/:id/receipt/pdf — authenticated download. */
export async function downloadPaymentReceipt(req, res, next) {
  try {
    const { id } = idParam.parse(req.params);
    const payload = await loadReceiptPayload({
      client: prisma,
      paymentId: id,
      gymId: req.user.gymId,
      baseUrl: receiptPublicBaseUrl(req),
    });
    if (payload.payment.status !== "SUCCESS") {
      return res.status(409).json({
        error: "A receipt is only available for successful payments.",
        code: "PAYMENT_NOT_SUCCESSFUL",
      });
    }
    const buffer = await generateReceiptPdf(payload.receipt);
    sendPdf(res, buffer, payload.receipt.receiptNumber);
  } catch (err) {
    handleError(err, res, next);
  }
}

/**
 * GET /api/v1/receipts/public/:id/pdf?token=...
 *
 * The token is an HMAC over the payment id + expiry. It grants exactly one
 * receipt, requires no session, and cannot be edited to reach another payment.
 */
export async function publicReceiptPdf(req, res, next) {
  try {
    const { id } = idParam.parse(req.params);
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const verified = verifyReceiptToken(token);
    if (!verified.ok) {
      return res.status(401).json({
        error:
          verified.reason === "expired"
            ? "This receipt link has expired. Ask the gym for a new link."
            : "This receipt link is invalid.",
        code: verified.reason === "expired" ? "LINK_EXPIRED" : "LINK_INVALID",
      });
    }
    if (verified.paymentId !== id) {
      return res.status(403).json({
        error: "This receipt link does not match the requested receipt.",
        code: "LINK_SCOPE_MISMATCH",
      });
    }

    const payload = await loadReceiptPayload({
      client: prisma,
      paymentId: verified.paymentId,
      baseUrl: receiptPublicBaseUrl(req),
    });
    if (payload.payment.status !== "SUCCESS") {
      return res.status(409).json({
        error: "A receipt is only available for successful payments.",
        code: "PAYMENT_NOT_SUCCESSFUL",
      });
    }

    const buffer = await generateReceiptPdf(payload.receipt);
    sendPdf(res, buffer, payload.receipt.receiptNumber);
  } catch (err) {
    handleError(err, res, next);
  }
}

/** POST /api/v1/payments/:id/receipt/whatsapp — optional Cloud API delivery. */
export async function sendPaymentReceiptWhatsApp(req, res, next) {
  try {
    const { id } = idParam.parse(req.params);
    const payload = await loadReceiptPayload({
      client: prisma,
      paymentId: id,
      gymId: req.user.gymId,
      baseUrl: receiptPublicBaseUrl(req),
    });
    if (payload.payment.status !== "SUCCESS") {
      return res.status(409).json({
        error: "Only successful payments can be shared.",
        code: "PAYMENT_NOT_SUCCESSFUL",
      });
    }

    const result = await sendReceiptDocument(payload.receipt);
    res.json({
      data: {
        sent: true,
        provider: "whatsapp_cloud",
        messageId: result.messageId,
        phone: payload.receipt.whatsapp.phone,
        cloudAvailable: whatsAppConfig().configured,
      },
    });
  } catch (err) {
    handleError(err, res, next);
  }
}
