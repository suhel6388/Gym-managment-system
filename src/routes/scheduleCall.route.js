import { Router } from "express";
import { AddCall, DeleteCall, GetAllCall, PatchCall } from "../controllers/schedule.call.controller";
import { authenticate, requireSuperAdmin } from "../middleware/auth";

const router = Router();


router.get("/", AddCall)


router.post("/", requireSuperAdmin, GetAllCall)

router.patch("/", authenticate, requireSuperAdmin, PatchCall)
router.delete("/", authenticate, requireSuperAdmin, DeleteCall)


export default router;