import mongoose from "mongoose";
import { isMemoryDb } from "../config/memoryStore.js";
import Topup from "../models/Topup.js";
import TopupPackage from "../models/TopupPackage.js";
import Voucher from "../models/Voucher.js";
import VoucherRedemption from "../models/VoucherRedemption.js";
import { addCredit } from "./creditService.js";
import { notifyTopupApproved } from "./telegramNotifier.js";
import { approvedVoucherUseCount } from "./voucherCheckoutService.js";

function normalizeVoucherCode(code) {
  return String(code || "").trim().toUpperCase();
}

async function execMaybeSession(queryOrPromise, session = null) {
  if (session && typeof queryOrPromise?.session === "function") {
    return queryOrPromise.session(session);
  }
  return queryOrPromise;
}

async function leanMaybeSession(queryOrPromise, session = null) {
  const query = session && typeof queryOrPromise?.session === "function"
    ? queryOrPromise.session(session)
    : queryOrPromise;
  if (typeof query?.lean === "function") return query.lean();
  return query;
}

async function createVoucherRedemption(doc, session) {
  if (!session) return VoucherRedemption.create(doc);
  const [redemption] = await VoucherRedemption.create([doc], { session });
  return redemption;
}

async function claimVoucherUsage(topup, session = null) {
  const code = normalizeVoucherCode(topup?.voucherCode);
  if (!code) return null;

  const voucher = await Voucher.findOneAndUpdate(
    {
      code,
      expireAt: { $gt: new Date() },
      $expr: { $lt: ["$usedCount", "$usageLimit"] }
    },
    { $inc: { usedCount: 1 } },
    { new: true, session }
  );

  if (!voucher) {
    const error = new Error("Voucher đã hết hạn hoặc hết lượt dùng, không thể hoàn tất giao dịch.");
    error.status = 409;
    throw error;
  }

  const userId = topup.userId?._id || topup.userId;
  const perUserLimit = Number(voucher.perUserLimit ?? 1);
  if (perUserLimit <= 0) {
    return { voucher, redemption: null };
  }

  const approvedByUser = await approvedVoucherUseCount(userId, code);
  if (approvedByUser >= perUserLimit) {
    await releaseVoucherCounter(code, session);
    const error = new Error("Tài khoản này đã đạt giới hạn sử dụng voucher.");
    error.status = 409;
    throw error;
  }

  let redemption = null;

  for (let slot = 1; slot <= perUserLimit; slot += 1) {
    try {
      redemption = await createVoucherRedemption({
        userId,
        voucherCode: code,
        topupId: topup._id,
        slot,
      }, session);
      break;
    } catch (error) {
      if (error?.code === 11000) {
        if (error.keyPattern?.topupId || error.message?.includes("topupId")) {
          await releaseVoucherCounter(code, session);
          const duplicateError = new Error("Đơn nạp đã sử dụng voucher.");
          duplicateError.status = 409;
          throw duplicateError;
        }
        continue;
      }
      await releaseVoucherCounter(code, session);
      throw error;
    }
  }

  if (!redemption) {
    await releaseVoucherCounter(code, session);
    const error = new Error("Tài khoản này đã đạt giới hạn sử dụng voucher.");
    error.status = 409;
    throw error;
  }

  return { voucher, redemption };
}

async function releaseVoucherCounter(code, session = null) {
  await Voucher.findOneAndUpdate(
    { code },
    { $inc: { usedCount: -1 } },
    { new: true, session }
  );
}

async function releaseVoucherUsage(topup, session = null) {
  const code = normalizeVoucherCode(topup?.voucherCode);
  if (!code) return;

  await VoucherRedemption.findOneAndDelete({ topupId: topup._id }, { session }).catch(() => {});
  await releaseVoucherCounter(code, session);
}

async function assertPackageTopupLimit(topup, session = null) {
  const packageId = topup.packageId?._id || topup.packageId;
  if (!packageId) return;

  const pack = await leanMaybeSession(TopupPackage.findById(packageId), session);
  const limit = Number(pack?.maxTopupsPerUser || 0);
  if (!Number.isFinite(limit) || limit <= 0) return;

  const userId = topup.userId?._id || topup.userId;
  const used = await execMaybeSession(Topup.countDocuments({
    userId,
    packageId,
    status: "approved",
  }), session);
  if (used >= limit) {
    const error = new Error(
      `Tai khoan nay da dat gioi han nap goi ${pack.name || ""} (${limit} lan).`,
    );
    error.status = 409;
    throw error;
  }
}

async function approvePendingTopupWithSession(topup, approvalFields = {}, session = null) {
  let voucherClaimed = false;

  try {
    await assertPackageTopupLimit(topup, session);

    if (topup.voucherCode) {
      await claimVoucherUsage(topup, session);
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
      { new: true, session }
    );

    if (!approvedTopup) {
      if (voucherClaimed) await releaseVoucherUsage(topup, session);
      return null;
    }

    const user = await addCredit(
      approvedTopup.userId._id || approvedTopup.userId,
      approvedTopup.credit,
      { session },
    );
    return { topup: approvedTopup, user };
  } catch (error) {
    if (voucherClaimed) await releaseVoucherUsage(topup, session);
    throw error;
  }
}

function notifyApproval(result, approvalFields = {}) {
  if (!result) return;
  notifyTopupApproved({
    topup: result.topup,
    user: result.user,
    source: approvalFields.gatewayTransactionId ? "Payment webhook" : "Admin",
  });
}

export async function approvePendingTopup(topup, approvalFields = {}) {
  if (isMemoryDb()) {
    const result = await approvePendingTopupWithSession(topup, approvalFields);
    notifyApproval(result, approvalFields);
    return result;
  }

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      result = await approvePendingTopupWithSession(topup, approvalFields, session);
    });
    notifyApproval(result, approvalFields);
    return result;
  } finally {
    await session.endSession();
  }
}
