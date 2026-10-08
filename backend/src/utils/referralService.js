import crypto from "node:crypto";
import mongoose from "mongoose";
import { isMemoryDb } from "../config/memoryStore.js";
import Notification from "../models/Notification.js";
import Referral from "../models/Referral.js";
import SiteSetting from "../models/SiteSetting.js";
import User from "../models/User.js";
import { endOfVietnamDay, isProActive, vietnamDayKey } from "./membershipService.js";
import SubscriptionQuotaGrant from "../models/SubscriptionQuotaGrant.js";
import SubscriptionPeriod from "../models/SubscriptionPeriod.js";
import { grantReferralSubscription, refreshSubscriptionInTransaction } from "./subscriptionScheduleService.js";
import { synchronizeSubscriptionQuotaGrant } from "./marketplaceQuotaGrantService.js";
import { lockPaymentBenefits, preparePaymentBenefitGuard, serializeMemoryPayments } from "./paymentBenefitService.js";
import { publishAccountInvalidation } from "./accountEventBus.js";
import logger from "./logger.js";
import { referralRewardAmount } from "./referralRewardSettings.js";

const REFERRAL_CODE_RE = /^[A-Z0-9]{6,24}$/;
const REFERRAL_MODES = new Set(["both", "referrer_only", "off"]);
const REFERRAL_PRO_DAYS = 1;
const MEMBER_DAILY_DOWNLOAD_LIMIT = 100;

async function referralSettings() {
  const settings = await SiteSetting.findOne({ key: "homepage" })
    .select("referralMode referralRewardCreditEnabled referralRewardProEnabled referralRewardCredit referralRewardModelDownloads")
    .lean();
  const mode = String(settings?.referralMode || "both");
  return {
    mode: REFERRAL_MODES.has(mode) ? mode : "both",
    creditEnabled: settings?.referralRewardCreditEnabled !== false,
    proEnabled: settings?.referralRewardProEnabled !== false,
    credit: referralRewardAmount(settings?.referralRewardCredit, "referralRewardCredit"),
    modelDownloads: referralRewardAmount(settings?.referralRewardModelDownloads, "referralRewardModelDownloads"),
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

function proRewardFields(user, now, modelDownloads) {
  const currentUntil = user?.proUntil ? new Date(user.proUntil) : null;
  const wasActive = Boolean(currentUntil && currentUntil > now);
  return {
    proUntil: referralRewardProUntil(user, now),
    proDailyDownloadLimit: wasActive ? Number(user?.proDailyDownloadLimit || MEMBER_DAILY_DOWNLOAD_LIMIT) : modelDownloads,
    ...(!wasActive && !user?.proActivatedAt ? { proActivatedAt: now } : {}),
  };
}

function referralRecord({ referrer, referredUser, referralCode, mode, rewards, now, referrerProUntil, referredProUntil }) {
  const referrerCredit = rewards.creditEnabled ? rewards.credit : 0;
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
    referrerRewardModelDownloads: rewards.proEnabled ? rewards.modelDownloads : 0,
    referredRewardModelDownloads: referredProDays ? rewards.modelDownloads : 0,
    referrerProUntil: rewards.proEnabled ? referrerProUntil : null,
    referredProUntil: referredProDays ? referredProUntil : null,
    proExpiryPolicy: "same_day",
    rewardMode: mode,
    status: "rewarded",
    rewardedAt: now,
  };
}

function referralRewardText(proDays, credit, modelDownloads, language = "vi") {
  const parts = [
    proDays > 0 ? (language === "vi" ? `Pro hôm nay (${modelDownloads} lượt Model)` : `Pro today (${modelDownloads} Model downloads)`) : "",
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
  modelDownloads,
}) {
  const referrerReward = referralRewardText(referrerProDays, referrerCredit, modelDownloads);
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
    const referredReward = referralRewardText(referredProDays, referredCredit, modelDownloads);
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

async function prepareReferralProBenefits(result, previousUsers, now, session = null) {
  const grants = [];
  for (const [field, rewardField] of [["referrer", "referrerProDays"], ["referredUser", "referredProDays"]]) {
    if (!(result[rewardField] > 0)) continue;
    const previous = previousUsers[field];
    if (!isProActive(previous, now)) {
      result[field] = await grantReferralSubscription(previous, {
        at: now, session, sourceKey: `referral:${previous._id}:${vietnamDayKey(now)}`, dailyDownloadLimit: result.modelDownloads,
      });
    } else {
      const dayKey = vietnamDayKey(now);
      const query = SubscriptionQuotaGrant.find({ userId: previous._id, dayKey });
      const previousGrants = await (session ? query.session(session) : query).lean();
      const floorPrefix = `referral-floor:${previous._id}:${dayKey}`;
      // Count committed grants even while VPS synchronization is pending or retrying.
      const granted = previousGrants.filter((grant) => grant.sourceKey === floorPrefix || String(grant.sourceKey || "").startsWith(floorPrefix + ":"))
        .reduce((total, grant) => total + Number(grant.amount || 0), 0);
      const baseQuota = Number(previous.proDailyDownloadLimit || MEMBER_DAILY_DOWNLOAD_LIMIT);
      const amount = Math.max(0, result.modelDownloads - baseQuota - granted);
      if (amount > 0) {
        const sourceKey = `${floorPrefix}:${result.modelDownloads}:${baseQuota}:${granted}`;
        const grant = await SubscriptionQuotaGrant.findOneAndUpdate({ sourceKey }, { $setOnInsert: {
          sourceKey, userId: previous._id, dayKey, amount, status: "pending", attempts: 0,
        } }, { upsert: true, new: true, session });
        grants.push(grant);
      }
    }
  }
  result.quotaGrants = grants;
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
      for (const id of [String(referredUser._id), String((await User.findOne({ referralCode }).session(session))?._id)].sort()) {
        await lockPaymentBenefits(id, session);
      }
      let [freshReferredUser, referrer] = await Promise.all([
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
      freshReferredUser = await refreshSubscriptionInTransaction(freshReferredUser, { at: now, session });
      referrer = await refreshSubscriptionInTransaction(referrer, { at: now, session });
      const referrerReward = rewards.proEnabled ? proRewardFields(referrer, now, rewards.modelDownloads) : {};
      const referredReward = mode === "both" && rewards.proEnabled
        ? proRewardFields(freshReferredUser, now, rewards.modelDownloads)
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
          ...(mode === "both" && rewards.creditEnabled ? { $inc: { credit: rewards.credit } } : {}),
        },
        { new: true, session },
      );
      const updatedReferrer = await User.findOneAndUpdate(
        { _id: referrer._id, ...(rewards.proEnabled ? proStateCondition(referrer) : {}) },
        {
          ...(rewards.proEnabled ? { $set: referrerReward } : {}),
          ...(rewards.creditEnabled ? { $inc: { credit: rewards.credit } } : {}),
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
        rewardCredit: rewards.creditEnabled ? rewards.credit : 0,
        referrerCredit: rewards.creditEnabled ? rewards.credit : 0,
        referredCredit: mode === "both" && rewards.creditEnabled ? rewards.credit : 0,
        modelDownloads: rewards.proEnabled ? rewards.modelDownloads : 0,
        mode,
      };
      await prepareReferralProBenefits(result, { referrer, referredUser: freshReferredUser }, now, session);
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

async function awardReferralSignupInner(referredUser, rawCode) {
  const rewards = await referralSettings();
  const { mode } = rewards;
  if (mode === "off") return null;

  const referralCode = normalizeReferralCode(rawCode);
  if (!referredUser?._id || !referralCode) return null;
  if (referredUser.referralRewardedAt || referredUser.referredBy) return null;

  let referrer = await User.findOne({ referralCode });
  if (!referrer || String(referrer._id) === String(referredUser._id)) return null;

  if (!isMemoryDb()) {
    await preparePaymentBenefitGuard(referrer._id);
    await preparePaymentBenefitGuard(referredUser._id);
    try {
      return await awardReferralSignupTransactional(referredUser, { mode, rewards, referralCode });
    } catch (error) {
      if (error?.code === 11000 || error?.code === "REFERRAL_STATE_CONFLICT") return null;
      throw error;
    }
  }

  const now = new Date();
  referrer = await refreshSubscriptionInTransaction(referrer, { at: now });
  referredUser = await refreshSubscriptionInTransaction(referredUser, { at: now });
  const referrerReward = rewards.proEnabled ? proRewardFields(referrer, now, rewards.modelDownloads) : {};
  const referredReward = mode === "both" && rewards.proEnabled ? proRewardFields(referredUser, now, rewards.modelDownloads) : {};
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
      ...(mode === "both" && rewards.creditEnabled ? { $inc: { credit: rewards.credit } } : {}),
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
      ...(rewards.creditEnabled ? { $inc: { credit: rewards.credit } } : {}),
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
      referredRollback.$inc = { credit: -rewards.credit };
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
    rewardCredit: rewards.creditEnabled ? rewards.credit : 0,
    referrerCredit: rewards.creditEnabled ? rewards.credit : 0,
    referredCredit: mode === "both" && rewards.creditEnabled ? rewards.credit : 0,
    modelDownloads: rewards.proEnabled ? rewards.modelDownloads : 0,
    mode,
  };

  await prepareReferralProBenefits(result, { referrer, referredUser }, now);

  await notifyReferralReward(result).catch((error) => {
    logger.warn({ message: error.message }, "Referral notification failed");
  });

  return result;
}

export async function awardReferralSignup(referredUser, rawCode) {
  let result;
  if (isMemoryDb()) {
    result = await serializeMemoryPayments(async () => {
      const referrer = await User.findOne({ referralCode: normalizeReferralCode(rawCode) });
      const fresh = referredUser?._id ? await User.findById(referredUser._id) : null;
      if (!referrer || !fresh || fresh.referralRewardedAt || fresh.referredBy) return null;
      const snapshots = [referrer, fresh];
      const ids = snapshots.map((user) => user._id);
      const periods = await SubscriptionPeriod.find({ userId: { $in: ids } }).lean();
      const grants = await SubscriptionQuotaGrant.find({ userId: { $in: ids } }).lean();
      try { return await awardReferralSignupInner(fresh, rawCode); }
      catch (error) {
        for (const user of snapshots) {
          const $set = {}, $unset = {};
          for (const key of ["credit", "proUntil", "proActivatedAt", "proPlanId", "proDailyDownloadLimit", "subscriptionManaged", "subscriptionCurrentPeriod", "subscriptionNextTransitionAt", "referredBy", "referralRewardedAt"]) {
            if (user[key] === undefined) $unset[key] = ""; else $set[key] = user[key];
          }
          await User.findByIdAndUpdate(user._id, { $set, $unset });
        }
        await SubscriptionPeriod.deleteMany({ userId: { $in: ids } });
        await SubscriptionPeriod.insertMany(periods);
        await SubscriptionQuotaGrant.deleteMany({ userId: { $in: ids } });
        await SubscriptionQuotaGrant.insertMany(grants);
        await Referral.deleteOne({ referredUserId: fresh._id });
        throw error;
      }
    });
  } else result = await awardReferralSignupInner(referredUser, rawCode);
  if (result) {
    for (const grant of result.quotaGrants || []) {
      await synchronizeSubscriptionQuotaGrant(grant).catch((error) => logger.warn({ message: error.message }, "Referral quota queued for retry"));
    }
    publishAccountInvalidation(result.referrer._id, "referral_reward");
    publishAccountInvalidation(result.referredUser._id, "referral_reward");
  }
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
      rewardCredit: rewards.creditEnabled ? rewards.credit : 0,
      rewardModelDownloads: rewards.proEnabled ? rewards.modelDownloads : 0,
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
    rewardCredit: rewards.creditEnabled ? rewards.credit : 0,
    rewardModelDownloads: rewards.proEnabled ? rewards.modelDownloads : 0,
    referralUrl: `${String(clientUrl || "").replace(/\/$/, "")}/?ref=${encodeURIComponent(referralCode)}`,
    invitedCount: referrals.length,
    invitedUsers: referrals.map((item) => ({
      _id: item.referredUserId?._id || item.referredUserId,
      name: item.referredUserId?.name || "",
      email: item.referredUserId?.email || "",
      avatar: item.referredUserId?.avatar || "",
      rewardType: item.rewardType || "credit",
      rewardProDays: Number(item.referrerRewardProDays || 0),
      rewardModelDownloads: Number(item.referrerRewardModelDownloads ?? (item.referrerRewardProDays > 0 ? MEMBER_DAILY_DOWNLOAD_LIMIT : 0)),
      rewardCredit: Number(item.referrerRewardCredit ?? item.rewardCredit ?? 0),
      proUntil: item.referrerProUntil || null,
      createdAt: item.createdAt,
      rewardedAt: item.rewardedAt,
    })),
  };
}
