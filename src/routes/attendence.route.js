
import { Router } from "express";
import { AttendanceController } from "../controllers/attendence.controller.js";
import { requireAuth } from "../middleware/requireAuth";
import { allowReadAndCreateOnly } from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";

const router = Router();

// Staff may search, view attendance and record check-in/check-out (POST).
// Editing or deleting attendance rows is blocked centrally by the middleware.
router.use(requireAuth, allowReadAndCreateOnly, requireActiveSubscription());

router.get("/members/search", AttendanceController.searchMembers);
router.post("/check-in", AttendanceController.checkIn);
router.post("/check-out", AttendanceController.checkOut);
router.get("/open/:memberId", AttendanceController.getOpenSession);
router.get("/members/:memberId/history", AttendanceController.getMemberHistory);
router.get("/summary/today", AttendanceController.getTodaySummary);

export default router;
