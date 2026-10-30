import { prisma } from "../db.js";
import { paymentInput } from "../utils/validation.js";

/** Number of receipt-number collisions tolerated before giving up. */
const AUTO_RECEIPT_ATTEMPTS = 5;

/**
 * Builds the next sequential receipt number, e.g. `RCPT-0001`.
 *
 * As with member codes, the `(gymId, receiptNumber)` unique constraint catches
 * concurrent inserts; `createPayment` retries with a fresh count instead of
 * pre-checking candidate numbers.
 */
async function nextReceiptNumber(gymId) {
  const count = await prisma.payment.count({ where: { gymId } });
  return `RCPT-${String(count + 1).padStart(4, "0")}`;
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

    let data;
    for (let attempt = 0; ; attempt += 1) {
      const receiptNumber = await nextReceiptNumber(req.user.gymId);
      try {
        data = await prisma.payment.create({
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
        break;
      } catch (err) {
        if (err?.code === "P2002" && attempt < AUTO_RECEIPT_ATTEMPTS - 1) {
          continue;
        }
        throw err;
      }
    }
    res.status(201).json({ data });
  } catch (err) {
    if (err?.code === "P2002") {
      return res.status(409).json({
        error: "Could not allocate a receipt number. Please retry."
      });
    }
    next(err);
  }
}
