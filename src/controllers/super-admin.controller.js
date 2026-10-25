// Super-admin dashboard controllers.
//
// Every handler receives `req.user` from `authenticate`, which loads the role
// and gymId from the database. The service re-checks SUPER_ADMIN as defense in
// depth. There is no endpoint here that can change a user's role or gymId, so
// a platform admin cannot escalate a gym user through this API.

import { z } from "zod";

import {
  getDashboardStats,
  listGyms,
  getGymDetail,
  listAllPlans,
  assignPlan,
  extendExpiry,
  startOrExtendTrial,
  endTrial,
  setAccessStatus,
  listActivity,
} from "../services/super-admin.service.js";

const reasonSchema = z.string().trim().min(3).max(500);
const dateSchema = z.string().trim().min(1);

const listGymsSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z
    .enum([
      "ACTIVE",
      "TRIALING",
      "EXPIRED",
      "CANCELLED",
      "PAST_DUE",
      "SUSPENDED",
      "NO_SUBSCRIPTION",
    ])
    .optional(),
  planId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(["newest", "oldest", "name"]).default("newest"),
});

export async function getStats(req, res, next) {
  try {
    const result = await getDashboardStats(req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getGyms(req, res, next) {
  try {
    const input = listGymsSchema.parse(req.query);
    const result = await listGyms(req.user, {
      ...input,
      q: input.q?.trim() || undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getGym(req, res, next) {
  try {
    const result = await getGymDetail(req.user, req.params.gymId);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPlans(req, res, next) {
  try {
    const result = await listAllPlans(req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function assignGymPlan(req, res, next) {
  try {
    const input = z
      .object({
        planId: z.string().trim().min(1),
        expiresAt: dateSchema.optional(),
        reason: reasonSchema,
      })
      .parse(req.body);
    const result = await assignPlan(req.user, req.params.gymId, input);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function extendGymExpiry(req, res, next) {
  try {
    const input = z
      .object({
        additionalDays: z.coerce.number().int().min(1).max(3650).optional(),
        expiresAt: dateSchema.optional(),
        reason: reasonSchema,
      })
      .refine((value) => value.additionalDays !== undefined || value.expiresAt, {
        message: "Provide additionalDays or expiresAt",
        path: ["additionalDays"],
      })
      .parse(req.body);
    const result = await extendExpiry(req.user, req.params.gymId, input);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function startGymTrial(req, res, next) {
  try {
    const input = z
      .object({
        days: z.coerce.number().int().min(1).max(365).default(14),
        startsAt: dateSchema.optional(),
        reason: reasonSchema,
      })
      .parse(req.body);
    const result = await startOrExtendTrial(req.user, req.params.gymId, input);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function endGymTrial(req, res, next) {
  try {
    const input = z.object({ reason: reasonSchema }).parse(req.body);
    const result = await endTrial(req.user, req.params.gymId, input);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function updateGymAccess(req, res, next) {
  try {
    const input = z
      .object({
        status: z.enum(["ACTIVE", "SUSPENDED"]),
        expiresAt: dateSchema.optional(),
        reason: reasonSchema,
      })
      .parse(req.body);
    const result = await setAccessStatus(req.user, req.params.gymId, input);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getActivity(req, res, next) {
  try {
    const input = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(20) })
      .parse(req.query);
    const result = await listActivity(req.user, input);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
