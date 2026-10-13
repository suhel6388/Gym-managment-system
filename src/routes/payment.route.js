import { Router } from "express";
import { createPayment, listPayments } from "../controllers/payment.controller.js";
import { authenticate, requireGym } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/", listPayments);
router.post("/", createPayment);

export default router;
