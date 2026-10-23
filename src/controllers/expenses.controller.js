import { prisma } from "../db.js";
import { expenseInput } from "../utils/validation.js";

/**
 * The public API uses `title`, `notes` and `amountPaise`, while the Prisma
 * `Expense` model stores them as `name`, `description` and `amount`. Keeping
 * the mapping here means the frontend contract stays stable.
 */
function toExpenseDto(expense) {
  return {
    id: expense.id,
    gymId: expense.gymId,
    title: expense.name,
    category: expense.category,
    amountPaise: Math.round(expense.amount),
    expenseDate: expense.expenseDate,
    notes: expense.description ?? null,
    createdAt: expense.createdAt,
  };
}

function toPrismaData(input) {
  const data = {};
  if (input.title !== undefined) data.name = input.title;
  if (input.category !== undefined) data.category = input.category;
  if (input.amountPaise !== undefined) data.amount = input.amountPaise;
  if (input.expenseDate !== undefined) data.expenseDate = input.expenseDate;
  if (input.notes !== undefined) data.description = input.notes;
  return data;
}

/** `Expense.id` is an Int; route params arrive as strings. */
function parseExpenseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function listExpenses(req, res, next) {
  try {
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;
    const rows = await prisma.expense.findMany({
      where: {
        gymId: req.user.gymId,
        ...(from || to ? { expenseDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
      },
      orderBy: { expenseDate: "desc" },
      take: 500
    });
    res.json({ data: rows.map(toExpenseDto) });
  } catch (err) { next(err); }
}

export async function createExpense(req, res, next) {
  try {
    const input = expenseInput.parse(req.body);
    const data = await prisma.expense.create({
      data: { ...toPrismaData(input), gymId: req.user.gymId }
    });
    res.status(201).json({ data: toExpenseDto(data) });
  } catch (err) { next(err); }
}

export async function updateExpense(req, res, next) {
  try {
    const id = parseExpenseId(req.params.id);
    if (!id) return res.status(404).json({ error: "Expense not found" });

    const input = expenseInput.partial().parse(req.body);
    const found = await prisma.expense.findFirst({ where: { id, gymId: req.user.gymId } });
    if (!found) return res.status(404).json({ error: "Expense not found" });

    const data = await prisma.expense.update({
      where: { id: found.id },
      data: toPrismaData(input)
    });
    res.json({ data: toExpenseDto(data) });
  } catch (err) { next(err); }
}

export async function deleteExpense(req, res, next) {
  try {
    const id = parseExpenseId(req.params.id);
    if (!id) return res.status(404).json({ error: "Expense not found" });

    const result = await prisma.expense.deleteMany({ where: { id, gymId: req.user.gymId } });
    if (!result.count) return res.status(404).json({ error: "Expense not found" });
    res.json({ message: "Expense deleted" });
  } catch (err) { next(err); }
}
