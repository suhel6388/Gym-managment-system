import { Router } from "express";
import { setupGym, signup, login, logout, me, verifyEmail, resendOTP, googleSignIn, forgotPassword, resetPassword } from "../controllers/auth.controller.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

router.post("/signup", signup);
router.post("/verify-email", verifyEmail);
router.post("/resend-otp", resendOTP);
router.post("/google", googleSignIn);
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", me);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/setup-gym", authenticate, setupGym);

export default router;
