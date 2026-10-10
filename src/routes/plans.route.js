import { Router } from "express";
import { prisma } from "../db.js";
import { authenticate, requireGym } from "../middleware/auth.js";
import { planInput, idParam } from "../utils/validation.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/", async (req, res, next) => {
  try {
    const data = await prisma.membershipPlan.findMany({
      where: { gymId: req.user.gymId, isActive: true },
      orderBy: { createdAt: "desc" }
    });
    res.json({ data });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const input = planInput.parse(req.body);
    const data = await prisma.membershipPlan.create({ data: { ...input, gymId: req.user.gymId } });
    res.status(201).json({ data });
  } catch (err) { next(err); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const input = planInput.partial().parse(req.body);
    const found = await prisma.membershipPlan.findFirst({ where: { id, gymId: req.user.gymId } });
    if (!found) return res.status(404).json({ error: "Plan not found" });
    const data = await prisma.membershipPlan.update({ where: { id }, data: input });
    res.json({ data });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const result = await prisma.membershipPlan.updateMany({
      where: { id, gymId: req.user.gymId },
      data: { isActive: false }
    });
    if (!result.count) return res.status(404).json({ error: "Plan not found" });
    res.json({ message: "Plan deactivated" });
  } catch (err) { next(err); }
});

export default router;
