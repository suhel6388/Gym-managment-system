import { Router } from "express";
import { cancelMembership, createMembership, freezeMembership, listMemberships } from "../controllers/membership.controller.js";
import { authenticate, requireGym, allowReadAndCreateOnly } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym, allowReadAndCreateOnly);

router.get("/", listMemberships);
router.post("/", createMembership);
router.post("/:id/freeze", freezeMembership);
router.post("/:id/cancel", cancelMembership);

export default router;
