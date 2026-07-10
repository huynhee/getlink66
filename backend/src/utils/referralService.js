import crypto from "node:crypto";
import mongoose from "mongoose";
import { isMemoryDb } from "../config/memoryStore.js";
import Notification from "../models/Notification.js";
import Referral from "../models/Referral.js";
import SiteSetting from "../models/SiteSetting.js";
import User from "../models/User.js";
import logger from "./logger.js";

const REFERRAL_CODE_RE = /^[A-Z0-9]{6,24}$/;
const REFERRAL_MODES = new Set(["both", "referrer_only", "off"]);

function maxStoredCredit() {
  const value = Number(process.env.MAX_STORED_CREDIT || 10000000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10000000;
}

function rewardCredit() {
  const value = Number(process.env.REFERRAL_REWARD_CREDIT || 28);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 28;
}

async function referralMode() {
  const settings = await SiteSetting.findOne({ key: "homepage" }).select("referralMode").lean();
  const mode = String(settings?.referralMode || "both");
  return REFERRAL_MODES.has(mode) ? mode : "both";
}

export function normalizeReferralCode(value = "") {
  const code = String(value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return REFERRAL_CODE_RE.test(code) ? code : "";
}

function makeReferralCode(userId) {
  const suffix = String(userId || "").slice(-6).toUpperCase();
  return `3D${suffix}${crypto.randomBytes(2).toString("hex").toUpperCase()}`.slice(0, 14);
}

export async function ensureReferralCode(user) {
  if (!user?._id) return "";
  if (normalizeReferralCode(user.referralCode)) return user.referralCode;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const referralCode = makeReferralCode(`${user._id}${attempt}`);
    try {
      const updated = await User.findOneAndUpdate(
        { _id: user._id, $or: [{ referralCode: { $exists: false } }, { referralCode: "" }, { referralCode: null }] },
        { $set: { referralCode } },
        { new: true },
      );
      return updated?.referralCode || referralCode;
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }

  const fallback = crypto.randomBytes(6).toString("hex").toUpperCase();
  const updated = await User.findByIdAndUpdate(user._id, { $set: { referralCode: fallback } }, { new: true });
  return updated?.referralCode || fallback;
}

async function notifyReferralReward({ referrer, referredUser, referrerCredit, referredCredit }) {
  const notifications = [
    {
      title: `+${referrerCredit} credit giới thiệu`,
      body: `${referredUser.name || referredUser.email} đã đăng ký bằng link của bạn. Bạn nhận thêm ${referrerCredit} credit.`,
      targetType: "users",
      userIds: [referrer._id],
      displayType: "dropdown",
      actionLabel: "Xem lịch sử",
      actionUrl: "/history",
    },
  ];

  if (referredCredit > 0) {
    notifications.push({
      title: `+${referredCredit} credit chào mừng`,
      body: `Bạn đã đăng ký bằng link giới thiệu và nhận ${referredCredit} credit miễn phí.`,
      targetType: "users",
      userIds: [referredUser._id],
      displayType: "dropdown",
      actionLabel: "Bắt đầu tải",
      actionUrl: "/getlink",
    });
  }

  await Notification.insertMany(notifications);
}

function transactionUnsupported(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    text.includes("transaction numbers are only allowed") ||
    text.includes("replica set member or mongos") ||
    text.includes("transactions are not supported")
  );
}

async function awardReferralSignupTransactional(
  referredUser,
  { mode, referralCode, credit, creditLimit },
) {
  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const [freshReferredUser, referrer] = await Promise.all([
        User.findOne({ _id: referredUser._id }).session(session),
        User.findOne({ referralCode }).session(session),
      ]);
      if (
        !freshReferredUser ||
        !referrer ||
        freshReferredUser.referralRewardedAt ||
        freshReferredUser.referredBy ||
        String(referrer._id) === String(freshReferredUser._id)
      ) {
        return;
      }

      const referrerCredit = credit;
      const referredCredit = mode === "both" ? credit : 0;
      const [referral] = await Referral.create(
        [{
          referrerId: referrer._id,
          referredUserId: freshReferredUser._id,
          referralCode,
          rewardCredit: credit,
          referrerRewardCredit: referrerCredit,
          referredRewardCredit: referredCredit,
          rewardMode: mode,
          status: "rewarded",
          rewardedAt: new Date(),
        }],
        { session },
      );

      const now = new Date();
      const updatedReferredUser = await User.findOneAndUpdate(
        {
          _id: freshReferredUser._id,
          ...(referredCredit > 0
            ? { credit: { $lte: creditLimit - referredCredit } }
            : {}),
          $or: [
            { referralRewardedAt: { $exists: false } },
            { referralRewardedAt: null },
          ],
        },
        {
          $set: { referredBy: referrer._id, referralRewardedAt: now },
          ...(referredCredit > 0 ? { $inc: { credit: referredCredit } } : {}),
        },
        { new: true, session },
      );
      const updatedReferrer = await User.findOneAndUpdate(
        { _id: referrer._id, credit: { $lte: creditLimit - referrerCredit } },
        { $inc: { credit: referrerCredit } },
        { new: true, session },
      );
      if (!updatedReferredUser || !updatedReferrer) {
        const error = new Error("Referral credit limit or state conflict.");
        error.code = "REFERRAL_STATE_CONFLICT";
        throw error;
      }

      result = {
        referral,
        referrer: updatedReferrer,
        referredUser: updatedReferredUser,
        credit: referrerCredit,
        referrerCredit,
        referredCredit,
        mode,
      };
    });
    if (result) {
      await notifyReferralReward(result).catch((error) => {
        logger.warn({ message: error.message }, "Referral notification failed");
      });
    }
    return result;
  } finally {
    await session.endSession();
  }
}

export async function awardReferralSignup(referredUser, rawCode) {
  const mode = await referralMode();
  if (mode === "off") return null;

  const referralCode = normalizeReferralCode(rawCode);
  if (!referredUser?._id || !referralCode) return null;
  if (referredUser.referralRewardedAt || referredUser.referredBy) return null;

  const referrer = await User.findOne({ referralCode });
  if (!referrer || String(referrer._id) === String(referredUser._id)) return null;

  const credit = rewardCredit();
  const referrerCredit = credit;
  const referredCredit = mode === "both" ? credit : 0;
  const creditLimit = maxStoredCredit();
  if (referrerCredit > creditLimit || referredCredit > creditLimit) return null;

  if (!isMemoryDb()) {
    try {
      return await awardReferralSignupTransactional(referredUser, {
        mode,
        referralCode,
        credit,
        creditLimit,
      });
    } catch (error) {
      if (error?.code === 11000 || error?.code === "REFERRAL_STATE_CONFLICT") {
        return null;
      }
      if (!transactionUnsupported(error)) throw error;
      logger.warn(
        { message: error.message },
        "MongoDB transactions unavailable; using compensated referral write",
      );
    }
  }

  try {
    await Referral.create({
      referrerId: referrer._id,
      referredUserId: referredUser._id,
      referralCode,
      rewardCredit: credit,
      referrerRewardCredit: referrerCredit,
      referredRewardCredit: referredCredit,
      rewardMode: mode,
      status: "rewarded",
      rewardedAt: new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }

  const now = new Date();
  const updatedReferredUser = await User.findOneAndUpdate(
    {
      _id: referredUser._id,
      ...(referredCredit > 0 ? { credit: { $lte: creditLimit - referredCredit } } : {}),
      $or: [
        { referralRewardedAt: { $exists: false } },
        { referralRewardedAt: null },
      ],
    },
    {
      $set: { referredBy: referrer._id, referralRewardedAt: now },
      ...(referredCredit > 0 ? { $inc: { credit: referredCredit } } : {}),
    },
    { new: true },
  );

  if (!updatedReferredUser) {
    await Referral.deleteOne({ referredUserId: referredUser._id, referralCode }).catch(() => {});
    return null;
  }

  const updatedReferrer = await User.findOneAndUpdate(
    { _id: referrer._id, credit: { $lte: creditLimit - referrerCredit } },
    { $inc: { credit: referrerCredit } },
    { new: true },
  );

  if (!updatedReferrer) {
    await User.findOneAndUpdate(
      { _id: referredUser._id, referredBy: referrer._id, referralRewardedAt: now },
      {
        ...(referredCredit > 0 ? { $inc: { credit: -referredCredit } } : {}),
        $unset: { referredBy: "", referralRewardedAt: "" },
      },
    ).catch(() => {});
    await Referral.deleteOne({ referredUserId: referredUser._id, referralCode }).catch(() => {});
    return null;
  }

  await notifyReferralReward({
    referrer: updatedReferrer,
    referredUser: updatedReferredUser,
    referrerCredit,
    referredCredit,
  }).catch((error) => {
    logger.warn({ message: error.message }, "Referral notification failed");
  });

  return {
    referrer: updatedReferrer,
    referredUser: updatedReferredUser,
    credit: referrerCredit,
    referrerCredit,
    referredCredit,
    mode,
  };
}

export async function getReferralSummary(user, clientUrl) {
  const mode = await referralMode();
  if (mode === "off") {
    return {
      enabled: false,
      mode,
      referralCode: "",
      rewardCredit: rewardCredit(),
      referralUrl: "",
      invitedCount: 0,
      invitedUsers: [],
    };
  }

  const referralCode = await ensureReferralCode(user);
  const referrals = await Referral.find({ referrerId: user._id, status: "rewarded" })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("referredUserId", "name email avatar createdAt")
    .lean();

  return {
    enabled: true,
    mode,
    referralCode,
    rewardCredit: rewardCredit(),
    referralUrl: `${String(clientUrl || "").replace(/\/$/, "")}/?ref=${encodeURIComponent(referralCode)}`,
    invitedCount: referrals.length,
    invitedUsers: referrals.map((item) => ({
      _id: item.referredUserId?._id || item.referredUserId,
      name: item.referredUserId?.name || "",
      email: item.referredUserId?.email || "",
      avatar: item.referredUserId?.avatar || "",
      rewardCredit: item.referrerRewardCredit ?? item.rewardCredit,
      createdAt: item.createdAt,
      rewardedAt: item.rewardedAt,
    })),
  };
}
