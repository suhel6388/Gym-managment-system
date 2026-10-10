import { Router } from "express";
import { createMember, deleteMember, listMembers, updateMember } from "../controllers/members.controller.js";
import { authenticate, requireGym, allowRoles } from "../middleware/auth.js";

const router = Router();
router.use(authenticate, requireGym);

router.get("/", listMembers);
router.post("/", createMember);
router.patch("/:id", updateMember);
router.delete("/:id", allowRoles("OWNER", "ADMIN", "ACCOUNTANT"), deleteMember);

export default router;
