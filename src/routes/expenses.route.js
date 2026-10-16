import { Router } from "express";
import { createExpense, deleteExpense, listExpenses, updateExpense } from "../controllers/expenses.controller.js";
import { authenticate, requireGym, allowRoles, allowReadAndCreateOnly } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym, allowReadAndCreateOnly);

router.get("/", listExpenses);
router.post("/", createExpense);
router.patch("/:id", updateExpense);
router.delete("/:id", allowRoles("ADMIN"), deleteExpense);

export default router;
