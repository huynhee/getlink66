import { Router } from "express";
import {
  csrfToken,
  currentUser,
  devLogin,
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
// Keep enrollment and login buckets separate. An admin signed in on multiple
// devices should not consume the login retry budget while configuring 2FA.
const twoFaSetupLimit = createRateLimit({
  keyPrefix: "auth-2fa-setup",
  windowMs: Number(process.env.TWO_FA_SETUP_RATE_WINDOW_MS || 10 * 60_000),
  max: Number(process.env.TWO_FA_SETUP_RATE_LIMIT || 10),
});
const twoFaVerifyLimit = createRateLimit({
  keyPrefix: "auth-2fa-verify",
  windowMs: Number(process.env.TWO_FA_VERIFY_RATE_WINDOW_MS || 5 * 60_000),
  max: Number(process.env.TWO_FA_VERIFY_RATE_LIMIT || 20),
});

router.get("/google", authLimit, googleLogin);
router.get("/google/callback", googleCallback);
router.get("/dev-login", authLimit, devLogin);
router.get("/csrf", csrfToken);
router.post("/logout", logout);
router.get("/user", currentUser);

// 2FA enroll: yeu cau session moi <5 phut + auth. Chong account-takeover qua self-enroll
// khi attacker chiem JWT cua admin chua bat 2FA.
router.post(
  "/2fa/generate",
  requireAuth,
  requireFreshLogin(5 * 60),
  twoFaSetupLimit,
  setup2FA,
);
router.post(
  "/2fa/enable",
  requireAuth,
  requireFreshLogin(5 * 60),
  twoFaSetupLimit,
  verifyAndEnable2FA,
);
router.post("/2fa/verify", requireAuth, twoFaVerifyLimit, verify2FALogin);

export default router;
