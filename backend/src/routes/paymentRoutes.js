import { Router } from "express";
import { vietQrWebhook } from "../controllers/paymentController.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { webhookIpGuard } from "../middleware/webhookGuard.js";

const router = Router();
const webhookLimit = createRateLimit({
  keyPrefix: "vietqr-webhook",
  windowMs: 60_000,
  max: 120,
  keyGenerator: (req) => req.ip
});

router.post("/payments/vietqr/webhook", webhookIpGuard, webhookLimit, vietQrWebhook);

export default router;
