import { prisma } from "../db.js";
import { idParam, planInput } from "../utils/validation.js";

export async function listPlans(req, res, next) {
  try {
    const data = await prisma.membershipPlan.findMany({
      where: { gymId: req.user.gymId, isActive: true },
      orderBy: { createdAt: "desc" }
    });
    res.json({ data });
  } catch (err) { next(err); }
}

export async function createPlan(req, res, next) {
  try {
    const input = planInput.parse(req.body);
    const data = await prisma.membershipPlan.create({ data: { ...input, gymId: req.user.gymId } });
    res.status(201).json({ data });
  } catch (err) { next(err); }
}

export async function updatePlan(req, res, next) {
  try {
    const { id } = idParam.parse(req.params);
    const input = planInput.partial().parse(req.body);
    const found = await prisma.membershipPlan.findFirst({ where: { id, gymId: req.user.gymId } });
    if (!found) return res.status(404).json({ error: "Plan not found" });
    const data = await prisma.membershipPlan.update({ where: { id }, data: input });
    res.json({ data });
  } catch (err) { next(err); }
}

export async function deactivatePlan(req, res, next) {
  try {
    const { id } = idParam.parse(req.params);
    const result = await prisma.membershipPlan.updateMany({
      where: { id, gymId: req.user.gymId },
      data: { isActive: false }
    });
    if (!result.count) return res.status(404).json({ error: "Plan not found" });
    res.json({ message: "Plan deactivated" });
  } catch (err) { next(err); }
}
