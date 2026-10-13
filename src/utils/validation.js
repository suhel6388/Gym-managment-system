import { z } from "zod";

import { Timing } from "../../generated/prisma/client"

export const memberInput = z.object({
  memberCode: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(20),
  joinedAt: z.coerce.date().optional(),
  timing: z.nativeEnum(Timing).optional(),
  notes: z.string().trim().max(2000).nullable().optional()
})
export const expenseInput = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(80).optional(),
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

export const idParam = z.object({
  id: z.string().trim().min(1),
});
