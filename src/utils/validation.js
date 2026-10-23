import { z } from "zod";

import { Timing, PaymentMode } from "../../generated/prisma/client"

export const memberInput = z.object({
  memberCode: z.string().trim().min(1).max(50).optional(),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(20),
  email: z
    .string()
    .trim()
    .email()
    .max(191)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  dateOfBirth: z.coerce.date().nullable().optional(),
  gender: z.string().trim().max(40).nullable().optional(),
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
