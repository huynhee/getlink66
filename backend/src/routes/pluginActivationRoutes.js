import { Router } from "express";
import {
  activationApprove,
  activationDeny,
  activationDetail,
  challengeApprove,
  challengeDetail,
  revokeSession,
  sessions,
} from "../controllers/pluginAuthController.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const activationLimit = createRateLimit({
  keyPrefix: "plugin-activation",
  windowMs: 60_000,
  max: 30,
});

router.use(requireAuth, activationLimit);
router.get("/device/:userCode", activationDetail);
router.post("/device/:userCode/approve", activationApprove);
router.post("/device/:userCode/deny", activationDeny);
router.get("/sessions", sessions);
router.delete("/sessions/:sessionId", revokeSession);
router.get("/challenge/:code", challengeDetail);
router.post("/challenge/:code/approve", challengeApprove);

export default router;
