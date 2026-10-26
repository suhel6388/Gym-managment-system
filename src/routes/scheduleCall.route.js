import { Router } from "express";
import { AddCall, DeleteCall, GetAllCall, PatchCall } from "../controllers/schedule.call.controller";
import { authenticate, requireSuperAdmin } from "../middleware/auth";

const router = Router();

// Public landing-page endpoint: create a scheduled call. The visitor's IP is
// resolved server-side for the one-per-24-hours rate limit.
router.post("/", AddCall);

// Admin console: list, update and delete scheduled calls.
router.get("/", authenticate, requireSuperAdmin, GetAllCall);
router.patch("/:id", authenticate, requireSuperAdmin, PatchCall);
router.delete("/:id", authenticate, requireSuperAdmin, DeleteCall);

export default router;
