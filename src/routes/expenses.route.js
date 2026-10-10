import { Router } from "express";
import { createExpense, deleteExpense, listExpenses, updateExpense } from "../controllers/expenses.controller.js";
import { authenticate, requireGym, allowRoles } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/", listExpenses);
router.post("/", createExpense);
router.patch("/:id", updateExpense);
router.delete("/:id", allowRoles("OWNER", "ADMIN", "ACCOUNTANT"), deleteExpense);

export default router;
