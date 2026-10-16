import { z } from "zod";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { prisma } from "../db.js";

// Validation for the receptionist account the admin wants to create.
const createReceptionistSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Invalid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  phone: z.string().trim().min(10).max(16).optional(),
});

// Only these fields are ever sent back to the admin.
function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    gymId: user.gymId,
    createdAt: user.createdAt,
  };
}

// POST /api/v1/staff/receptionists (ADMIN only)
// Creates a login for a receptionist inside the admin's gym.
// The receptionist can sign in right away — no OTP step.
export async function createReceptionist(req, res, next) {
  try {
    const input = createReceptionistSchema.parse(req.body);

    // 1. Email / phone must be unique across the whole app.
    const taken = await prisma.user.findFirst({
      where: {
        OR: [
          { email: input.email },
          ...(input.phone ? [{ phone: input.phone }] : []),
        ],
      },
      select: { id: true },
    });
    if (taken) {
      return res.status(409).json({ error: "An account with this email or phone already exists" });
    }

    // 2. Create the auth account (hashes the password for us).
    //    We do NOT forward its cookies, so the admin stays logged in.
    const signupResponse = await auth.api.signUpEmail({
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
        ...(input.phone ? { phone: input.phone } : {}),
      },
      headers: fromNodeHeaders(req.headers),
      asResponse: true,
    });

    if (signupResponse.status === 422) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }
    if (signupResponse.status >= 400) {
      const body = await signupResponse.json().catch(() => null);
      return res.status(signupResponse.status).json({
        error: body?.message ?? "Could not create receptionist",
      });
    }

    const signupBody = await signupResponse.json().catch(() => null);
    const newUserId = signupBody?.user?.id;
    if (!newUserId) {
      return res.status(500).json({ error: "Account created but user id is missing" });
    }

    // 3. Attach the new user to the admin's gym as RECEPTIONIST
    //    and mark the email verified so they can log in immediately.
    const user = await prisma.user.update({
      where: { id: newUserId },
      data: {
        gymId: req.user.gymId,
        role: "RECEPTIONIST",
        emailVerified: true,
      },
    });

    return res.status(201).json({
      message: "Receptionist account created. They can now log in.",
      data: toPublicUser(user),
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      return res.status(400).json({ error: err.issues?.[0]?.message ?? "Validation failed" });
    }
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "An account with this email or phone already exists" });
    }
    next(err);
  }
}

// GET /api/v1/staff/receptionists (ADMIN only)
// Lists everyone working in the admin's gym.
export async function listStaff(req, res, next) {
  try {
    const users = await prisma.user.findMany({
      where: { gymId: req.user.gymId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        gymId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json({ data: users });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/v1/staff/receptionists/:id (ADMIN only)
// Removes a receptionist from the gym. Admins cannot delete themselves
// or other admins — only RECEPTIONIST accounts.
export async function deleteReceptionist(req, res, next) {
  try {
    const target = await prisma.user.findFirst({
      where: { id: req.params.id, gymId: req.user.gymId },
      select: { id: true, role: true },
    });
    if (!target) {
      return res.status(404).json({ error: "Staff member not found" });
    }
    if (target.id === req.user.id) {
      return res.status(400).json({ error: "You cannot delete your own account" });
    }
    if (target.role !== "RECEPTIONIST") {
      return res.status(403).json({ error: "Only RECEPTIONIST accounts can be deleted here" });
    }

    await prisma.user.delete({ where: { id: target.id } });
    return res.json({ message: "Receptionist removed" });
  } catch (err) {
    next(err);
  }
}
