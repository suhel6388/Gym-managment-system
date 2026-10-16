import { Router } from "express";
import { createMember, deleteMember, listMembers, updateMember } from "../controllers/members.controller.js";
import { authenticate, requireGym, allowRoles, allowReadAndCreateOnly } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym, allowReadAndCreateOnly);

router.get("/", listMembers);
router.post("/", createMember);
router.patch("/:id", updateMember);
router.delete("/:id", allowRoles("ADMIN"), deleteMember);

export default router;
