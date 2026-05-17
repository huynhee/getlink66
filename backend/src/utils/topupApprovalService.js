import Topup from "../models/Topup.js";
import Voucher from "../models/Voucher.js";
import { addCredit } from "./creditService.js";
import { notifyTopupApproved } from "./telegramNotifier.js";

function normalizeVoucherCode(code) {
  return String(code || "").trim().toUpperCase();
}

async function claimVoucherUsage(topup) {
  const code = normalizeVoucherCode(topup?.voucherCode);
  if (!code) return null;

  const voucher = await Voucher.findOneAndUpdate(
    {
      code,
      expireAt: { $gt: new Date() },
      $expr: { $lt: ["$usedCount", "$usageLimit"] }
    },
    { $inc: { usedCount: 1 } },
    { new: true }
  );

  if (!voucher) {
    const error = new Error("Voucher da het han hoac het luot dung, khong the duyet giao dich.");
    error.status = 409;
    throw error;
  }

  return voucher;
}

async function releaseVoucherUsage(topup) {
  const code = normalizeVoucherCode(topup?.voucherCode);
  if (!code) return;

  await Voucher.findOneAndUpdate(
    { code },
    { $inc: { usedCount: -1 } },
    { new: true }
  );
}

export async function approvePendingTopup(topup, approvalFields = {}) {
  let voucherClaimed = false;

  try {
    if (topup.voucherCode) {
      await claimVoucherUsage(topup);
      voucherClaimed = true;
    }

    const approvedTopup = await Topup.findOneAndUpdate(
      { _id: topup._id, status: "pending" },
      {
        $set: {
          status: "approved",
          paidAt: new Date(),
          ...approvalFields
        }
      },
      { new: true }
    );

    if (!approvedTopup) {
      if (voucherClaimed) await releaseVoucherUsage(topup);
      return null;
    }

    const user = await addCredit(approvedTopup.userId._id || approvedTopup.userId, approvedTopup.credit);
    notifyTopupApproved({
      topup: approvedTopup,
      user,
      source: approvalFields.gatewayTransactionId ? "Payment webhook" : "Admin",
    });
    return { topup: approvedTopup, user };
  } catch (error) {
    if (voucherClaimed) await releaseVoucherUsage(topup);
    throw error;
  }
}
