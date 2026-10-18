// Razorpay webhook controller.
//
// The raw request body is verified against the X-Razorpay-Signature header
// using the Razorpay webhook secret. Events are deduplicated via
// SubscriptionWebhookEvent (idempotency). Payment activation is idempotent and
// runs inside a transaction.

import { prisma } from "../db.js";
import { verifyWebhookSignature } from "../services/razorpay.service.js";
import { verifyAndActivateFromWebhook } from "../services/subscription.service.js";

// Express 5 applies express.raw() to this router so req.body is a Buffer.
export async function handleWebhook(req, res, next) {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.body;

    if (!signature || !Buffer.isBuffer(rawBody)) {
      return res.status(400).json({ error: "Missing signature or raw body", code: "INVALID_WEBHOOK" });
    }

    // 1. Signature verification using the RAW request body.
    let sigOk;
    try {
      sigOk = verifyWebhookSignature(rawBody, signature);
    } catch (err) {
      return res.status(503).json({ error: err.message, code: "WEBHOOK_SECRET_NOT_CONFIGURED" });
    }
    if (!sigOk) {
      return res.status(401).json({ error: "Invalid webhook signature", code: "INVALID_SIGNATURE" });
    }

    // 2. Parse event.
    let event;
    try {
      event = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "Invalid JSON payload", code: "INVALID_PAYLOAD" });
    }

    const eventId = event?.id;
    const eventType = event?.event;
    const payload = event?.payload ?? {};

    if (!eventId || !eventType) {
      return res.status(400).json({ error: "Malformed webhook event", code: "MALFORMED_EVENT" });
    }

    // 3. Deduplication: insert the event id; on conflict, skip (already processed).
    let webhookEvent;
    try {
      webhookEvent = await prisma.subscriptionWebhookEvent.create({
        data: { id: eventId, provider: "razorpay", type: eventType, payload },
      });
    } catch (err) {
      // P2002 unique violation -> duplicate webhook delivery, ignore idempotently.
      if (err?.code === "P2002") {
        return res.status(200).json({ received: true, duplicate: true });
      }
      throw err;
    }

    // 4. Process event.
    const paymentEntity = payload?.payment?.entity;
    const orderEntity = payload?.order?.entity;
    const orderId = orderEntity?.id || paymentEntity?.order_id;
    const paymentId = paymentEntity?.id;

    try {
      if (eventType === "payment.captured" || eventType === "payment.authorized") {
        if (orderId && paymentId) {
          await verifyAndActivateFromWebhook(orderId, paymentId);
        }
      } else if (eventType === "payment.failed") {
        if (orderId) {
          await prisma.subscriptionPayment.updateMany({
            where: { orderId, status: { in: ["CREATED", "PENDING"] } },
            data: { status: "FAILED", failureReason: "Payment failed at provider", updatedAt: new Date() },
          });
        }
      } else if (eventType === "refund.processed") {
        if (paymentId) {
          const rows = await prisma.subscriptionPayment.findMany({ where: { paymentId } });
          await prisma.subscriptionPayment.updateMany({
            where: { paymentId },
            data: { status: "REFUNDED", updatedAt: new Date() },
          });
          // Mark related subscriptions PAST_DUE on refund.
          for (const row of rows) {
            if (row.subscriptionId) {
              await prisma.gymSubscription.update({
                where: { id: row.subscriptionId },
                data: { status: "PAST_DUE" },
              });
            }
          }
        }
      } else if (eventType === "refund.failed") {
        if (paymentId) {
          await prisma.subscriptionPayment.updateMany({
            where: { paymentId },
            data: { status: "FAILED", failureReason: "Refund failed", updatedAt: new Date() },
          });
        }
      } else if (eventType === "charge.disputed") {
        if (paymentId) {
          await prisma.subscriptionPayment.updateMany({
            where: { paymentId },
            data: { status: "DISPUTED", updatedAt: new Date() },
          });
        }
      }

      await prisma.subscriptionWebhookEvent.update({
        where: { id: eventId },
        data: { processedAt: new Date() },
      });

      return res.status(200).json({ received: true, event: eventType, duplicate: false });
    } catch (processErr) {
      // Mark event processed so we don't retry endlessly, then rethrow for logging.
      await prisma.subscriptionWebhookEvent.update({
        where: { id: eventId },
        data: { processedAt: new Date() },
      }).catch(() => {});
      throw processErr;
    }
  } catch (err) {
    next(err);
  }
}
