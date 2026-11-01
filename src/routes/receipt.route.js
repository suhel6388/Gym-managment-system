import { Router } from "express";
import {
  authenticate,
  requireGym,
  allowReadAndCreateOnly,
  requirePermission,
  PERMISSION,
} from "../middleware/auth.js";
import {
  downloadPaymentReceipt,
  getPaymentReceipt,
  getReceiptSettings,
  sendPaymentReceiptWhatsApp,
  updateReceiptSettings,
} from "../controllers/receipt.controller.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/receipt-settings", allowReadAndCreateOnly, getReceiptSettings);
// Branding is a destructive settings change, so staff cannot alter it.
router.put(
  "/receipt-settings",
  requirePermission(PERMISSION.UPDATE),
  updateReceiptSettings,
);

router.get("/payments/:id/receipt", allowReadAndCreateOnly, getPaymentReceipt);
router.get(
  "/payments/:id/receipt/pdf",
  allowReadAndCreateOnly,
  downloadPaymentReceipt,
);
router.post(
  "/payments/:id/receipt/whatsapp",
  allowReadAndCreateOnly,
  sendPaymentReceiptWhatsApp,
);

export default router;
