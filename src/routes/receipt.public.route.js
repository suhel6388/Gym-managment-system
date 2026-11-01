import { Router } from "express";
import { publicReceiptPdf } from "../controllers/receipt.controller.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

// No session: the signed, expiring token in the query string is the only
// credential and it grants one receipt PDF. Rate-limited by IP.
router.get(
  "/receipts/public/:id/pdf",
  rateLimit({ windowMs: 60 * 1000, max: 60 }),
  publicReceiptPdf,
);

export default router;
