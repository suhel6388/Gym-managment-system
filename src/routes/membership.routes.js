import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate, requireGym } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/", async (req, res, next) => {
  try {
    const status = ["ACTIVE", "EXPIRED", "FROZEN", "CANCELLED"].includes(req.query.status) ? req.query.status : undefined;
    const data = await prisma.membership.findMany({
      where: { gymId: req.user.gymId, ...(status ? { status } : {}) },
      include: { member: true, plan: true },
      orderBy: { endDate: "asc" },
      take: 200
    });
    const now = new Date();
    res.json({ data: data.map(m => ({
      ...m,
      effectiveStatus: m.status === "ACTIVE" && m.endDate < now ? "EXPIRED" : m.status
    })) });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const input = z.object({
      memberId: z.string().min(1),
      planId: z.string().min(1),
      startDate: z.coerce.date().optional(),
      discountPaise: z.number().int().nonnegative().default(0)
    }).parse(req.body);
    const [member, plan] = await Promise.all([
      prisma.member.findFirst({ where: { id: input.memberId, gymId: req.user.gymId, archivedAt: null } }),
      prisma.membershipPlan.findFirst({ where: { id: input.planId, gymId: req.user.gymId, isActive: true } })
    ]);
    if (!member) return res.status(404).json({ error: "Member not found" });
    if (!plan) return res.status(404).json({ error: "Active plan not found" });
    const startDate = input.startDate || new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + plan.durationMonths);
    const data = await prisma.membership.create({
      data: {
        gymId: req.user.gymId, memberId: member.id, planId: plan.id,
        startDate, endDate, pricePaise: plan.pricePaise, discountPaise: input.discountPaise
      },
      include: { member: true, plan: true }
    });
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

router.post("/:id/freeze", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const result = await prisma.membership.updateMany({
      where: { id, gymId: req.user.gymId, status: "ACTIVE" },
      data: { status: "FROZEN", frozenAt: new Date() }
    });
    if (!result.count) return res.status(404).json({ error: "Active membership not found" });
    res.json({ message: "Membership frozen. Expiry extension policy should be applied when unfreezing." });
  } catch (err) { next(err); }
});

router.post("/:id/cancel", async (req, res, next) => {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const result = await prisma.membership.updateMany({
      where: { id, gymId: req.user.gymId, status: { in: ["ACTIVE", "FROZEN"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() }
    });
    if (!result.count) return res.status(404).json({ error: "Membership not found or already closed" });
    res.json({ message: "Membership cancelled" });
  } catch (err) { next(err); }
});

export default router;
