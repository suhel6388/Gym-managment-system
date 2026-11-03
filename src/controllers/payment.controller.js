import { prisma } from "../db.js";
import { paymentInput } from "../utils/validation.js";
import {
  DuplicatePaymentError,
  PaymentDomainError,
  isIdempotencyConflict,
  recordMembershipPayment,
} from "../services/payment.service.js";
import {
  buildWhatsAppUrl,
  sanitizeReceiptPrefix,
} from "../services/receipt.service.js";
import {
  loadReceiptPayload,
  receiptPublicBaseUrl,
} from "../services/receipt-loader.service.js";
import { whatsAppConfig } from "../services/whatsapp.service.js";

function handlePaymentError(err, res, next) {
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
    return res.status(err.status ?? 400).json({
      error: err.message,
      code: err.code,
    });
  }
  return next(err);
}

async function receiptPrefixForGym(gymId) {
  try {
    const settings = await prisma.gymReceiptSettings.findUnique({
      where: { gymId },
      select: { receiptPrefix: true },
    });
    return sanitizeReceiptPrefix(settings?.receiptPrefix);
  } catch {
    // A deployment that has not run the receipt migration yet must still be
    // able to record payments.
    return sanitizeReceiptPrefix(null);
  }
}

/** Builds the receipt bundle without ever failing the committed payment. */
async function safeReceiptBundle(req, paymentId, gymId) {
  try {
    const payload = await loadReceiptPayload({
      client: prisma,
      paymentId,
      gymId,
      baseUrl: receiptPublicBaseUrl(req),
    });
    if (payload.payment.status !== "SUCCESS") {
      return {
        receipt: null,
        whatsapp: null,
        receiptError: "A receipt is only issued for successful payments.",
      };
    }
    const url = buildWhatsAppUrl(payload.receipt);
    return {
      receipt: payload.receipt,
      whatsapp: {
        phone: payload.receipt.whatsapp.phone,
        url,
        message: payload.receipt.whatsapp.message,
        cloudAvailable: whatsAppConfig().configured,
      },
      receiptError: null,
    };
  } catch (error) {
    console.error("[receipt] could not build receipt bundle", {
      paymentId,
      message: error?.message,
    });
    return {
      receipt: null,
      whatsapp: null,
      receiptError:
        "Payment saved, but the receipt could not be prepared. Retry from Payments.",
    };
  }
}

export async function listPayments(req, res, next) {
  try {
    const data = await prisma.payment.findMany({
      where: { gymId: req.user.gymId },
      include: {
        member: { select: { id: true, name: true, memberCode: true, phone: true } },
      },
      orderBy: { paidAt: "desc" },
      take: 200,
    });
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

/**
 * Records one membership payment and returns its receipt.
 *
 * The payment, its allocation and the immutable receipt snapshot are written in
 * one transaction. `Idempotency-Key` (header or body) makes a retried submit
 * return the original payment with a 200 instead of charging twice.
 */
export async function createPayment(req, res, next) {
  try {
    const input = paymentInput.parse(req.body);
    const headerKey = req.get("Idempotency-Key");
    const idempotencyKey = (headerKey || input.idempotencyKey || null)
      ? String(headerKey || input.idempotencyKey).trim().slice(0, 120)
      : null;
    const receiptPrefix = await receiptPrefixForGym(req.user.gymId);

    let result;
    try {
      result = await recordMembershipPayment({
        client: prisma,
        gymId: req.user.gymId,
        memberId: input.memberId,
        membershipId: input.membershipId ?? null,
        amountPaise: input.amount,
        paymentMode: input.paymentMode,
        reference: input.reference ?? null,
        paymentDate: input.paymentDate ?? new Date(),
        status: input.status ?? "SUCCESS",
        idempotencyKey,
        receiptPrefix,
      });
    } catch (error) {
      if (!isIdempotencyConflict(error) || !idempotencyKey) throw error;

      // Another request won the race. Return its committed payment, not an
      // error, so the member is never charged twice by a retry.
      const existing = await prisma.payment.findFirst({
        where: { gymId: req.user.gymId, idempotencyKey },
      });
      if (!existing) throw error;

      const bundle = await safeReceiptBundle(req, existing.id, req.user.gymId);
      return res.status(200).json({
        data: existing,
        duplicate: true,
        ...bundle,
      });
    }

    const bundle = await safeReceiptBundle(
      req,
      result.payment.id,
      req.user.gymId,
    );

    return res.status(result.duplicate ? 200 : 201).json({
      data: result.payment,
      duplicate: result.duplicate,
      ...bundle,
    });
  } catch (err) {
    if (err instanceof DuplicatePaymentError && err.idempotencyKey) {
      try {
        const existing = await prisma.payment.findFirst({
          where: {
            gymId: req.user.gymId,
            idempotencyKey: err.idempotencyKey,
          },
        });
        if (existing) {
          const bundle = await safeReceiptBundle(req, existing.id, req.user.gymId);
          return res.status(200).json({ data: existing, duplicate: true, ...bundle });
        }
      } catch (lookupError) {
        return handlePaymentError(lookupError, res, next);
      }
    }
    return handlePaymentError(err, res, next);
  }
}
