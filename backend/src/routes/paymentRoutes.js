import { Router } from "express";
import { sepayIpn, vietQrWebhook } from "../controllers/paymentController.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { webhookIpGuard } from "../middleware/webhookGuard.js";

const router = Router();
const webhookLimit = createRateLimit({
  keyPrefix: "vietqr-webhook",
  windowMs: 60_000,
  max: 120,
  keyGenerator: (req) => req.ip
});
const sepayWebhookLimit = createRateLimit({
  keyPrefix: "sepay-ipn",
  windowMs: 60_000,
  max: 120,
  keyGenerator: (req) => req.ip
});

router.post("/payments/vietqr/webhook", webhookIpGuard, webhookLimit, vietQrWebhook);
router.post("/payments/sepay/ipn", sepayWebhookLimit, sepayIpn);

export default router;
