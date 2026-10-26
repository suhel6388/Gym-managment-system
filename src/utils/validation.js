import { z } from "zod";

import { Timing, PaymentMode } from "../../generated/prisma/client"

export const memberInput = z.object({
  memberCode: z.string().trim().min(1).max(50).optional(),
  name: z
    .string({ error: "Member name is required" })
    .trim()
    .min(1, "Member name is required")
    .max(100, "Member name must be 100 characters or fewer"),
  phone: z
    .string({ error: "Mobile number is required" })
    .trim()
    .min(7, "Mobile number must be at least 7 digits")
    .max(20, "Mobile number must be 20 characters or fewer"),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(191)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Required for new members. `memberInput.partial()` keeps updates
  // backwards-compatible: existing members can be patched without resending
  // these fields, but a value that *is* provided must be valid.
  dateOfBirth: z.coerce
    .date({ error: "Enter a valid date of birth" })
    .refine(
      (value) => value.getTime() <= Date.now(),
      "Date of birth can't be in the future"
    ),
  gender: z
    .string({ error: "Gender is required" })
    .trim()
    .min(1, "Gender is required")
    .max(40, "Gender must be 40 characters or fewer"),
  address: z.string().trim().max(500).nullable().optional(),
  emergencyContact: z.string().trim().max(120).nullable().optional(),
  emergencyPhone: z.string().trim().max(30).nullable().optional(),
  joinedAt: z.coerce.date().optional(),
  timing: z.nativeEnum(Timing).optional(),
  notes: z.string().trim().max(2000).nullable().optional()
})
export const expenseInput = z.object({
  title: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  /** Amount in paise (minor units). */
  amountPaise: z.number().int().min(0),
  expenseDate: z.coerce.date().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const planInput = z.object({
  name: z.string().trim().min(2).max(120),
  pricePaise: z.number().int().min(0),
  durationMonths: z.number().int().min(1).max(60),
  description: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});

export const paymentInput = z.object({
  memberId: z.string().trim().min(1),
  amount: z.number().nonnegative(),
  paymentMode: z.nativeEnum(PaymentMode),
  reference: z.string().trim().max(191).nullable().optional(),
  paymentDate: z.coerce.date().optional(),
  status: z.string().trim().max(40).optional(),
});

export const idParam = z.object({
  id: z.string().trim().min(1),
});
