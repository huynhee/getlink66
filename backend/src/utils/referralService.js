import crypto from "node:crypto";
import Notification from "../models/Notification.js";
import Referral from "../models/Referral.js";
import User from "../models/User.js";

const REFERRAL_CODE_RE = /^[A-Z0-9]{6,24}$/;

function maxStoredCredit() {
  const value = Number(process.env.MAX_STORED_CREDIT || 10000000);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 10000000;
}

function rewardCredit() {
  const value = Number(process.env.REFERRAL_REWARD_CREDIT || 28);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 28;
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

async function notifyReferralReward({ referrer, referredUser, credit }) {
  await Notification.insertMany([
    {
      title: `+${credit} credit giới thiệu`,
      body: `${referredUser.name || referredUser.email} đã đăng ký bằng link của bạn. Bạn nhận thêm ${credit} credit.`,
      targetType: "users",
      userIds: [referrer._id],
      displayType: "dropdown",
      actionLabel: "Xem lịch sử",
      actionUrl: "/history",
    },
    {
      title: `+${credit} credit chào mừng`,
      body: `Bạn đã đăng ký bằng link giới thiệu và nhận ${credit} credit miễn phí.`,
      targetType: "users",
      userIds: [referredUser._id],
      displayType: "dropdown",
      actionLabel: "Bắt đầu tải",
      actionUrl: "/getlink",
    },
  ]);
}

export async function awardReferralSignup(referredUser, rawCode) {
  const referralCode = normalizeReferralCode(rawCode);
  if (!referredUser?._id || !referralCode) return null;
  if (referredUser.referralRewardedAt || referredUser.referredBy) return null;

  const referrer = await User.findOne({ referralCode });
  if (!referrer || String(referrer._id) === String(referredUser._id)) return null;

  const credit = rewardCredit();
  const creditLimit = maxStoredCredit();
  if (credit > creditLimit) return null;

  try {
    await Referral.create({
      referrerId: referrer._id,
      referredUserId: referredUser._id,
      referralCode,
      rewardCredit: credit,
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
      credit: { $lte: creditLimit - credit },
      $or: [
        { referralRewardedAt: { $exists: false } },
        { referralRewardedAt: null },
      ],
    },
    {
      $set: { referredBy: referrer._id, referralRewardedAt: now },
      $inc: { credit },
    },
    { new: true },
  );

  if (!updatedReferredUser) {
    await Referral.deleteOne({ referredUserId: referredUser._id, referralCode }).catch(() => {});
    return null;
  }

  const updatedReferrer = await User.findOneAndUpdate(
    { _id: referrer._id, credit: { $lte: creditLimit - credit } },
    { $inc: { credit } },
    { new: true },
  );

  if (!updatedReferrer) {
    await User.findOneAndUpdate(
      { _id: referredUser._id, referredBy: referrer._id, referralRewardedAt: now },
      {
        $inc: { credit: -credit },
        $unset: { referredBy: "", referralRewardedAt: "" },
      },
    ).catch(() => {});
    await Referral.deleteOne({ referredUserId: referredUser._id, referralCode }).catch(() => {});
    return null;
  }

  await notifyReferralReward({
    referrer: updatedReferrer,
    referredUser: updatedReferredUser,
    credit,
  });

  return {
    referrer: updatedReferrer,
    referredUser: updatedReferredUser,
    credit,
  };
}

export async function getReferralSummary(user, clientUrl) {
  const referralCode = await ensureReferralCode(user);
  const referrals = await Referral.find({ referrerId: user._id, status: "rewarded" })
    .sort({ createdAt: -1 })
    .limit(50)
    .populate("referredUserId", "name email avatar createdAt")
    .lean();

  return {
    referralCode,
    rewardCredit: rewardCredit(),
    referralUrl: `${String(clientUrl || "").replace(/\/$/, "")}/?ref=${encodeURIComponent(referralCode)}`,
    invitedCount: referrals.length,
    invitedUsers: referrals.map((item) => ({
      _id: item.referredUserId?._id || item.referredUserId,
      name: item.referredUserId?.name || "",
      email: item.referredUserId?.email || "",
      avatar: item.referredUserId?.avatar || "",
      rewardCredit: item.rewardCredit,
      createdAt: item.createdAt,
      rewardedAt: item.rewardedAt,
    })),
  };
}
