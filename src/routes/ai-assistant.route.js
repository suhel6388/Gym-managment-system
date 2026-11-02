import { Router } from "express";
import { authenticate, requireGym } from "../middleware/auth.js";
import { getGymQuota } from "../services/ai-settings.store.js";
import { askGymAiAssistant } from "../services/gemini.service.js";

const router = Router();

router.use(authenticate, requireGym);

// GET /api/v1/ai-assistant/quota
router.get("/quota", async (req, res, next) => {
  try {
    const quota = getGymQuota(req.user.gymId);
    res.json({
      success: true,
      data: quota,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/ai-assistant/chat
router.post("/chat", async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        success: false,
        error: "Message is required",
      });
    }

    const result = await askGymAiAssistant({
      gymId: req.user.gymId,
      message: message.trim(),
    });

    if (result.error === "QUOTA_EXCEEDED") {
      return res.status(429).json({
        success: false,
        error: result.error,
        message: result.message,
        quota: result.quota,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

