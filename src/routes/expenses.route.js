import { Router } from "express";
import { createExpense, deleteExpense, listExpenses, updateExpense } from "../controllers/expenses.controller.js";
import {
  authenticate,
  requireGym,
  allowRoles,
  allowReadAndCreateOnly,
} from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";

const router = Router();
router.use(authenticate, requireGym, allowReadAndCreateOnly, requireActiveSubscription());

router.get("/", listExpenses);
router.post("/", createExpense);
router.patch("/:id", updateExpense);
router.delete("/:id", allowRoles("ADMIN"), deleteExpense);

export default router;
