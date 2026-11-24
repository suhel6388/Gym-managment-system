// Raw-body capture for provider webhooks.
//
// Razorpay signs the EXACT bytes it sends, so the route must be mounted before
// `express.json()` and must keep `req.body` as a Buffer. Any JSON parsing before
// signature verification would break HMAC verification.

import express from "express";

/** Collect the raw body as a Buffer (default 2 MB, webhooks are tiny). */
export const rawBody = express.raw({
  type: () => true,
  limit: process.env.WEBHOOK_BODY_LIMIT || "2mb",
});

/**
 * Optional guard that rejects non-JSON content types early. Razorpay always
 * sends `application/json`; keeping this strict reduces the attack surface.
 */
export function requireJsonContentType(req, res, next) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return res.status(415).json({
      error: "Webhook payload must be JSON",
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  }
  next();
}

export default rawBody;
