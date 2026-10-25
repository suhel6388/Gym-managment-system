// Controller for creating the second platform administrator.
// Mounted at POST /api/v1/super-admin/admins behind
// authenticate + requireSuperAdmin (see src/routes/super-admin.route.js).

import { z } from "zod";

import { createPlatformAdmin } from "../services/super-admin-accounts.service.js";

export const createAdminSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  // Platform owners can read every gym's billing data; 12 chars matches the
  // bootstrap endpoint and scripts/make-super-admin.mjs.
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password must be at most 128 characters"),
});

export async function createAdmin(req, res, next) {
  try {
    const input = createAdminSchema.parse(req.body ?? {});
    const result = await createPlatformAdmin(req.user, input);

    // Audit line without the password or hash.
    console.log(
      `[auth] super-admin ${result.promoted ? "promoted" : "created"} ` +
        `${result.user.email} (${result.user.id}) by ${req.user.id}`,
    );

    return res.status(201).json({
      message: result.promoted
        ? "Existing account promoted to platform administrator. No OTP is required — sign in with the password you supplied."
        : "Platform administrator created. No OTP is required — sign in with the password you supplied.",
      promoted: result.promoted,
      remainingSlots: result.remainingSlots,
      user: result.user,
      login: {
        method: "POST",
        path: "/api/v1/auth/super-admin/login",
        body: { email: result.user.email, password: "<the password you supplied>" },
      },
    });
  } catch (err) {
    if (err?.name === "ZodError") {
      const first = err?.issues?.[0];
      return res.status(400).json({
        error: first?.message ?? "Validation failed",
        code: "VALIDATION_FAILED",
      });
    }
    next(err);
  }
}
