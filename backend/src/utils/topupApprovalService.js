import Topup from "../models/Topup.js";
import TopupPackage from "../models/TopupPackage.js";
import Voucher from "../models/Voucher.js";
import VoucherRedemption from "../models/VoucherRedemption.js";
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

  const userId = topup.userId?._id || topup.userId;
  const perUserLimit = Number(voucher.perUserLimit ?? 1);
  if (perUserLimit <= 0) {
    return { voucher, redemption: null };
  }

  const approvedByUser = await Topup.countDocuments({
    userId,
    voucherCode: code,
    status: "approved",
  });
  if (approvedByUser >= perUserLimit) {
    await releaseVoucherCounter(code);
    const error = new Error("Tai khoan nay da dat gioi han su dung voucher.");
    error.status = 409;
    throw error;
  }

  let redemption = null;

  for (let slot = 1; slot <= perUserLimit; slot += 1) {
    try {
      redemption = await VoucherRedemption.create({
        userId,
        voucherCode: code,
        topupId: topup._id,
        slot,
      });
      break;
    } catch (error) {
      if (error?.code === 11000) {
        if (error.keyPattern?.topupId || error.message?.includes("topupId")) {
          await releaseVoucherCounter(code);
          const duplicateError = new Error("Topup da duoc claim voucher.");
          duplicateError.status = 409;
          throw duplicateError;
        }
        continue;
      }
      await releaseVoucherCounter(code);
      throw error;
    }
  }

  if (!redemption) {
    await releaseVoucherCounter(code);
    const error = new Error("Tai khoan nay da dat gioi han su dung voucher.");
    error.status = 409;
    throw error;
  }

  return { voucher, redemption };
}

async function releaseVoucherCounter(code) {
  await Voucher.findOneAndUpdate(
    { code },
    { $inc: { usedCount: -1 } },
    { new: true }
  );
}

async function releaseVoucherUsage(topup) {
  const code = normalizeVoucherCode(topup?.voucherCode);
  if (!code) return;

  await VoucherRedemption.findOneAndDelete({ topupId: topup._id }).catch(() => {});
  await releaseVoucherCounter(code);
}

async function assertPackageTopupLimit(topup) {
  const packageId = topup.packageId?._id || topup.packageId;
  if (!packageId) return;

  const pack = await TopupPackage.findById(packageId).lean();
  const limit = Number(pack?.maxTopupsPerUser || 0);
  if (!Number.isFinite(limit) || limit <= 0) return;

  const userId = topup.userId?._id || topup.userId;
  const used = await Topup.countDocuments({
    userId,
    packageId,
    status: "approved",
  });
  if (used >= limit) {
    const error = new Error(
      `Tai khoan nay da dat gioi han nap goi ${pack.name || ""} (${limit} lan).`,
    );
    error.status = 409;
    throw error;
  }
}

export async function approvePendingTopup(topup, approvalFields = {}) {
  let voucherClaimed = false;

  try {
    await assertPackageTopupLimit(topup);

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
