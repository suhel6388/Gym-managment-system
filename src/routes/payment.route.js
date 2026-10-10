import { Router } from "express";
import { cancelPayment, createPayment, freezePayment, listPayments } from "../controllers/payment.controller.js";
import { authenticate, requireGym } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/", listPayments);
router.post("/", createPayment);
router.post("/:id/freeze", freezePayment);
router.post("/:id/cancel", cancelPayment);

export default router;
