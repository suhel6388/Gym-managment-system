
import { Router } from "express";
import { AttendanceController } from "../controllers/attendence.controller.js";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.use(requireAuth);

router.get("/members/search", AttendanceController.searchMembers);
router.post("/check-in", AttendanceController.checkIn);
router.post("/check-out", AttendanceController.checkOut);
router.get("/open/:memberId", AttendanceController.getOpenSession);
router.get("/members/:memberId/history", AttendanceController.getMemberHistory);
router.get("/summary/today", AttendanceController.getTodaySummary);

export default router;
