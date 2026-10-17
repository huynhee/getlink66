import TimoMailState from "../models/TimoMailState.js";
import TimoMailEvent from "../models/TimoMailEvent.js";
import { bankOrderModel, timoQrPayment } from "../utils/timoPaymentService.js";
import { timoConfiguration, timoConfigurationIssues, vndPaymentAvailability } from "../config/timoConfig.js";
import { reconcileTimoOnce } from "../utils/timoMailJob.js";
import { isSafeId } from "../utils/validators.js";

export async function bankPaymentStatus(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid payment id" });
    const order = await bankOrderModel(req.params.kind).findOne({ _id: req.params.id, userId: req.user._id, gatewayProvider: "timo" })
      .select("_id status amount amountMinor currency gatewayProvider paymentCode accountNo accountName bankId expiresAt rejectionReason credit planName paidAt").lean();
    if (!order) return res.status(404).json({ message: "Payment not found" });
    res.set("Cache-Control", "private, no-store");
    res.json({ kind: req.params.kind, order, payment: order.status === "pending" ? timoQrPayment(order) : null });
  } catch (error) { next(error); }
}

export async function adminTimoStatus(_req, res, next) {
  try {
    const config = timoConfiguration();
    const state = await TimoMailState.findById(config.mailbox).select("lastScanAt lastSuccessAt lastError accountNo").lean();
    const events = await TimoMailEvent.find({ mailbox: config.mailbox }).sort({ createdAt: -1 }).limit(50)
      .select("_id state paymentCode amount occurredAt receivedAt kind orderId attempts nextAttemptAt reason createdAt").lean();
    res.set("Cache-Control", "private, no-store");
    res.json({ ...vndPaymentAvailability(), workerEnabled: config.workerEnabled,
      mailbox: config.mailbox, accountNo: config.accountNo, accountName: config.accountName,
      issues: timoConfigurationIssues(), state, events });
  } catch (error) { next(error); }
}

export async function adminReconcileTimo(_req, res, next) {
  try { res.json(await reconcileTimoOnce()); }
  catch (error) { next(error); }
}

export async function adminRetryTimo(req, res, next) {
  try {
    const config = timoConfiguration();
    const event = await TimoMailEvent.findOneAndUpdate({ _id: req.params.id, mailbox: config.mailbox, state: { $in: ["review", "pending", "verified"] } }, {
      $set: { state: "pending", nextAttemptAt: new Date(), reason: "" },
    }, { new: true });
    if (!event) return res.status(404).json({ message: "Unsettled bank notification not found" });
    res.json({ queued: true });
  } catch (error) { next(error); }
}
