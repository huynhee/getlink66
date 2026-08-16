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
const REFERRAL_CREDIT = 28;
const MEMBER_DAILY_DOWNLOAD_LIMIT = 100;

async function referralSettings() {
  const settings = await SiteSetting.findOne({ key: "homepage" })
    .select("referralMode referralRewardCreditEnabled referralRewardProEnabled")
    .lean();
  const mode = String(settings?.referralMode || "both");
  return {
    mode: REFERRAL_MODES.has(mode) ? mode : "both",
    creditEnabled: settings?.referralRewardCreditEnabled !== false,
    proEnabled: settings?.referralRewardProEnabled !== false,
  };
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
  const rewardUntil = endOfVietnamDay(at);
  return currentUntil && currentUntil > rewardUntil ? currentUntil : rewardUntil;
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

function referralRecord({ referrer, referredUser, referralCode, mode, rewards, now, referrerProUntil, referredProUntil }) {
  const referrerCredit = rewards.creditEnabled ? REFERRAL_CREDIT : 0;
  const referredCredit = mode === "both" ? referrerCredit : 0;
  const referrerProDays = rewards.proEnabled ? REFERRAL_PRO_DAYS : 0;
  const referredProDays = mode === "both" ? referrerProDays : 0;
  return {
    referrerId: referrer._id,
    referredUserId: referredUser._id,
    referralCode,
    rewardType: rewards.proEnabled ? "pro" : "credit",
    rewardCredit: referrerCredit,
    referrerRewardCredit: referrerCredit,
    referredRewardCredit: referredCredit,
    rewardProDays: referrerProDays,
    referrerRewardProDays: referrerProDays,
    referredRewardProDays: referredProDays,
    referrerProUntil: rewards.proEnabled ? referrerProUntil : null,
    referredProUntil: referredProDays ? referredProUntil : null,
    proExpiryPolicy: "same_day",
    rewardMode: mode,
    status: "rewarded",
    rewardedAt: now,
  };
}

function referralRewardText(proDays, credit, language = "vi") {
  const parts = [
    proDays > 0 ? (language === "vi" ? `${proDays} ngày Pro` : `${proDays} Pro day`) : "",
    credit > 0 ? `${credit} credit` : "",
  ].filter(Boolean);
  return parts.join(language === "vi" ? " và " : " and ");
}

async function notifyReferralReward({
  referrer,
  referredUser,
  referrerProDays,
  referrerCredit,
  referredProDays,
  referredCredit,
}) {
  const referrerReward = referralRewardText(referrerProDays, referrerCredit);
  const notifications = [
    {
      title: `Phần thưởng giới thiệu: ${referrerReward}`,
      body: `${referredUser.name || referredUser.email} đã đăng ký bằng link của bạn. Bạn nhận ${referrerReward}.`,
      targetType: "users",
      userIds: [referrer._id],
      displayType: "dropdown",
      actionLabel: "Xem lịch sử",
      actionUrl: "/history?type=referral",
    },
  ];

  if (referredProDays > 0 || referredCredit > 0) {
    const referredReward = referralRewardText(referredProDays, referredCredit);
    notifications.push({
      title: `Phần thưởng chào mừng: ${referredReward}`,
      body: `Bạn đã đăng ký bằng link giới thiệu và nhận ${referredReward}.`,
      targetType: "users",
      userIds: [referredUser._id],
      displayType: "dropdown",
      actionLabel: "Khám phá model Pro",
      actionUrl: referredProDays > 0 ? "/models?accessType=member" : "/history?type=referral",
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

async function awardReferralSignupTransactional(referredUser, { mode, rewards, referralCode }) {
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
      const referrerReward = rewards.proEnabled ? proRewardFields(referrer, now) : {};
      const referredReward = mode === "both" && rewards.proEnabled
        ? proRewardFields(freshReferredUser, now)
        : {};
      const [referral] = await Referral.create(
        [referralRecord({
          referrer,
          referredUser: freshReferredUser,
          referralCode,
          mode,
          rewards,
          now,
          referrerProUntil: referrerReward.proUntil,
          referredProUntil: referredReward.proUntil,
        })],
        { session },
      );

      const updatedReferredUser = await User.findOneAndUpdate(
        referralClaimCondition(freshReferredUser, mode === "both" && rewards.proEnabled),
        {
          $set: {
            referredBy: referrer._id,
            referralRewardedAt: now,
            ...referredReward,
          },
          ...(mode === "both" && rewards.creditEnabled ? { $inc: { credit: REFERRAL_CREDIT } } : {}),
        },
        { new: true, session },
      );
      const updatedReferrer = await User.findOneAndUpdate(
        { _id: referrer._id, ...(rewards.proEnabled ? proStateCondition(referrer) : {}) },
        {
          ...(rewards.proEnabled ? { $set: referrerReward } : {}),
          ...(rewards.creditEnabled ? { $inc: { credit: REFERRAL_CREDIT } } : {}),
        },
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
        rewardType: rewards.proEnabled ? "pro" : "credit",
        proDays: rewards.proEnabled ? REFERRAL_PRO_DAYS : 0,
        referrerProDays: rewards.proEnabled ? REFERRAL_PRO_DAYS : 0,
        referredProDays: mode === "both" && rewards.proEnabled ? REFERRAL_PRO_DAYS : 0,
        rewardCredit: rewards.creditEnabled ? REFERRAL_CREDIT : 0,
        referrerCredit: rewards.creditEnabled ? REFERRAL_CREDIT : 0,
        referredCredit: mode === "both" && rewards.creditEnabled ? REFERRAL_CREDIT : 0,
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
  const rewards = await referralSettings();
  const { mode } = rewards;
  if (mode === "off") return null;

  const referralCode = normalizeReferralCode(rawCode);
  if (!referredUser?._id || !referralCode) return null;
  if (referredUser.referralRewardedAt || referredUser.referredBy) return null;

  const referrer = await User.findOne({ referralCode });
  if (!referrer || String(referrer._id) === String(referredUser._id)) return null;

  if (!isMemoryDb()) {
    try {
      return await awardReferralSignupTransactional(referredUser, { mode, rewards, referralCode });
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
  const referrerReward = rewards.proEnabled ? proRewardFields(referrer, now) : {};
  const referredReward = mode === "both" && rewards.proEnabled ? proRewardFields(referredUser, now) : {};
  const referredPreviousState = previousProState(referredUser);

  try {
    await Referral.create(referralRecord({
      referrer,
      referredUser,
      referralCode,
      mode,
      rewards,
      now,
      referrerProUntil: referrerReward.proUntil,
      referredProUntil: referredReward.proUntil,
    }));
  } catch (error) {
    if (error?.code === 11000) return null;
    throw error;
  }

  const updatedReferredUser = await User.findOneAndUpdate(
    referralClaimCondition(referredUser, mode === "both" && rewards.proEnabled),
    {
      $set: {
        referredBy: referrer._id,
        referralRewardedAt: now,
        ...referredReward,
      },
      ...(mode === "both" && rewards.creditEnabled ? { $inc: { credit: REFERRAL_CREDIT } } : {}),
    },
    { new: true },
  );

  if (!updatedReferredUser) {
    await Referral.deleteOne({ referredUserId: referredUser._id, referralCode }).catch(() => {});
    return null;
  }

  const updatedReferrer = await User.findOneAndUpdate(
    { _id: referrer._id, ...(rewards.proEnabled ? proStateCondition(referrer) : {}) },
    {
      ...(rewards.proEnabled ? { $set: referrerReward } : {}),
      ...(rewards.creditEnabled ? { $inc: { credit: REFERRAL_CREDIT } } : {}),
    },
    { new: true },
  );

  if (!updatedReferrer) {
    const referredRollback = rewards.proEnabled
      ? restoreProStateUpdate(referredPreviousState, {
        referredBy: "",
        referralRewardedAt: "",
      })
      : { $unset: { referredBy: "", referralRewardedAt: "" } };
    if (mode === "both" && rewards.creditEnabled) {
      referredRollback.$inc = { credit: -REFERRAL_CREDIT };
    }
    await User.findOneAndUpdate(
      { _id: referredUser._id, referredBy: referrer._id, referralRewardedAt: now },
      referredRollback,
    ).catch(() => {});
    await Referral.deleteOne({ referredUserId: referredUser._id, referralCode }).catch(() => {});
    return null;
  }

  const result = {
    referrer: updatedReferrer,
    referredUser: updatedReferredUser,
    rewardType: rewards.proEnabled ? "pro" : "credit",
    proDays: rewards.proEnabled ? REFERRAL_PRO_DAYS : 0,
    referrerProDays: rewards.proEnabled ? REFERRAL_PRO_DAYS : 0,
    referredProDays: mode === "both" && rewards.proEnabled ? REFERRAL_PRO_DAYS : 0,
    rewardCredit: rewards.creditEnabled ? REFERRAL_CREDIT : 0,
    referrerCredit: rewards.creditEnabled ? REFERRAL_CREDIT : 0,
    referredCredit: mode === "both" && rewards.creditEnabled ? REFERRAL_CREDIT : 0,
    mode,
  };

  await notifyReferralReward(result).catch((error) => {
    logger.warn({ message: error.message }, "Referral notification failed");
  });

  return result;
}

export async function getReferralSummary(user, clientUrl) {
  const rewards = await referralSettings();
  const { mode } = rewards;
  if (mode === "off") {
    return {
      enabled: false,
      mode,
      referralCode: "",
      rewardType: rewards.proEnabled ? "pro" : "credit",
      rewardProDays: rewards.proEnabled ? REFERRAL_PRO_DAYS : 0,
      rewardCredit: rewards.creditEnabled ? REFERRAL_CREDIT : 0,
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
    rewardType: rewards.proEnabled ? "pro" : "credit",
    rewardProDays: rewards.proEnabled ? REFERRAL_PRO_DAYS : 0,
    rewardCredit: rewards.creditEnabled ? REFERRAL_CREDIT : 0,
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
