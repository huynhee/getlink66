import { Router } from "express";
import {
  csrfToken,
  currentUser,
  googleCallback,
  googleLogin,
  logout,
  setup2FA,
  verifyAndEnable2FA,
  verify2FALogin,
} from "../controllers/authController.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireFreshLogin } from "../middleware/requireFreshLogin.js";

const router = Router();
const authLimit = createRateLimit({
  keyPrefix: "auth",
  windowMs: 10 * 60_000,
  max: 40,
  keyGenerator: (req) => req.ip,
});
// Per-user fine-grained rate limit cho 2FA actions (chong brute force OTP).
const twoFaLimit = createRateLimit({
  keyPrefix: "auth-2fa",
  windowMs: 10 * 60_000,
  max: 10,
});

router.get("/google", authLimit, googleLogin);
router.get("/google/callback", googleCallback);
router.get("/csrf", csrfToken);
router.post("/logout", logout);
router.get("/user", currentUser);

// 2FA enroll: yeu cau session moi <5 phut + auth. Chong account-takeover qua self-enroll
// khi attacker chiem JWT cua admin chua bat 2FA.
router.post(
  "/2fa/generate",
  requireAuth,
  requireFreshLogin(5 * 60),
  twoFaLimit,
  setup2FA,
);
router.post(
  "/2fa/enable",
  requireAuth,
  requireFreshLogin(5 * 60),
  twoFaLimit,
  verifyAndEnable2FA,
);
router.post("/2fa/verify", twoFaLimit, verify2FALogin);

export default router;
