import crypto from "node:crypto";
import TimoMailState from "../models/TimoMailState.js";
import TimoMailEvent from "../models/TimoMailEvent.js";
import Topup from "../models/Topup.js";
import MembershipOrder from "../models/MembershipOrder.js";
import { timoConfiguration, assertTimoConfigured } from "../config/timoConfig.js";
import { assertTimoMailbox, gmailApi } from "./timoGmail.js";
import { verifyTimoNotification } from "./timoNotification.js";
import { settleTimoMailEvent } from "./timoPaymentService.js";
import { releasePaymentReservation } from "./paymentBenefitService.js";
import { sendTelegramNotification } from "./telegramNotifier.js";
import logger from "./logger.js";
import { createTimoPollScheduler, TIMO_ACTIVE_POLL_MS, TIMO_IDLE_POLL_MS, TIMO_MAX_BACKOFF_MS } from "./timoPollScheduler.js";

let stopping = false;
const poller = createTimoPollScheduler({
  run: () => reconcileTimoOnce({ scheduled: true }),
  onError: (error) => logger.warn({ code: error.code, gmailReason: error.gmailReason, gmailStatus: error.gmailStatus }, "Timo mailbox reconciliation failed"),
});

async function renewLease(mailbox, owner) {
  const state = await TimoMailState.findOneAndUpdate({ _id: mailbox, lockOwner: owner }, {
    $set: { lockUntil: new Date(Date.now() + 120_000) },
  }, { new: true });
  if (!state) throw Object.assign(new Error("Timo mailbox lease lost"), { code: "TIMO_LEASE_LOST" });
}

async function scanMailbox(config, state, owner) {
  if (!state.scanEndAt) {
    state = await TimoMailState.findOneAndUpdate({ _id: config.mailbox, lockOwner: owner }, { $set: {
      scanStartAt: new Date(Math.max(Date.parse(config.startAt), new Date(state.lastScanAt || config.startAt).getTime() - 300_000)),
      scanEndAt: new Date(), scanPageToken: "",
    } }, { new: true });
  }
  const after = Math.floor(new Date(state.scanStartAt).getTime() / 1000);
  const before = Math.ceil(new Date(state.scanEndAt).getTime() / 1000);
  let pageToken = state.scanPageToken || "";
  for (let page = 0; page < 10 && !stopping; page += 1) {
    await renewLease(config.mailbox, owner);
    let result;
    try {
      result = await gmailApi("/messages", {
        q: `from:${config.sender} subject:"Thông báo thay đổi số dư tài khoản" after:${after} before:${before}`,
        includeSpamTrash: true, maxResults: 50, ...(pageToken ? { pageToken } : {}),
      });
    } catch (error) {
      if (pageToken && error.gmailStatus === 400) {
        await TimoMailState.findOneAndUpdate({ _id: config.mailbox, lockOwner: owner }, { $set: { scanPageToken: "" } });
      }
      throw error;
    }
    for (const message of result.messages || []) {
      if (!/^[a-f0-9]+$/.test(message.id)) continue;
      const id = `${config.mailbox}:${message.id}`;
      try {
        await TimoMailEvent.findOneAndUpdate({ _id: id }, { $setOnInsert: {
          mailbox: config.mailbox, gmailMessageId: message.id, accountNo: config.accountNo,
          state: "pending", attempts: 0, nextAttemptAt: new Date(),
        } }, { upsert: true });
      } catch (error) { if (error.code !== 11000) throw error; }
    }
    pageToken = result.nextPageToken || "";
    await TimoMailState.findOneAndUpdate({ _id: config.mailbox, lockOwner: owner }, pageToken
      ? { $set: { scanPageToken: pageToken } }
      : { $set: { lastScanAt: state.scanEndAt, scanPageToken: "", scanEndAt: null, scanStartAt: null } });
    if (!pageToken) break;
  }
}

async function processEvent(event, config) {
  try {
    if (event.state === "pending") {
      const message = await gmailApi(`/messages/${event.gmailMessageId}`, { format: "raw" });
      const receivedAt = new Date(Number(message.internalDate));
      if (message.id !== event.gmailMessageId) throw Object.assign(new Error("Gmail message identity mismatch"), { code: "TIMO_GMAIL_MESSAGE_MISMATCH" });
      if (!Number.isFinite(receivedAt.getTime()) || receivedAt < new Date(config.startAt)) {
        throw Object.assign(new Error("Notification predates payment activation"), { code: "TIMO_EMAIL_BEFORE_CUTOVER" });
      }
      if (!message.raw || message.raw.length > 700_000 || Number(message.sizeEstimate) > 512 * 1024) {
        throw Object.assign(new Error("Notification is too large"), { code: "TIMO_EMAIL_TOO_LARGE" });
      }
      const notice = await verifyTimoNotification(Buffer.from(message.raw, "base64url"), config);
      if (notice.ignored) {
        await TimoMailEvent.findByIdAndUpdate(event._id, { $set: { state: "ignored", reason: notice.reason, receivedAt } });
        return;
      }
      await TimoMailEvent.findOneAndUpdate({ _id: event._id, state: "pending" }, { $set: {
        ...notice, receivedAt, state: "verified", reason: "",
      } });
    }
    await settleTimoMailEvent(event._id);
  } catch (error) {
    const retry = !error.status || error.status >= 500 || ["TIMO_GMAIL_UNAVAILABLE", "TIMO_DKIM_DNS_UNAVAILABLE"].includes(error.code);
    const permanent = /^TIMO_/.test(error.code || "") && !["TIMO_GMAIL_UNAVAILABLE", "TIMO_DKIM_DNS_UNAVAILABLE", "TIMO_SETTLEMENT_PENDING"].includes(error.code);
    const state = permanent || (!retry && error.status < 500) ? "review" : event.state;
    await TimoMailEvent.findOneAndUpdate({ _id: event._id, state: { $in: ["pending", "verified"] } }, {
      $set: { ...(state === "review" ? { state } : {}), reason: /^\w{1,80}$/.test(String(error.code || "")) ? String(error.code) : "TIMO_RECONCILIATION_PENDING",
        nextAttemptAt: new Date(Date.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(event.attempts || 0, 7))) },
      $inc: { attempts: 1 },
    });
    if (error.timoAuthenticated || event.state === "verified" || Number(event.attempts || 0) >= 3) {
      const alert = await TimoMailEvent.findOneAndUpdate({ _id: event._id, alertedAt: { $exists: false } }, { $set: { alertedAt: new Date() } }, { new: true });
      if (alert) await sendTelegramNotification(`<b>Timo payment requires review</b>\nEvent: ${event.gmailMessageId}\nCode: ${alert.reason}`, { dedupeKey: `timo-review:${event._id}` });
    }
    if (error.code === "TIMO_GMAIL_UNAVAILABLE") throw error;
  }
}

async function expireTimoOrders() {
  for (const [kind, Model] of [["topup", Topup], ["membership", MembershipOrder]]) {
    const orders = await Model.find({ gatewayProvider: "timo", status: "pending", expiresAt: { $lt: new Date() } }).limit(50);
    for (const order of orders) {
      const expired = await Model.findOneAndUpdate({ _id: order._id, status: "pending" }, {
        $set: { status: "rejected", rejectionReason: "expired", canceledAt: new Date() },
      }, { new: true });
      if (expired) await releasePaymentReservation(kind, expired);
    }
  }
}

export async function reconcileTimoOnce({ scheduled = false } = {}) {
  const config = assertTimoConfigured();
  const owner = crypto.randomUUID();
  try {
    await TimoMailState.findOneAndUpdate({ _id: config.mailbox }, { $setOnInsert: {
      accountNo: config.accountNo, lastScanAt: new Date(config.startAt), lockUntil: new Date(0),
    } }, { upsert: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  const now = new Date();
  const state = await TimoMailState.findOneAndUpdate({
    _id: config.mailbox, lockUntil: { $lt: now },
    ...(scheduled ? { $and: [
      { $or: [{ lastAttemptAt: { $exists: false } }, { lastAttemptAt: null }, { lastAttemptAt: { $lte: new Date(now.getTime() - TIMO_ACTIVE_POLL_MS) } }] },
      { $or: [{ pollBackoffUntil: { $exists: false } }, { pollBackoffUntil: null }, { pollBackoffUntil: { $lte: now } }] },
    ] } : {}),
  }, { $set: { lockOwner: owner, lockUntil: new Date(now.getTime() + 120_000), lastAttemptAt: now } }, { new: true });
  if (!state) {
    const current = await TimoMailState.findById(config.mailbox).select("lastAttemptAt pollBackoffUntil").lean();
    const due = Math.max(new Date(current?.lastAttemptAt || 0).getTime() + TIMO_ACTIVE_POLL_MS, new Date(current?.pollBackoffUntil || 0).getTime());
    return { busy: true, nextPollMs: Math.min(TIMO_MAX_BACKOFF_MS, Math.max(TIMO_ACTIVE_POLL_MS, due - Date.now())) };
  }
  try {
    if (state.accountNo !== config.accountNo) throw Object.assign(new Error("Mailbox is bound to another bank account"), { code: "TIMO_MAILBOX_BINDING_CHANGED" });
    await assertTimoMailbox();
    await scanMailbox(config, state, owner);
    const batchSize = scheduled ? 5 : 10;
    const events = await TimoMailEvent.find({ mailbox: config.mailbox, state: { $in: ["pending", "verified"] }, nextAttemptAt: { $lte: new Date() } })
      .sort({ nextAttemptAt: 1 }).limit(batchSize).lean();
    for (const event of events) {
      if (stopping) break;
      await renewLease(config.mailbox, owner);
      await processEvent(event, config);
    }
    await expireTimoOrders();
    const pendingQuery = { gatewayProvider: "timo", status: "pending", expiresAt: { $gt: new Date() } };
    const active = Boolean(await Topup.exists(pendingQuery) || await MembershipOrder.exists(pendingQuery));
    await TimoMailState.findOneAndUpdate({ _id: config.mailbox, lockOwner: owner }, {
      $set: { lastSuccessAt: new Date(), lastError: "", pollFailureCount: 0, pollBackoffUntil: null },
    });
    return { processed: events.length, nextPollMs: active || events.length >= batchSize ? TIMO_ACTIVE_POLL_MS : TIMO_IDLE_POLL_MS };
  } catch (error) {
    const code = /^TIMO_[A-Z0-9_]{1,64}$/.test(error.code || "") ? error.code : "TIMO_RECONCILIATION_FAILED";
    const diagnostic = error.code === "TIMO_GMAIL_UNAVAILABLE"
      ? { gmailStatus: error.gmailStatus, gmailReason: error.gmailReason, gmailHint: error.gmailHint } : {};
    const reason = diagnostic.gmailReason ? ` (${diagnostic.gmailReason})` : "";
    const retryAfterMs = Math.min(TIMO_MAX_BACKOFF_MS, TIMO_IDLE_POLL_MS * 2 ** Math.min(Number(state.pollFailureCount || 0), 4));
    await TimoMailState.findOneAndUpdate({ _id: config.mailbox, lockOwner: owner }, {
      $set: { lastError: `${code}${reason}`, pollBackoffUntil: new Date(Date.now() + retryAfterMs) },
      $inc: { pollFailureCount: 1 },
    });
    throw Object.assign(new Error(`Timo mailbox reconciliation is unavailable${reason}`), { code, status: 503, retryAfterMs, ...diagnostic });
  } finally {
    await TimoMailState.findOneAndUpdate({ _id: config.mailbox, lockOwner: owner }, { $set: { lockUntil: new Date(0), lockOwner: "" } });
  }
}

export function startTimoMailJob() {
  if (!timoConfiguration().workerEnabled) return;
  assertTimoConfigured();
  stopping = false;
  poller.start();
}

export function wakeTimoMailJob() {
  if (stopping || !timoConfiguration().workerEnabled) return false;
  return poller.wake();
}

export async function stopTimoMailJob() {
  stopping = true;
  await poller.stop();
}
