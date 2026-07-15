import crypto from "node:crypto";
import mongoose from "mongoose";
import { isMemoryDb } from "../config/memoryStore.js";
import Notification from "../models/Notification.js";
import Referral from "../models/Referral.js";
import SiteSetting from "../models/SiteSetting.js";
import User from "../models/User.js";
import { endOfVietnamDay } from "./membershipService.js";
import logger from "./logger.js";

const REFERRAL_CODE_RE = /^[A-Z0-9]{6,24}$/;
const REFERRAL_MODES = new Set(["both", "referrer_only", "off"]);
const REFERRAL_PRO_DAYS = 1;
const MEMBER_DAILY_DOWNLOAD_LIMIT = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

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

export function referralRewardProUntil(user, at = new Date()) {
  const currentUntil = user?.proUntil ? new Date(user.proUntil) : null;
  const base = currentUntil && currentUntil > at ? currentUntil : at;
  return endOfVietnamDay(new Date(base.getTime() + REFERRAL_PRO_DAYS * DAY_MS));
}

function proStateCondition(user) {
  if (user?.proUntil) return { proUntil: new Date(user.proUntil) };
  return { $or: [{ proUntil: { $exists: false } }, { proUntil: null }] };
}

function proRewardFields(user, now) {
  const currentUntil = user?.proUntil ? new Date(user.proUntil) : null;
  const wasActive = Boolean(currentUntil && currentUntil > now);
  return {
    proUntil: referralRewardProUntil(user, now),
    proDailyDownloadLimit: Math.max(
      MEMBER_DAILY_DOWNLOAD_LIMIT,
      Number(user?.proDailyDownloadLimit || 0),
    ),
    ...(!wasActive && !user?.proActivatedAt ? { proActivatedAt: now } : {}),
  };
}

function referralRecord({ referrer, referredUser, referralCode, mode, now, referrerProUntil, referredProUntil }) {
  return {
    referrerId: referrer._id,
    referredUserId: referredUser._id,
    referralCode,
    rewardType: "pro",
    rewardCredit: 0,
    referrerRewardCredit: 0,
    referredRewardCredit: 0,
    rewardProDays: REFERRAL_PRO_DAYS,
    referrerRewardProDays: REFERRAL_PRO_DAYS,
    referredRewardProDays: mode === "both" ? REFERRAL_PRO_DAYS : 0,
    referrerProUntil,
    referredProUntil: mode === "both" ? referredProUntil : null,
    rewardMode: mode,
    status: "rewarded",
    rewardedAt: now,
  };
}

async function notifyReferralReward({ referrer, referredUser, referredProDays }) {
  const notifications = [
    {
      title: "+1 ngày Pro từ lời mời",
      body: `${referredUser.name || referredUser.email} đã đăng ký bằng link của bạn. Hạn Pro đã được cộng thêm 1 ngày và kết thúc lúc 23:59.`,
      targetType: "users",
      userIds: [referrer._id],
      displayType: "dropdown",
      actionLabel: "Xem lịch sử",
      actionUrl: "/history?type=referral",
    },
  ];

  if (referredProDays > 0) {
    notifications.push({
      title: "+1 ngày Pro chào mừng",
      body: "Bạn đã đăng ký bằng link giới thiệu và nhận 1 ngày Pro miễn phí, kết thúc lúc 23:59.",
      targetType: "users",
      userIds: [referredUser._id],
      displayType: "dropdown",
      actionLabel: "Khám phá model Pro",
      actionUrl: "/models?accessType=member",
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

function referralClaimCondition(user, includeProState) {
  const conditions = [
    {
      $or: [
        { referralRewardedAt: { $exists: false } },
        { referralRewardedAt: null },
      ],
    },
  ];
  if (includeProState) conditions.push(proStateCondition(user));
  return { _id: user._id, $and: conditions };
}

async function awardReferralSignupTransactional(referredUser, { mode, referralCode }) {
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

      const now = new Date();
      const referrerReward = proRewardFields(referrer, now);
      const referredReward = mode === "both" ? proRewardFields(freshReferredUser, now) : {};
      const [referral] = await Referral.create(
        [referralRecord({
          referrer,
          referredUser: freshReferredUser,
          referralCode,
          mode,
          now,
          referrerProUntil: referrerReward.proUntil,
          referredProUntil: referredReward.proUntil,
        })],
        { session },
      );

      const updatedReferredUser = await User.findOneAndUpdate(
        referralClaimCondition(freshReferredUser, mode === "both"),
        {
          $set: {
            referredBy: referrer._id,
            referralRewardedAt: now,
            ...referredReward,
          },
        },
        { new: true, session },
      );
      const updatedReferrer = await User.findOneAndUpdate(
        { _id: referrer._id, ...proStateCondition(referrer) },
        { $set: referrerReward },
        { new: true, session },
      );
      if (!updatedReferredUser || !updatedReferrer) {
        const error = new Error("Referral Pro state conflict.");
        error.code = "REFERRAL_STATE_CONFLICT";
        throw error;
      }

      result = {
        referral,
        referrer: updatedReferrer,
        referredUser: updatedReferredUser,
        rewardType: "pro",
        proDays: REFERRAL_PRO_DAYS,
        referrerProDays: REFERRAL_PRO_DAYS,
        referredProDays: mode === "both" ? REFERRAL_PRO_DAYS : 0,
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

function previousProState(user) {
  return {
    proUntil: user?.proUntil || null,
    proActivatedAt: user?.proActivatedAt || null,
    proDailyDownloadLimit: user?.proDailyDownloadLimit,
  };
}

function restoreProStateUpdate(snapshot, extraUnset = {}) {
  const set = {};
  const unset = { ...extraUnset };
  ["proUntil", "proActivatedAt", "proDailyDownloadLimit"].forEach((field) => {
    if (snapshot[field] === undefined || snapshot[field] === null) unset[field] = "";
    else set[field] = snapshot[field];
  });
  return {
    ...(Object.keys(set).length ? { $set: set } : {}),
    ...(Object.keys(unset).length ? { $unset: unset } : {}),
  };
}

export async function awardReferralSignup(referredUser, rawCode) {
  const mode = await referralMode();
  if (mode === "off") return null;

  const referralCode = normalizeReferralCode(rawCode);
  if (!referredUser?._id || !referralCode) return null;
  if (referredUser.referralRewardedAt || referredUser.referredBy) return null;

  const referrer = await User.findOne({ referralCode });
  if (!referrer || String(referrer._id) === String(referredUser._id)) return null;

  if (!isMemoryDb()) {
    try {
      return await awardReferralSignupTransactional(referredUser, { mode, referralCode });
    } catch (error) {
      if (error?.code === 11000 || error?.code === "REFERRAL_STATE_CONFLICT") return null;
      if (!transactionUnsupported(error)) throw error;
      logger.warn(
        { message: error.message },
        "MongoDB transactions unavailable; using compensated referral write",
      );
    }
  }

  const now = new Date();
  const referrerReward = proRewardFields(referrer, now);
  const referredReward = mode === "both" ? proRewardFields(referredUser, now) : {};
  const referredPreviousState = previousProState(referredUser);

  try {
    await Referral.create(referralRecord({
      referrer,
      referredUser,
      referralCode,
      mode,
      now,
      referrerProUntil: referrerReward.proUntil,
      referredProUntil: referredReward.proUntil,
    }));
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }

  const updatedReferredUser = await User.findOneAndUpdate(
    referralClaimCondition(referredUser, mode === "both"),
    {
      $set: {
        referredBy: referrer._id,
        referralRewardedAt: now,
        ...referredReward,
      },
    },
    { new: true },
  );

  if (!updatedReferredUser) {
    await Referral.deleteOne({ referredUserId: referredUser._id, referralCode }).catch(() => {});
    return null;
  }

  const updatedReferrer = await User.findOneAndUpdate(
    { _id: referrer._id, ...proStateCondition(referrer) },
    { $set: referrerReward },
    { new: true },
  );

  if (!updatedReferrer) {
    await User.findOneAndUpdate(
      { _id: referredUser._id, referredBy: referrer._id, referralRewardedAt: now },
      restoreProStateUpdate(referredPreviousState, {
        referredBy: "",
        referralRewardedAt: "",
      }),
    ).catch(() => {});
    await Referral.deleteOne({ referredUserId: referredUser._id, referralCode }).catch(() => {});
    return null;
  }

  const result = {
    referrer: updatedReferrer,
    referredUser: updatedReferredUser,
    rewardType: "pro",
    proDays: REFERRAL_PRO_DAYS,
    referrerProDays: REFERRAL_PRO_DAYS,
    referredProDays: mode === "both" ? REFERRAL_PRO_DAYS : 0,
    mode,
  };

  await notifyReferralReward(result).catch((error) => {
    logger.warn({ message: error.message }, "Referral notification failed");
  });

  return result;
}

export async function getReferralSummary(user, clientUrl) {
  const mode = await referralMode();
  if (mode === "off") {
    return {
      enabled: false,
      mode,
      referralCode: "",
      rewardType: "pro",
      rewardProDays: REFERRAL_PRO_DAYS,
      rewardCredit: 0,
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
    rewardType: "pro",
    rewardProDays: REFERRAL_PRO_DAYS,
    rewardCredit: 0,
    referralUrl: `${String(clientUrl || "").replace(/\/$/, "")}/?ref=${encodeURIComponent(referralCode)}`,
    invitedCount: referrals.length,
    invitedUsers: referrals.map((item) => ({
      _id: item.referredUserId?._id || item.referredUserId,
      name: item.referredUserId?.name || "",
      email: item.referredUserId?.email || "",
      avatar: item.referredUserId?.avatar || "",
      rewardType: item.rewardType || "credit",
      rewardProDays: Number(item.referrerRewardProDays || 0),
      rewardCredit: Number(item.referrerRewardCredit ?? item.rewardCredit ?? 0),
      proUntil: item.referrerProUntil || null,
      createdAt: item.createdAt,
      rewardedAt: item.rewardedAt,
    })),
  };
}
