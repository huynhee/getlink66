import { getReferralSummary } from "../utils/referralService.js";
import Referral from "../models/Referral.js";

export async function myReferral(req, res, next) {
  try {
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    res.json(await getReferralSummary(req.user, clientUrl));
  } catch (error) {
    next(error);
  }
}

export async function referralHistory(req, res, next) {
  try {
    const referrals = await Referral.find({
      status: "rewarded",
      $or: [{ referrerId: req.user._id }, { referredUserId: req.user._id }],
    })
      .sort({ createdAt: -1 })
      .populate("referrerId", "name email avatar")
      .populate("referredUserId", "name email avatar")
      .limit(100);

    const history = referrals
      .map((item) => {
        const isReferrer = String(item.referrerId?._id || item.referrerId) === String(req.user._id);
        const rewardType = item.rewardType || "credit";
        const credit = isReferrer
          ? Number(item.referrerRewardCredit ?? item.rewardCredit ?? 0)
          : Number(item.referredRewardCredit ?? item.rewardCredit ?? 0);
        const proDays = isReferrer
          ? Number(item.referrerRewardProDays || 0)
          : Number(item.referredRewardProDays || 0);
        if (rewardType === "pro" ? proDays <= 0 : credit <= 0) return null;
        const otherUser = isReferrer ? item.referredUserId : item.referrerId;
        return {
          _id: item._id,
          role: isReferrer ? "referrer" : "referred",
          referralCode: item.referralCode,
          rewardType,
          credit: rewardType === "credit" ? credit : 0,
          proDays: rewardType === "pro" ? proDays : 0,
          proUntil: isReferrer ? item.referrerProUntil : item.referredProUntil,
          otherUser: otherUser
            ? {
                _id: otherUser._id,
                name: otherUser.name || "",
                email: otherUser.email || "",
                avatar: otherUser.avatar || "",
              }
            : null,
          createdAt: item.rewardedAt || item.createdAt,
        };
      })
      .filter(Boolean);

    res.json({ history });
  } catch (error) {
    next(error);
  }
}
