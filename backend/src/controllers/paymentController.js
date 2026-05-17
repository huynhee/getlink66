import Topup from "../models/Topup.js";
import { approvePendingTopup } from "../utils/topupApprovalService.js";
import crypto from "node:crypto";

function webhookSecretFromRequest(req) {
  const auth = String(req.get("authorization") || "");
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return String(
    req.get("x-webhook-secret") || req.get("x-vietqr-secret") || "",
  ).trim();
}

function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function assertWebhookSecret(req) {
  const expected = String(process.env.VIETQR_WEBHOOK_SECRET || "").trim();
  if (!expected) {
    const error = new Error("VIETQR_WEBHOOK_SECRET chưa được cấu hình.");
    error.status = 500;
    throw error;
  }

  if (!safeEqual(webhookSecretFromRequest(req), expected)) {
    const error = new Error("Invalid webhook secret");
    error.status = 401;
    throw error;
  }
}

function pickText(transaction) {
  return String(
    transaction.description ||
      transaction.content ||
      transaction.addInfo ||
      transaction.remark ||
      transaction.transactionContent ||
      transaction.transaction_content ||
      transaction.desc ||
      transaction.memo ||
      "",
  );
}

function pickAmount(transaction) {
  const value =
    transaction.amount ??
    transaction.transferAmount ??
    transaction.creditAmount ??
    transaction.money ??
    transaction.value ??
    transaction.transactionAmount;
  const normalized = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(normalized) ? normalized : 0;
}

function pickTransactionId(transaction) {
  // Mo rong cover nhieu webhook provider VN: Casso, SePay, MBBank, BIDV, Sacombank, VietQR.io
  return String(
    transaction.id ||
      transaction.reference ||
      transaction.referenceCode ||
      transaction.reference_code ||
      transaction.referenceNumber ||
      transaction.reference_number ||
      transaction.refNo ||
      transaction.ref_no ||
      transaction.transactionId ||
      transaction.transaction_id ||
      transaction.transactionNo ||
      transaction.transaction_no ||
      transaction.txnId ||
      transaction.txn_id ||
      transaction.bankRefNo ||
      transaction.bankRef ||
      transaction.bank_ref_no ||
      transaction.tid ||
      transaction.seqNo ||
      transaction.seq_no ||
      transaction.uuid ||
      "",
  );
}

function pickTransactionDate(transaction) {
  return String(
    transaction.transactionDate ||
      transaction.transaction_date ||
      transaction.when ||
      transaction.date ||
      transaction.createdAt ||
      transaction.created_at ||
      "",
  );
}

function extractTransactions(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.transactions)) return payload.transactions;
  if (Array.isArray(payload?.records)) return payload.records;
  if (payload?.data && typeof payload.data === "object") return [payload.data];
  return [payload];
}

function extractPaymentCode(text) {
  const match = String(text || "")
    .toUpperCase()
    .match(/\b(?:NAP[A-Z0-9]{6,24}|3D66[A-Z0-9]{6,24})\b/);
  return match?.[0] || "";
}

async function approveTopupFromTransaction(transaction) {
  const text = pickText(transaction);
  const paymentCode = extractPaymentCode(text);
  const amount = pickAmount(transaction);
  let transactionId = pickTransactionId(transaction);
  if (!paymentCode || amount <= 0) {
    return { ok: false, reason: "missing_payment_code_or_amount" };
  }

  // Fallback identifier neu provider khong gui txId tieu chuan: ket hop paymentCode +
  // amount + ngay giao dich. Du de duplicate-check vi 1 user khong the gui cung
  // paymentCode + cung amount + cung ngay 2 lan ma chi tao 1 topup pending.
  if (!transactionId) {
    const dateKey =
      pickTransactionDate(transaction) || new Date().toISOString().slice(0, 10);
    transactionId = `auto-${paymentCode}-${amount}-${dateKey}`;
  }

  const duplicate = await Topup.findOne({
    gatewayTransactionId: transactionId,
    status: "approved",
  });
  if (duplicate) {
    return { ok: false, paymentCode, reason: "duplicate_transaction" };
  }

  const topup = await Topup.findOne({ paymentCode, status: "pending" });
  if (!topup) {
    return {
      ok: false,
      paymentCode,
      reason: "topup_not_found_or_already_handled",
    };
  }

  // KHONG check expiresAt: user da chuyen tien that thi phai approve. Dinh nghia "expired"
  // chi la UI hint cho user khuyen tao QR moi, khong phai ly do reject thanh toan.
  // Defense chong abuse: amount check ben duoi - neu gia tang sau, amount cu khong du.

  if (amount < topup.amount) {
    return {
      ok: false,
      paymentCode,
      reason: "amount_not_enough",
      expected: topup.amount,
      received: amount,
    };
  }

  const approved = await approvePendingTopup(topup, {
    gatewayTransactionId: transactionId,
    gatewayPayload: transaction,
  });

  if (!approved) {
    return { ok: false, paymentCode, reason: "already_handled" };
  }

  return {
    ok: true,
    paymentCode,
    topupId: approved.topup._id,
    creditAdded: approved.topup.credit,
    userCredit: approved.user.credit,
  };
}

export async function vietQrWebhook(req, res, next) {
  try {
    const contentType = String(req.get("content-type") || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      return res
        .status(415)
        .json({ message: "Content-Type must be application/json" });
    }
    assertWebhookSecret(req);
    const transactions = extractTransactions(req.body);
    const results = [];
    for (const transaction of transactions) {
      results.push(await approveTopupFromTransaction(transaction));
    }

    res.json({
      ok: true,
      approved: results.filter((item) => item.ok).length,
      results,
    });
  } catch (error) {
    next(error);
  }
}
