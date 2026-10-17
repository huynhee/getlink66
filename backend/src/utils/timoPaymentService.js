import Topup from "../models/Topup.js";
import MembershipOrder from "../models/MembershipOrder.js";
import PaymentReceipt from "../models/PaymentReceipt.js";
import TimoMailEvent from "../models/TimoMailEvent.js";
import { assertTimoConfigured } from "../config/timoConfig.js";
import { approvePendingTopup } from "./topupApprovalService.js";
import { approvePendingMembershipOrder } from "./membershipService.js";
import { reservePaymentBenefits } from "./paymentBenefitService.js";
import { paymentError } from "./paymentMoney.js";

export function bankOrderModel(kind) {
  if (kind === "topup") return Topup;
  if (kind === "membership") return MembershipOrder;
  throw paymentError("Invalid payment kind", "PAYMENT_KIND_INVALID");
}

export function timoQrPayment(order) {
  if (order.gatewayProvider !== "timo" || order.currency !== "VND" || !/^\d+$/.test(order.accountNo || "") || !order.accountName) {
    throw paymentError("Bank payment snapshot is unavailable", "TIMO_ORDER_INVALID", 409);
  }
  const params = new URLSearchParams({ amount: String(order.amountMinor), addInfo: order.paymentCode, accountName: order.accountName });
  return {
    provider: "timo", bankId: order.bankId, bankName: "Timo by BVBank",
    accountNo: order.accountNo, accountName: order.accountName,
    amount: order.amountMinor, currency: "VND", paymentCode: order.paymentCode,
    expiresAt: order.expiresAt,
    qrUrl: `https://img.vietqr.io/image/${encodeURIComponent(order.bankId)}-${encodeURIComponent(order.accountNo)}-compact2.png?${params}`,
  };
}

export async function createTimoCheckout(kind, order) {
  const Model = bankOrderModel(kind);
  let current = await Model.findById(order._id);
  if (current?.gatewayProvider !== "timo" || current.currency !== "VND" || !Number.isSafeInteger(current.amountMinor) || current.amountMinor <= 0) {
    throw paymentError("Invalid Timo payment order", "TIMO_ORDER_INVALID", 409);
  }
  if (current.status !== "pending" || new Date(current.expiresAt) <= new Date()) {
    throw paymentError("Payment order is no longer pending", "PAYMENT_ORDER_EXPIRED", 409);
  }
  if (!current.accountNo) {
    const config = assertTimoConfigured({ newCheckout: true });
    current = await Model.findByIdAndUpdate(current._id, { $set: {
      bankId: config.bankId, accountNo: config.accountNo, accountName: config.accountName,
    } }, { new: true });
  }
  try { await reservePaymentBenefits(kind, current); }
  catch (error) {
    await Model.findOneAndUpdate({ _id: current._id, status: "pending" }, { $set: { status: "rejected", rejectionReason: "gateway_error", canceledAt: new Date() } });
    throw error;
  }
  return timoQrPayment(current);
}

export async function settleTimoMailEvent(eventId) {
  const event = await TimoMailEvent.findOne({ _id: eventId, state: "verified" });
  if (!event) return null;
  const config = assertTimoConfigured();
  if (event.mailbox !== config.mailbox || event.accountNo !== config.accountNo || !/^[a-f0-9]{64}$/.test(event.signedMessageIdHash || "")) {
    throw paymentError("Timo mailbox binding changed", "TIMO_MAILBOX_BINDING_CHANGED", 409);
  }
  const matches = [];
  for (const kind of ["topup", "membership"]) {
    const orders = await bankOrderModel(kind).find({ paymentCode: event.paymentCode }).limit(2);
    for (const order of orders) matches.push({ kind, order });
  }
  if (matches.length !== 1) throw paymentError("Bank transfer does not identify exactly one order", "TIMO_ORDER_AMBIGUOUS", 409);
  const { kind, order } = matches[0];
  if (order.gatewayProvider !== "timo" || order.currency !== "VND" || order.amountMinor !== event.amount || order.accountNo !== event.accountNo) {
    throw paymentError("Bank transfer does not match the payment snapshot", "TIMO_PAYMENT_MISMATCH", 409);
  }
  const occurred = new Date(event.occurredAt).getTime();
  if (!Number.isFinite(occurred) || occurred + 60_000 < new Date(order.createdAt).getTime() || occurred > Date.now() + 5 * 60_000) {
    throw paymentError("Bank transfer time does not match the order", "TIMO_PAYMENT_TIME_MISMATCH", 409);
  }
  const gatewayTransactionId = `timo:${event.signedMessageIdHash}`;
  const receipt = await PaymentReceipt.findOne({ gatewayTransactionId });
  if (receipt) {
    if (String(receipt[kind === "topup" ? "topupId" : "membershipOrderId"]) !== String(order._id)) {
      throw paymentError("Bank notification already used by another order", "TIMO_RECEIPT_CONFLICT", 409);
    }
  } else {
    if (order.status === "approved" || (order.status === "rejected" && !["expired", "user_cancel", "gateway_error"].includes(order.rejectionReason))) {
      throw paymentError("Payment needs administrator reconciliation", "TIMO_ORDER_ALREADY_HANDLED", 409);
    }
    const approve = kind === "topup" ? approvePendingTopup : approvePendingMembershipOrder;
    try {
      await approve(order, {
        gatewayProvider: "timo", gatewayTransactionId,
        gatewayPayload: { mailEventId: event._id, signedMessageIdHash: event.signedMessageIdHash, receivedAmount: event.amount, occurredAt: event.occurredAt },
      });
    } catch (error) {
      if (error.code !== "DUPLICATE_GATEWAY_TRANSACTION") throw error;
    }
  }
  const confirmed = await PaymentReceipt.findOne({ gatewayTransactionId });
  if (!confirmed || String(confirmed[kind === "topup" ? "topupId" : "membershipOrderId"]) !== String(order._id)) {
    throw paymentError("Bank payment is awaiting reconciliation", "TIMO_SETTLEMENT_PENDING", 503);
  }
  return TimoMailEvent.findOneAndUpdate({ _id: event._id, state: "verified" }, {
    $set: { state: "applied", kind, orderId: order._id, reason: "" },
  }, { new: true });
}
