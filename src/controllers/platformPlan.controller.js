// ---------------------------------------------------------------------------
// Platform plan administration + the owner-facing plan catalogue.
//
// Plans are the SaaS plans the platform owner sells to gyms — NOT the gym's own
// MembershipPlan products. Price changes only affect future orders because each
// SubscriptionPayment stores an immutable planSnapshot + amountBreakdown.
// ---------------------------------------------------------------------------

import { prisma } from "../db.js";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from "../utils/http-error.js";
import { DEFAULT_CURRENCY } from "../config/razorpay.js";
import { calculatePricing } from "../services/pricing.service.js";
import {
  serializePlan,
  buildPlanSnapshot,
} from "../services/platformPayment.service.js";
import { findCoupon } from "../config/razorpay.js";
import {
  createPlanSchema,
  updatePlanSchema,
  planStatusSchema,
  planQuoteSchema,
  planAuditQuerySchema,
} from "../validators/platform.validator.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireSuperAdmin(actor) {
  if (!actor || actor.role !== "SUPER_ADMIN") {
    throw forbidden("SaaS super-admin access required", "SUPER_ADMIN_REQUIRED");
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uniqueValue({ field, value, excludeId = null }) {
  const existing = await prisma.subscriptionPlan.findFirst({
    where: {
      [field]: value,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return !existing;
}

async function uniqueSlug(base, excludeId = null) {
  const root = slugify(base) || "plan";
  let candidate = root;
  let suffix = 1;
  // eslint-disable-next-line no-await-in-loop
  while (!(await uniqueValue({ field: "slug", value: candidate, excludeId }))) {
    suffix += 1;
    candidate = `${root}-${suffix}`.slice(0, 60);
  }
  return candidate;
}

function validateFinalAmounts(plan) {
  if ((plan.discountPaise ?? 0) > plan.pricePaise) {
    throw badRequest("Discount cannot exceed the plan price", "INVALID_DISCOUNT");
  }
}

function planAuditValues(plan) {
  return {
    name: plan.name,
    pricePaise: plan.pricePaise,
    gstPercent: plan.gstPercent ?? 0,
    discountPaise: plan.discountPaise ?? 0,
    durationDays: plan.durationDays ?? null,
    durationMonths: plan.durationMonths,
    isActive: plan.isActive,
    features: plan.features ?? [],
  };
}

function auditEntry(actor, { action, plan, oldValues = null, newValues = null, reason, details }) {
  return prisma.subscriptionAuditLog.create({
    data: {
      action,
      planId: plan?.id ?? null,
      actorUserId: actor?.id ?? null,
      actorEmail: actor?.email ?? null,
      actorRole: actor?.role ?? null,
      reason: reason ?? null,
      details: details ?? null,
      oldValues,
      newValues,
    },
  });
}

function withPreview(plan) {
  const preview = calculatePricing({
    basePricePaise: plan.pricePaise,
    gstPercent: plan.gstPercent ?? 0,
    planDiscountPaise: plan.discountPaise ?? 0,
  });
  return {
    ...serializePlan(plan),
    priceIncludingGstPaise: preview.total,
    amountBreakdown: preview,
  };
}

// ---------------------------------------------------------------------------
// Public catalogue
// ---------------------------------------------------------------------------

/** GET /platform/plans — active, non-deleted plans. */
export async function listPlans(req, res, next) {
  try {
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: [{ displayOrder: "asc" }, { pricePaise: "asc" }],
    });
    res.json({ data: plans.map(withPreview) });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/plans/:id/quote — server-side coupon/price preview. */
export async function quotePlan(req, res, next) {
  try {
    const input = planQuoteSchema.parse(req.body ?? {});
    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: req.params.id },
    });
    if (!plan || plan.deletedAt || !plan.isActive) {
      throw notFound("Plan not found", "PLAN_NOT_FOUND");
    }

    let coupon = null;
    if (input.couponCode) {
      coupon = findCoupon(input.couponCode);
      if (!coupon) throw badRequest("Coupon code is invalid", "INVALID_COUPON");
    }

    const amountBreakdown = calculatePricing({
      basePricePaise: plan.pricePaise,
      gstPercent: plan.gstPercent ?? 0,
      planDiscountPaise: plan.discountPaise ?? 0,
      coupon,
    });

    res.json({
      data: {
        plan: serializePlan(plan),
        amountBreakdown,
        currency: plan.currency || DEFAULT_CURRENCY,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ---------------------------------------------------------------------------
// Super-admin CRUD
// ---------------------------------------------------------------------------

/** GET /platform/admin/plans — every plan, including inactive/archived. */
export async function listPlansAdmin(req, res, next) {
  try {
    requireSuperAdmin(req.user);
    const plans = await prisma.subscriptionPlan.findMany({
      orderBy: [{ deletedAt: "asc" }, { displayOrder: "asc" }, { createdAt: "asc" }],
    });
    res.json({ data: plans.map(withPreview) });
  } catch (err) {
    next(err);
  }
}

/** POST /platform/admin/plans */
export async function createPlan(req, res, next) {
  try {
    requireSuperAdmin(req.user);
    const input = createPlanSchema.parse(req.body);
    const code = input.code ?? `PLAN_${Date.now().toString(36).toUpperCase()}`;
    const slug = input.slug ?? (await uniqueSlug(input.name));

    if (!(await uniqueValue({ field: "code", value: code }))) {
      throw conflict("A plan with this code already exists", "PLAN_CODE_EXISTS");
    }
    if (!(await uniqueValue({ field: "slug", value: slug }))) {
      throw conflict("A plan with this slug already exists", "PLAN_SLUG_EXISTS");
    }

    const durationDays = input.durationDays ?? input.durationMonths * 30;
    validateFinalAmounts({
      pricePaise: input.pricePaise,
      discountPaise: input.discountPaise ?? 0,
    });

    const plan = await prisma.subscriptionPlan.create({
      data: {
        code,
        slug,
        name: input.name,
        description: input.description ?? null,
        pricePaise: input.pricePaise,
        currency: (input.currency ?? DEFAULT_CURRENCY).toUpperCase(),
        durationDays,
        // Keep the legacy column populated so old admin screens still show a
        // meaningful duration.
        durationMonths:
          input.durationMonths ?? Math.max(1, Math.round(durationDays / 30)),
        gstPercent: input.gstPercent ?? 0,
        discountPaise: input.discountPaise ?? 0,
        features: input.features ?? [],
        isActive: input.isActive ?? true,
        displayOrder: input.displayOrder ?? 0,
        maxStaff: input.maxStaff ?? null,
        maxBranches: input.maxBranches ?? null,
        createdBy: req.user.id,
        updatedBy: req.user.id,
      },
    });

    await auditEntry(req.user, {
      action: "PLAN_CREATED",
      plan,
      newValues: planAuditValues(plan),
      reason: "Platform plan created",
      details: { snapshot: buildPlanSnapshot(plan) },
    });

    res.status(201).json({ data: withPreview(plan), message: "Plan created" });
  } catch (err) {
    next(err);
  }
}

/** PATCH /platform/admin/plans/:id */
export async function updatePlan(req, res, next) {
  try {
    requireSuperAdmin(req.user);
    const input = updatePlanSchema.parse(req.body);

    const existing = await prisma.subscriptionPlan.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.deletedAt) {
      throw notFound("Plan not found", "PLAN_NOT_FOUND");
    }

    if (
      input.code !== undefined &&
      input.code !== existing.code &&
      !(await uniqueValue({ field: "code", value: input.code, excludeId: existing.id }))
    ) {
      throw conflict("A plan with this code already exists", "PLAN_CODE_EXISTS");
    }
    if (
      input.slug !== undefined &&
      input.slug !== null &&
      input.slug !== existing.slug &&
      !(await uniqueValue({ field: "slug", value: input.slug, excludeId: existing.id }))
    ) {
      throw conflict("A plan with this slug already exists", "PLAN_SLUG_EXISTS");
    }

    const finalPrice = input.pricePaise ?? existing.pricePaise;
    const finalDiscount = input.discountPaise ?? existing.discountPaise;
    validateFinalAmounts({ pricePaise: finalPrice, discountPaise: finalDiscount });

    const plan = await prisma.subscriptionPlan.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.pricePaise !== undefined ? { pricePaise: input.pricePaise } : {}),
        ...(input.currency !== undefined
          ? { currency: input.currency.toUpperCase() }
          : {}),
        ...(input.durationDays !== undefined
          ? { durationDays: input.durationDays }
          : {}),
        ...(input.durationMonths !== undefined
          ? { durationMonths: input.durationMonths }
          : {}),
        ...(input.gstPercent !== undefined ? { gstPercent: input.gstPercent } : {}),
        ...(input.discountPaise !== undefined
          ? { discountPaise: input.discountPaise }
          : {}),
        ...(input.features !== undefined ? { features: input.features } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.displayOrder !== undefined
          ? { displayOrder: input.displayOrder }
          : {}),
        ...(input.maxStaff !== undefined ? { maxStaff: input.maxStaff } : {}),
        ...(input.maxBranches !== undefined ? { maxBranches: input.maxBranches } : {}),
        updatedBy: req.user.id,
      },
    });

    const before = planAuditValues(existing);
    const after = planAuditValues(plan);
    const priceFields = ["pricePaise", "gstPercent", "discountPaise", "durationDays", "durationMonths"];
    const priceChanged = priceFields.some((field) => before[field] !== after[field]);

    await auditEntry(req.user, {
      action: priceChanged ? "PLAN_PRICE_CHANGED" : "PLAN_UPDATED",
      plan,
      oldValues: before,
      newValues: after,
      reason: priceChanged ? "Plan pricing changed" : "Platform plan updated",
      details: {
        changedFields: Object.keys(after).filter((key) => before[key] !== after[key]),
        // Existing subscriptions and paid orders keep their snapshots.
        affectsExistingOrders: false,
      },
    });

    res.json({
      data: withPreview(plan),
      message: priceChanged
        ? "Plan updated. New prices apply to future orders only."
        : "Plan updated",
    });
  } catch (err) {
    next(err);
  }
}

/** PATCH /platform/admin/plans/:id/status */
export async function setPlanStatus(req, res, next) {
  try {
    requireSuperAdmin(req.user);
    const { isActive } = planStatusSchema.parse(req.body);

    const existing = await prisma.subscriptionPlan.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.deletedAt) {
      throw notFound("Plan not found", "PLAN_NOT_FOUND");
    }

    const plan = await prisma.subscriptionPlan.update({
      where: { id: existing.id },
      data: { isActive, updatedBy: req.user.id },
    });

    await auditEntry(req.user, {
      action: isActive ? "PLAN_ACTIVATED" : "PLAN_DEACTIVATED",
      plan,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive: plan.isActive },
      reason: isActive ? "Plan enabled" : "Plan disabled",
      details: { affectsExistingSubscriptions: false },
    });

    res.json({
      data: withPreview(plan),
      message: isActive
        ? "Plan enabled for new purchases"
        : "Plan disabled for new purchases",
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /platform/admin/plans/:id
 * Soft delete. Existing subscriptions and payment snapshots are preserved, so
 * a deleted plan can never rewrite billing history.
 */
export async function deletePlan(req, res, next) {
  try {
    requireSuperAdmin(req.user);
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { id: req.params.id },
    });
    if (!existing || existing.deletedAt) {
      throw notFound("Plan not found", "PLAN_NOT_FOUND");
    }

    const plan = await prisma.subscriptionPlan.update({
      where: { id: existing.id },
      data: {
        isActive: false,
        deletedAt: new Date(),
        updatedBy: req.user.id,
      },
    });

    await auditEntry(req.user, {
      action: "PLAN_DELETED",
      plan,
      oldValues: { isActive: existing.isActive, deletedAt: existing.deletedAt },
      newValues: { isActive: false, deletedAt: plan.deletedAt },
      reason: "Platform plan archived",
      details: { softDelete: true, affectsExistingSubscriptions: false },
    });

    res.json({ data: { id: plan.id }, message: "Plan archived" });
  } catch (err) {
    next(err);
  }
}

/** GET /platform/admin/plans/:id/audit — price/plan change trail. */
export async function listPlanAudit(req, res, next) {
  try {
    requireSuperAdmin(req.user);
    const { limit } = planAuditQuerySchema.parse(req.query);

    const plan = await prisma.subscriptionPlan.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true },
    });
    if (!plan) throw notFound("Plan not found", "PLAN_NOT_FOUND");

    const logs = await prisma.subscriptionAuditLog.findMany({
      where: { planId: plan.id },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    res.json({
      data: {
        plan,
        logs: logs.map((log) => ({
          id: log.id,
          action: log.action,
          actorUserId: log.actorUserId,
          actorEmail: log.actorEmail,
          actorRole: log.actorRole,
          reason: log.reason,
          oldValues: log.oldValues ?? null,
          newValues: log.newValues ?? null,
          details: log.details ?? null,
          at: log.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}
