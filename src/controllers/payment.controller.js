import { prisma } from "../db.js";
import { paymentInput } from "../utils/validation.js";

/** Generates a receipt number that is unique within the gym, e.g. `RCPT-0001`. */
async function generateReceiptNumber(gymId) {
  const count = await prisma.payment.count({ where: { gymId } });
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const receiptNumber = `RCPT-${String(count + 1 + attempt).padStart(4, "0")}`;
    const exists = await prisma.payment.findUnique({
      where: { gymId_receiptNumber: { gymId, receiptNumber } },
      select: { id: true }
    });
    if (!exists) return receiptNumber;
  }
  return `RCPT-${Date.now().toString(36).toUpperCase()}`;
}

export async function listPayments(req, res, next) {
  try {
    const data = await prisma.payment.findMany({
      where: { gymId: req.user.gymId },
      include: { member: { select: { id: true, name: true, memberCode: true } } },
      orderBy: { paidAt: "desc" },
      take: 200
    });
    res.json({ data });
  } catch (err) { next(err); }
}

export async function createPayment(req, res, next) {
  try {
    const input = paymentInput.parse(req.body);
    const member = await prisma.member.findFirst({
      where: { id: input.memberId, gymId: req.user.gymId, archivedAt: null },
      select: { id: true }
    });
    if (!member) return res.status(404).json({ error: "Member not found" });

    const receiptNumber = await generateReceiptNumber(req.user.gymId);
    const data = await prisma.payment.create({
      data: {
        gymId: req.user.gymId,
        memberId: member.id,
        amount: input.amount,
        paymentMode: input.paymentMode,
        receiptNumber,
        reference: input.reference ?? null,
        paymentDate: input.paymentDate ?? new Date(),
        status: input.status ?? "SUCCESS"
      }
    });
    res.status(201).json({ data });
  } catch (err) { next(err); }
}
