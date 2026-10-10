import { z } from "zod";

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
