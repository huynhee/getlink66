import TimoMailState from "../models/TimoMailState.js";
import TimoMailEvent from "../models/TimoMailEvent.js";
import { bankOrderModel, timoQrPayment } from "../utils/timoPaymentService.js";
import { timoConfiguration, timoConfigurationIssues } from "../config/timoConfig.js";
import SiteSetting from "../models/SiteSetting.js";
import { vndPaymentRouting, vndProviderIssues } from "../utils/vndPaymentRouting.js";
import { assertTimoMailbox } from "../utils/timoGmail.js";
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
    res.json({ ...await vndPaymentRouting(), workerEnabled: config.workerEnabled,
      mailbox: config.mailbox, accountNo: config.accountNo, accountName: config.accountName,
      issues: timoConfigurationIssues(), state, events });
  } catch (error) { next(error); }
}

export async function adminPaymentProvider(_req, res, next) {
  try {
    res.set("Cache-Control", "private, no-store");
    res.json({ ...await vndPaymentRouting(), envProvider: String(process.env.VND_PAYMENT_PROVIDER || "sepay").trim(), options: ["sepay", "timo"].map((provider) => {
      const issues = vndProviderIssues(provider);
      return { provider, enabled: !issues.length, issues };
    }) });
  } catch (error) { next(error); }
}

export async function adminUpdatePaymentProvider(req, res, next) {
  try {
    const provider = req.body?.provider;
    if (!req.body || Object.keys(req.body).length !== 1 || !["sepay", "timo", "env"].includes(provider)) {
      return res.status(400).json({ message: "Invalid payment provider", code: "PAYMENT_PROVIDER_INVALID" });
    }
    const selected = provider === "env" ? String(process.env.VND_PAYMENT_PROVIDER || "sepay").trim() : provider;
    if (!["sepay", "timo"].includes(selected)) return res.status(409).json({ code: "PAYMENT_PROVIDER_INVALID", message: "Invalid VPS payment provider" });
    const issues = vndProviderIssues(selected);
    if (issues.length) return res.status(409).json({ code: "PAYMENT_PROVIDER_NOT_READY", message: "Payment provider is not configured", issues });
    if (selected === "timo") await assertTimoMailbox();
    const before = await vndPaymentRouting();
    await SiteSetting.findOneAndUpdate({ key: "homepage" }, provider === "env"
      ? { $unset: { vndPaymentProvider: "" } }
      : { $set: { vndPaymentProvider: provider } }, { upsert: true, new: true });
    req.auditDetails = { previousProvider: before.provider, previousSource: before.source, selectedProvider: selected };
    return adminPaymentProvider(req, res, next);
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
