import { Router } from "express";
import { prisma } from "../db.js";
import { authenticate, requireGym, allowRoles } from "../middleware/auth.js";
import { expenseInput } from "../utils/validation.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/", async (req, res, next) => {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const data = await prisma.expense.findMany({
      where: {
        gymId: req.user.gymId,
        ...(from || to ? { expenseDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
      },
      orderBy: { expenseDate: "desc" },
      take: 500
    });
    res.json({ data });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const input = expenseInput.parse(req.body);
    const data = await prisma.expense.create({ data: { ...input, gymId: req.user.gymId } });
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const input = expenseInput.partial().parse(req.body);
    const found = await prisma.expense.findFirst({ where: { id: req.params.id, gymId: req.user.gymId } });
    if (!found) return res.status(404).json({ error: "Expense not found" });
    const data = await prisma.expense.update({ where: { id: found.id }, data: input });
    res.json({ data });
  } catch (err) { next(err); }
});

router.delete("/:id", allowRoles("OWNER", "ADMIN", "ACCOUNTANT"), async (req, res, next) => {
  try {
    const result = await prisma.expense.deleteMany({ where: { id: req.params.id, gymId: req.user.gymId } });
    if (!result.count) return res.status(404).json({ error: "Expense not found" });
    res.json({ message: "Expense deleted" });
  } catch (err) { next(err); }
});

export default router;
