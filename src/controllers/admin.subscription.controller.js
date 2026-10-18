// Super-admin subscription controllers.
//
// Every endpoint here requires an explicit SUPER_ADMIN role. Gym OWNER / ADMIN
// / RECEPTIONIST users are rejected by requireSuperAdmin. The role is never
// assignable from client input (better-auth marks `role` input:false); promote
// a user out-of-band with `tsx scripts/make-super-admin.mjs <email>`.

import { z } from "zod";

import {
  listAllPlans as listAllPlansService,
  createPlan as createPlanService,
  updatePlan as updatePlanService,
  setPlanStatus as setPlanStatusService,
  searchGyms as searchGymsService,
  getGymSubscriptionAdmin as getGymSubscriptionAdminService,
  extendTrial as extendTrialService,
  grantAccess as grantAccessService,
  readSettings as readSettingsService,
  updateSettings as updateSettingsService,
} from "../services/subscription.service.js";

export async function listPlansAdmin(req, res, next) {
  try {
    const result = await listAllPlansService();
    res.json(result);
  } catch (err) { next(err); }
}

export async function createPlanAdmin(req, res, next) {
  try {
    const input = z
      .object({
        code: z.string().trim().min(2).max(40).toUpperCase(),
        name: z.string().trim().min(2).max(120),
        description: z.string().trim().max(500).optional().nullable(),
        pricePaise: z.number().int().min(0),
        currency: z.string().trim().min(3).max(3).default("INR"),
        durationMonths: z.number().int().min(1).max(60),
        isActive: z.boolean().optional(),
        displayOrder: z.number().int().min(0).optional(),
        features: z.array(z.string()).optional(),
        maxStaff: z.number().int().min(0).optional().nullable(),
        maxBranches: z.number().int().min(0).optional().nullable(),
      })
      .parse(req.body);
    const result = await createPlanService(input, req.user);
    res.status(201).json(result);
  } catch (err) { next(err); }
}

export async function updatePlanAdmin(req, res, next) {
  try {
    const input = z
      .object({
        code: z.string().trim().min(2).max(40).toUpperCase().optional(),
        name: z.string().trim().min(2).max(120).optional(),
        description: z.string().trim().max(500).optional().nullable(),
        pricePaise: z.number().int().min(0).optional(),
        currency: z.string().trim().min(3).max(3).optional(),
        durationMonths: z.number().int().min(1).max(60).optional(),
        isActive: z.boolean().optional(),
        displayOrder: z.number().int().min(0).optional(),
        features: z.array(z.string()).optional(),
        maxStaff: z.number().int().min(0).optional().nullable(),
        maxBranches: z.number().int().min(0).optional().nullable(),
      })
      .parse(req.body);
    const result = await updatePlanService(req.params.id, input, req.user);
    res.json(result);
  } catch (err) { next(err); }
}

export async function setPlanStatusAdmin(req, res, next) {
  try {
    const input = z.object({ isActive: z.boolean() }).parse(req.body);
    const result = await setPlanStatusService(req.params.id, input.isActive, req.user);
    res.json(result);
  } catch (err) { next(err); }
}

export async function searchGymsAdmin(req, res, next) {
  try {
    const input = z
      .object({
        q: z.string().trim().min(2),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
      })
      .parse(req.query);
    const result = await searchGymsService(input.q, { page: input.page, limit: input.limit });
    res.json(result);
  } catch (err) { next(err); }
}

export async function getGymSubscriptionAdmin(req, res, next) {
  try {
    const result = await getGymSubscriptionAdminService(req.params.gymId, req.user);
    res.json(result);
  } catch (err) { next(err); }
}

export async function extendTrialAdmin(req, res, next) {
  try {
    const input = z
      .object({
        additionalDays: z.coerce.number().int().min(1).max(365),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(req.body);
    const result = await extendTrialService(req.params.gymId, input, req.user);
    res.json(result);
  } catch (err) { next(err); }
}

export async function grantAccessAdmin(req, res, next) {
  try {
    const input = z
      .object({
        expiresAt: z.string().datetime({ offset: true }).or(z.string().date()),
        reason: z.string().trim().min(3).max(500),
      })
      .parse(req.body);
    const result = await grantAccessService(req.params.gymId, input, req.user);
    res.json(result);
  } catch (err) { next(err); }
}

export async function readSettingsAdmin(req, res, next) {
  try {
    const result = await readSettingsService();
    res.json(result);
  } catch (err) { next(err); }
}

export async function updateSettingsAdmin(req, res, next) {
  try {
    const input = z
      .object({
        trialEnabled: z.boolean().optional(),
        trialDurationDays: z.coerce.number().int().min(1).max(365).optional(),
        trialPricePaise: z.number().int().min(0).optional(),
        trialRequiresPaymentMethod: z.boolean().optional(),
        cancellationPolicy: z.enum(["END_OF_PERIOD", "IMMEDIATE"]).optional(),
        reminderDaysBefore: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.body);
    const result = await updateSettingsService(input, req.user);
    res.json(result);
  } catch (err) { next(err); }
}
