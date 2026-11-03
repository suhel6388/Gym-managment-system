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

// This router is mounted at the shared `/api/v1` prefix, so the gym guard must
// be attached per route. A bare `router.use(authenticate, requireGym)` runs for
// every `/api/v1/*` request that reaches this router (including every router
// mounted after it: `/api/v1/super-admin`, `/api/v1/admin/subscription`,
// `/api/v1/schedule`, ...). Platform owners have no gymId, so that guard
// rejected all of their requests with 403 "Gym setup required".
const gymAuth = [authenticate, requireGym];

router.get(
  "/receipt-settings",
  gymAuth,
  allowReadAndCreateOnly,
  getReceiptSettings,
);
// Branding is a destructive settings change, so staff cannot alter it.
router.put(
  "/receipt-settings",
  gymAuth,
  requirePermission(PERMISSION.UPDATE),
  updateReceiptSettings,
);

router.get(
  "/payments/:id/receipt",
  gymAuth,
  allowReadAndCreateOnly,
  getPaymentReceipt,
);
router.get(
  "/payments/:id/receipt/pdf",
  gymAuth,
  allowReadAndCreateOnly,
  downloadPaymentReceipt,
);
router.post(
  "/payments/:id/receipt/whatsapp",
  gymAuth,
  allowReadAndCreateOnly,
  sendPaymentReceiptWhatsApp,
);

export default router;
