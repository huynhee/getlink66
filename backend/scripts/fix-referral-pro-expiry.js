import "dotenv/config";
import { closeDbConnections, connectDb } from "../src/config/db.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIRM_VALUE = "referral-same-day-v1";
const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");

function correctedExpiry(value) {
  const date = new Date(value);
  return new Date(date.getTime() - DAY_MS);
}

function rewardTime(referral) {
  return new Date(referral.rewardedAt || referral.createdAt || 0).getTime();
}

async function main() {
  if (execute && process.env.REFERRAL_EXPIRY_CONFIRM !== CONFIRM_VALUE) {
    throw new Error(`Set REFERRAL_EXPIRY_CONFIRM=${CONFIRM_VALUE} before executing.`);
  }

  await connectDb();
  const [{ default: Referral }, { default: User }] = await Promise.all([
    import("../src/models/Referral.js"),
    import("../src/models/User.js"),
  ]);
  const referrals = await Referral.find({
    status: "rewarded",
    proExpiryPolicy: { $ne: "same_day" },
  }).sort({ rewardedAt: 1, _id: 1 }).lean();

  const userIds = new Set();
  referrals.forEach((referral) => {
    if (Number(referral.referrerRewardProDays || 0) > 0 && referral.referrerProUntil) {
      userIds.add(String(referral.referrerId));
    }
    if (Number(referral.referredRewardProDays || 0) > 0 && referral.referredProUntil) {
      userIds.add(String(referral.referredUserId));
    }
  });
  const users = userIds.size
    ? await User.find({ _id: { $in: [...userIds] } }).select("_id proUntil").lean()
    : [];
  const currentExpiryByUser = new Map(
    users.map((user) => [String(user._id), user.proUntil ? new Date(user.proUntil).getTime() : null]),
  );
  const userAdjustments = new Map();
  const referralOperations = [];

  function considerUserAdjustment(userId, oldUntil, newUntil, referral) {
    const key = String(userId);
    if (currentExpiryByUser.get(key) !== oldUntil.getTime()) return;
    const candidate = {
      userId,
      oldUntil,
      newUntil,
      rewardedAt: rewardTime(referral),
    };
    const existing = userAdjustments.get(key);
    if (!existing || candidate.rewardedAt > existing.rewardedAt) {
      userAdjustments.set(key, candidate);
    }
  }

  referrals.forEach((referral) => {
    const set = { proExpiryPolicy: "same_day" };
    if (Number(referral.referrerRewardProDays || 0) > 0 && referral.referrerProUntil) {
      const oldUntil = new Date(referral.referrerProUntil);
      const newUntil = correctedExpiry(oldUntil);
      set.referrerProUntil = newUntil;
      considerUserAdjustment(referral.referrerId, oldUntil, newUntil, referral);
    }
    if (Number(referral.referredRewardProDays || 0) > 0 && referral.referredProUntil) {
      const oldUntil = new Date(referral.referredProUntil);
      const newUntil = correctedExpiry(oldUntil);
      set.referredProUntil = newUntil;
      considerUserAdjustment(referral.referredUserId, oldUntil, newUntil, referral);
    }
    referralOperations.push({
      updateOne: {
        filter: { _id: referral._id, proExpiryPolicy: { $ne: "same_day" } },
        update: { $set: set },
      },
    });
  });

  const userOperations = [...userAdjustments.values()].map((adjustment) => ({
    updateOne: {
      filter: { _id: adjustment.userId, proUntil: adjustment.oldUntil },
      update: { $set: { proUntil: adjustment.newUntil } },
    },
  }));

  if (execute) {
    if (referralOperations.length) await Referral.bulkWrite(referralOperations, { ordered: false });
    if (userOperations.length) await User.bulkWrite(userOperations, { ordered: false });
  }

  console.log(JSON.stringify({
    mode: execute ? "execute" : "dry-run",
    legacyReferrals: referrals.length,
    referralRecordsToNormalize: referralOperations.length,
    userExpiriesToCorrect: userOperations.length,
  }, null, 2));
  if (!execute) {
    console.log(`Dry-run only. Re-run with REFERRAL_EXPIRY_CONFIRM=${CONFIRM_VALUE}.`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDbConnections().catch(() => {});
  });
