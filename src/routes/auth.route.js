import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// Sign up/sign in is handled by Better Auth at /api/auth/*.
// After email or Google sign-in, the user creates/attaches their gym here.
router.post("/setup-gym", authenticate, async (req, res, next) => {
  try {
    if (req.user.gymId) {
      return res.status(409).json({ error: "Your account already belongs to a gym" });
    }
    const input = z.object({
      name: z.string().trim().min(2).max(120),
      phone: z.string().trim().max(30).optional(),
      email: z.string().email().optional()
    }).parse(req.body);

    const gym = await prisma.$transaction(async (tx) => {
      const created = await tx.gym.create({
        data: { name: input.name, phone: input.phone, email: input.email }
      });
      await tx.user.update({
        where: { id: req.user.id },
        data: { gymId: created.id, role: "OWNER" }
      });
      return created;
    });

    res.status(201).json({
      data: { id: gym.id, name: gym.name, phone: gym.phone },
      message: "Gym created. You can now use the gym management APIs."
    });
  } catch (err) { next(err); }
});

export default router;
