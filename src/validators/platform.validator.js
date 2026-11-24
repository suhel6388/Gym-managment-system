// ---------------------------------------------------------------------------
// Zod schemas for the platform (SaaS) billing API.
//
// Everything that reaches the server is validated here. Money is always an
// integer number of paise; the client may never supply a computed amount — it
// only sends a planId, an optional coupon code and, after Razorpay Checkout,
// the provider's order/payment/signature triple.
// ---------------------------------------------------------------------------

import { z } from "zod";

import { MAX_GST_PERCENT } from "../services/pricing.service.js";

export const MAX_PRICE_PAISE = 100_000_000; // ₹10,00,000
export const MAX_DURATION_DAYS = 3650;

const nameSchema = z.string().trim().min(2).max(80);
const descriptionSchema = z.string().trim().max(500).nullable().optional();
const codeSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Z0-9_]+$/, "Code must use uppercase letters, numbers or underscores");
const slugSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase words separated by dashes");

const priceSchema = z.number().int().min(0).max(MAX_PRICE_PAISE);
const durationDaysSchema = z.number().int().min(1).max(MAX_DURATION_DAYS);
const durationMonthsSchema = z.number().int().min(1).max(120);
const gstSchema = z.number().int().min(0).max(MAX_GST_PERCENT);
const discountSchema = z.number().int().min(0).max(MAX_PRICE_PAISE);
const featuresSchema = z.array(z.string().trim().min(1).max(120)).max(30).optional();

// ---------------------------------------------------------------------------
// Plan CRUD
// ---------------------------------------------------------------------------

export const createPlanSchema = z
  .object({
    name: nameSchema,
    code: codeSchema.optional(),
    slug: slugSchema.optional(),
    description: descriptionSchema,
    pricePaise: priceSchema,
    currency: z.string().trim().length(3).optional(),
    durationDays: durationDaysSchema.optional(),
    durationMonths: durationMonthsSchema.optional(),
    gstPercent: gstSchema.optional(),
    discountPaise: discountSchema.optional(),
    features: featuresSchema,
    isActive: z.boolean().optional(),
    displayOrder: z.number().int().min(0).max(999).optional(),
    maxStaff: z.number().int().min(0).max(100_000).nullable().optional(),
    maxBranches: z.number().int().min(0).max(10_000).nullable().optional(),
  })
  .refine((value) => value.durationDays || value.durationMonths, {
    message: "Provide durationDays (preferred) or durationMonths",
    path: ["durationDays"],
  })
  .refine((value) => (value.discountPaise ?? 0) <= value.pricePaise, {
    message: "Discount cannot exceed the plan price",
    path: ["discountPaise"],
  });

export const updatePlanSchema = z.object({
  name: nameSchema.optional(),
  code: codeSchema.optional(),
  slug: slugSchema.nullable().optional(),
  description: descriptionSchema,
  pricePaise: priceSchema.optional(),
  currency: z.string().trim().length(3).optional(),
  durationDays: durationDaysSchema.nullable().optional(),
  durationMonths: durationMonthsSchema.optional(),
  gstPercent: gstSchema.optional(),
  discountPaise: discountSchema.optional(),
  features: featuresSchema,
  isActive: z.boolean().optional(),
  displayOrder: z.number().int().min(0).max(999).optional(),
  maxStaff: z.number().int().min(0).max(100_000).nullable().optional(),
  maxBranches: z.number().int().min(0).max(10_000).nullable().optional(),
});

export const planStatusSchema = z.object({ isActive: z.boolean() });

export const planQuoteSchema = z.object({
  couponCode: z.string().trim().max(32).optional().nullable(),
});

export const planAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const createOrderSchema = z.object({
  planId: z.string().trim().min(1).max(64),
  couponCode: z.string().trim().max(32).optional().nullable(),
});

export const verifyPaymentSchema = z.object({
  orderId: z.string().trim().min(1).max(120),
  paymentId: z.string().trim().min(1).max(120),
  signature: z.string().trim().min(1).max(256),
});

export const paymentHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const paymentStatusEnum = z.enum([
  "CREATED",
  "PENDING",
  "SUCCESS",
  "FAILED",
  "REFUNDED",
  "DISPUTED",
]);

export const adminPaymentListSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: paymentStatusEnum.optional(),
  planId: z.string().trim().min(1).optional(),
  gymId: z.string().trim().min(1).optional(),
  from: z.string().trim().min(1).optional(),
  to: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Super-admin subscription actions
// ---------------------------------------------------------------------------

export const gymSubscriptionActionSchema = z
  .object({
    action: z.enum([
      "grant_trial",
      "assign_plan",
      "extend",
      "suspend",
      "resume",
      "end_trial",
    ]),
    planId: z.string().trim().min(1).optional(),
    days: z.coerce.number().int().min(1).max(3650).optional(),
    additionalDays: z.coerce.number().int().min(1).max(3650).optional(),
    expiresAt: z.string().trim().min(1).optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .superRefine((value, ctx) => {
    if (value.action === "assign_plan" && !value.planId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["planId"],
        message: "planId is required to assign a plan",
      });
    }
    if (
      value.action === "extend" &&
      value.additionalDays === undefined &&
      !value.expiresAt
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["additionalDays"],
        message: "Provide additionalDays or expiresAt",
      });
    }
  });

export const gymAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
