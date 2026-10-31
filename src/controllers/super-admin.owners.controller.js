// Controller for onboarding a gym and its owner from the platform console.
// Mounted at POST /api/v1/super-admin/gyms behind
// authenticate + requireSuperAdmin (see src/routes/super-admin.route.js).

import { z } from "zod";
import { fromNodeHeaders } from "better-auth/node";

import { auth } from "../lib/auth.ts";
import { resolveClientOriginFromRequest } from "../lib/origins.ts";
import {
  createGymOwner,
  listGymOwners,
} from "../services/super-admin-gym-owners.service.js";

const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s\-()]/g, ""))
  .pipe(
    z
      .string()
      .min(10, "Mobile number must be 10-15 digits")
      .max(16, "Mobile number must be 10-15 digits")
      .regex(/^\+?\d{10,15}$/, "Invalid mobile number"),
  );

const emptyToUndefined = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
};

const optionalEmail = z.preprocess(
  emptyToUndefined,
  z.string().trim().toLowerCase().email("Enter a valid email address").optional(),
);

const optionalPhone = z.preprocess(emptyToUndefined, phoneSchema.optional());

/**
 * The owner can either receive a password from the platform admin or a secure
 * password-setup link by email. In INVITE mode no password is accepted, so a
 * client cannot set a known credential for an invitation.
 */
export const createGymOwnerSchema = z
  .object({
    ownerName: z
      .string()
      .trim()
      .min(2, "Owner name must be at least 2 characters")
      .max(100, "Owner name must be at most 100 characters"),
    ownerEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email("Enter a valid owner email address"),
    ownerPhone: phoneSchema,
    gymName: z
      .string()
      .trim()
      .min(2, "Gym name must be at least 2 characters")
      .max(120, "Gym name must be at most 120 characters"),
    gymEmail: optionalEmail,
    gymPhone: optionalPhone,
    gymAddress: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(300, "Address must be at most 300 characters").optional(),
    ),
    mode: z.enum(["PASSWORD", "INVITE"]).default("PASSWORD"),
    password: z
      .string()
      .max(128, "Password must be at most 128 characters")
      .optional(),
    planId: z.preprocess(
      emptyToUndefined,
      z.string().trim().min(1, "Select a valid plan").optional(),
    ),
    reason: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== "PASSWORD") return;
    if (!value.password) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Password is required when creating the account with a password",
      });
      return;
    }
    if (value.password.length < 8) {
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "Password must be at least 8 characters",
      });
    }
  });

export const listGymOwnersSchema = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["newest", "oldest", "name"]).default("newest"),
});

function validationResponse(res, err) {
  const first = err?.issues?.[0];
  return res.status(400).json({
    error: first?.message ?? "Validation failed",
    code: "VALIDATION_FAILED",
    details: err?.issues ?? undefined,
  });
}

/**
 * Send the secure password-setup email for INVITE mode.
 * A delivery failure must not undo the created account: the owner can always
 * use "Forgot password" from the sign-in page instead.
 */
async function sendOwnerInvitation(req, email) {
  try {
    const origin = resolveClientOriginFromRequest(req);
    await auth.api.requestPasswordReset({
      body: {
        email,
        redirectTo: `${origin}/reset-password`,
      },
      headers: fromNodeHeaders(req.headers),
    });
    return { sent: true, warning: null };
  } catch (err) {
    console.error(
      `[super-admin] Could not send the owner invitation to ${email}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return {
      sent: false,
      warning:
        "The gym and owner were created, but the invitation email could not be sent. Ask the owner to use Forgot password on the sign-in page.",
    };
  }
}

// POST /api/v1/super-admin/gyms
export async function createGym(req, res, next) {
  try {
    const input = createGymOwnerSchema.parse(req.body ?? {});
    const result = await createGymOwner(req.user, input);

    let invitation = result.data.invitation;
    if (input.mode === "INVITE") {
      const delivery = await sendOwnerInvitation(req, result.data.owner.email);
      invitation = { ...invitation, ...delivery };
    }

    // Audit line without the password or hash.
    console.log(
      `[super-admin] gym ${result.data.gym.id} and owner ${result.data.owner.id} ` +
        `created by ${req.user.id} (${input.mode})`,
    );

    const message = invitation.warning
      ? invitation.warning
      : input.mode === "INVITE"
        ? "Gym and owner created. A secure password-setup link was emailed to the owner."
        : result.message;

    return res.status(201).json({
      ...result,
      data: { ...result.data, invitation },
      message,
    });
  } catch (err) {
    if (err?.name === "ZodError") return validationResponse(res, err);
    next(err);
  }
}

// GET /api/v1/super-admin/owners
export async function getGymOwners(req, res, next) {
  try {
    const input = listGymOwnersSchema.parse(req.query);
    const result = await listGymOwners(req.user, {
      ...input,
      q: input.q?.trim() || undefined,
    });
    res.json(result);
  } catch (err) {
    if (err?.name === "ZodError") return validationResponse(res, err);
    next(err);
  }
}
