import { Router } from "express";
import {
  createReceptionist,
  listStaff,
  deleteReceptionist,
} from "../controllers/staff.controller.js";
import { authenticate, requireGym, allowRoles } from "../middleware/auth.js";

const router = Router();

// Only a gym admin can manage staff.
// RECEPTIONIST gets 403 here (handled by allowRoles).
router.use(authenticate, requireGym, allowRoles("ADMIN"));

router.get("/receptionists", listStaff);
router.post("/receptionists", createReceptionist);
router.delete("/receptionists/:id", deleteReceptionist);

export default router;
