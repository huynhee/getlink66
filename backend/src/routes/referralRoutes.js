import { Router } from "express";
import { myReferral, referralHistory } from "../controllers/referralController.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const referralLimit = createRateLimit({
  keyPrefix: "referral",
  windowMs: 60_000,
  max: 60,
});

router.get("/referral/me", requireAuth, referralLimit, myReferral);
router.get("/referral/history", requireAuth, referralLimit, referralHistory);

export default router;
