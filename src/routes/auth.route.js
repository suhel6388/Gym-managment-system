import { Router } from "express";
import { setupGym } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/setup-gym", authenticate, setupGym);

export default router;
