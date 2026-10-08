import crypto from "node:crypto";
import mongoose from "mongoose";
import { isMemoryDb } from "../config/memoryStore.js";
import User from "../models/User.js";
import MembershipOrder from "../models/MembershipOrder.js";
import SubscriptionPeriod from "../models/SubscriptionPeriod.js";
import { publishAccountInvalidation } from "./accountEventBus.js";
import { lockPaymentBenefits, preparePaymentBenefitGuard, serializeMemoryPayments } from "./paymentBenefitService.js";
import { billingPeriodFor, DAY_MS, nextVietnamReset, normalizeProUntil, subscriptionEnd } from "./subscriptionTime.js";

const PROJECTION_FIELDS = ["proUntil", "proPlanId", "proActivatedAt", "proDailyDownloadLimit", "subscriptionManaged", "subscriptionCurrentPeriod", "subscriptionNextTransitionAt"];
const querySession = (query, session) => session ? query.session(session) : query;
const time = (value) => new Date(value).getTime();

export function periodSnapshot(period, at = new Date()) {
  if (!period) return null;
  return {
    id: String(period._id), orderId: period.orderId ? String(period.orderId) : null,
    planId: period.planId ? String(period.planId) : null, planName: period.planName,
    planCode: period.planCode, billingPeriod: period.billingPeriod,
    durationDays: period.durationDays, dailyDownloadLimit: period.dailyDownloadLimit,
    startsAt: period.startsAt, endsAt: period.endsAt,
    status: time(period.startsAt) > time(at) ? "scheduled" : time(period.endsAt) > time(at) ? "active" : "expired",
  };
}

async function validPeriods(userId, session = null) {
  return querySession(SubscriptionPeriod.find({ userId, status: "valid" }).sort({ startsAt: 1, _id: 1 }).lean(), session);
}

export async function ensureSubscriptionBaseline(user, { at = new Date(), session = null } = {}) {
  if (user.subscriptionManaged) return user;
  if (user.proUntil && time(user.proUntil) > time(at)) {
    await SubscriptionPeriod.findOneAndUpdate({ sourceKey: `legacy:${user._id}` }, { $setOnInsert: {
      userId: user._id, sourceKey: `legacy:${user._id}`, planId: user.proPlanId?._id || user.proPlanId,
      planName: "Existing subscription", planCode: "LEGACY", billingPeriod: "month",
      dailyDownloadLimit: Number(user.proDailyDownloadLimit || 100),
      durationDays: Math.max(1, Math.ceil((time(user.proUntil) - time(at)) / DAY_MS)),
      startsAt: user.proActivatedAt && time(user.proActivatedAt) <= time(at) ? user.proActivatedAt : at,
      endsAt: new Date(time(user.proUntil) + 1), status: "valid",
    } }, { upsert: true, new: true, session });
  }
  return User.findByIdAndUpdate(user._id, { $set: { subscriptionManaged: true } }, { new: true, session });
}

async function projectSchedule(userId, at, session = null) {
  const periods = await validPeriods(userId, session);
  const current = periods.find((period) => time(period.startsAt) <= time(at) && time(period.endsAt) > time(at));
  const future = periods.filter((period) => time(period.startsAt) > time(at));
  // Only continuous coverage is exposed through the legacy proUntil field.
  let end = current ? time(current.endsAt) : null;
  if (end !== null) {
    for (const period of future) {
      if (time(period.startsAt) > end) break;
      end = Math.max(end, time(period.endsAt));
    }
  }
  const next = current?.endsAt || future[0]?.startsAt || null;
  return User.findByIdAndUpdate(userId, { $set: {
    subscriptionManaged: true, subscriptionCurrentPeriod: periodSnapshot(current, at),
    subscriptionNextTransitionAt: next,
    proUntil: end === null ? null : new Date(end - 1),
    proPlanId: current?.planId || null, proActivatedAt: current?.startsAt || null,
    proDailyDownloadLimit: current ? Number(current.dailyDownloadLimit) : 100,
  } }, { new: true, session });
}

// Atlas transactions are mandatory in production. Memory fixtures compensate
// only the schedule projection, never overwrite credit or unrelated user data.
async function scheduleMutation(userId, fn, { session = null, alreadyLocked = false } = {}) {
  if (session) return fn(session);
  if (isMemoryDb()) {
    const run = async () => {
      const beforeUser = await User.findById(userId);
      const beforePeriods = await SubscriptionPeriod.find({ userId }).lean();
      try { return await fn(null); } catch (error) {
        await SubscriptionPeriod.deleteMany({ userId });
        await SubscriptionPeriod.insertMany(beforePeriods);
        const $set = {}, $unset = {};
        for (const key of PROJECTION_FIELDS) {
          if (beforeUser?.[key] === undefined) $unset[key] = "";
          else $set[key] = beforeUser[key];
        }
        await User.findByIdAndUpdate(userId, { $set, $unset });
        throw error;
      }
    };
    return alreadyLocked ? run() : serializeMemoryPayments(run);
  }
  await preparePaymentBenefitGuard(userId);
  const transaction = await mongoose.startSession();
  let result;
  try {
    await transaction.withTransaction(async () => {
      await lockPaymentBenefits(userId, transaction);
      result = await fn(transaction);
    });
    return result;
  } finally { await transaction.endSession(); }
}

export async function activateSubscriptionOrder(order, user, { session = null, at = new Date() } = {}) {
  return scheduleMutation(user._id, async (transaction) => {
    const baseline = await ensureSubscriptionBaseline(user, { at, session: transaction });
    const periods = await validPeriods(user._id, transaction);
    const lastEnd = periods.reduce((latest, period) => Math.max(latest, time(period.endsAt)), time(at));
    const startsAt = new Date(billingPeriodFor(order) === "day" ? time(at) : lastEnd);
    const endsAt = billingPeriodFor(order) === "day" ? nextVietnamReset(at) : subscriptionEnd(startsAt, Number(order.durationDays));
    const period = await SubscriptionPeriod.findOneAndUpdate({ sourceKey: `order:${order._id}` }, { $setOnInsert: {
      sourceKey: `order:${order._id}`, userId: user._id, orderId: order._id,
      planId: order.planId, planCode: order.planCode, planName: order.planName,
      billingPeriod: billingPeriodFor(order), dailyDownloadLimit: Number(order.dailyDownloadLimit || 100),
      durationDays: Number(order.durationDays), startsAt, endsAt, status: "valid",
    } }, { upsert: true, new: true, session: transaction });
    const updatedOrder = await MembershipOrder.findByIdAndUpdate(order._id, { $set: {
      activatedFrom: period.startsAt, activatedUntil: new Date(time(period.endsAt) - 1),
      subscriptionQueued: time(period.startsAt) > time(at), subscriptionPeriodId: period._id,
    } }, { new: true, session: transaction });
    const updatedUser = await projectSchedule(baseline._id, at, transaction);
    if (!updatedUser || !updatedOrder) throw new Error("Subscription activation lost its user or order");
    return { order: updatedOrder, user: updatedUser };
  }, { session, alreadyLocked: true });
}

export async function refreshSubscriptionUser(user, { at = new Date(), force = false } = {}) {
  if (!user?.subscriptionManaged) return user;
  if (!force && (!user.subscriptionNextTransitionAt || time(user.subscriptionNextTransitionAt) > time(at))) return user;
  const result = await scheduleMutation(user._id, async (session) => projectSchedule(user._id, at, session));
  if (String(result?.subscriptionCurrentPeriod?.id || "") !== String(user.subscriptionCurrentPeriod?.id || "")) {
    publishAccountInvalidation(user._id, "subscription_period_changed");
  }
  return result;
}

export async function refreshSubscriptionInTransaction(user, { at = new Date(), session = null } = {}) {
  if (!user?.subscriptionManaged || !user.subscriptionNextTransitionAt || time(user.subscriptionNextTransitionAt) > time(at)) return user;
  return projectSchedule(user._id, at, session);
}

export async function grantReferralSubscription(user, { at = new Date(), session = null, sourceKey, dailyDownloadLimit = 100 } = {}) {
  if (!Number.isSafeInteger(dailyDownloadLimit) || dailyDownloadLimit < 1 || dailyDownloadLimit > 100000) {
    throw new Error("Invalid referral download quota");
  }
  return scheduleMutation(user._id, async (transaction) => {
    user = await refreshSubscriptionInTransaction(user, { at, session: transaction });
    if (user.proUntil && time(user.proUntil) > time(at)) return user;
    await ensureSubscriptionBaseline(user, { at, session: transaction });
    await SubscriptionPeriod.findOneAndUpdate({ sourceKey }, { $setOnInsert: {
      sourceKey, userId: user._id, planCode: "REFERRAL", planName: "Referral reward",
      billingPeriod: "day", durationDays: 1, dailyDownloadLimit,
      startsAt: at, endsAt: nextVietnamReset(at), status: "valid",
    } }, { new: true, upsert: true, session: transaction });
    return projectSchedule(user._id, at, transaction);
  }, { session, alreadyLocked: true });
}

export async function subscriptionDetails(user, { at = new Date() } = {}) {
  const refreshed = await refreshSubscriptionUser(user, { at });
  const periods = refreshed?.subscriptionManaged ? await validPeriods(refreshed._id) : [];
  return { user: refreshed, currentPeriod: refreshed?.subscriptionCurrentPeriod || null,
    upcomingPeriods: periods.filter((period) => time(period.startsAt) > time(at)).map((period) => periodSnapshot(period, at)) };
}

export async function adjustSubscription(userId, changes, { at = new Date() } = {}) {
  const result = await scheduleMutation(userId, async (session) => {
    let user = await querySession(User.findById(userId), session);
    if (!user) throw Object.assign(new Error("User not found"), { status: 404 });
    user = await ensureSubscriptionBaseline(user, { at, session });
    if (changes.clearPro) {
      await SubscriptionPeriod.updateMany({ userId, status: "valid", endsAt: { $gt: at } }, { $set: { status: "cancelled", cancelledAt: at } }, { session });
    } else {
      const quota = changes.proDailyDownloadLimit === undefined ? Number(user.proDailyDownloadLimit || 100) : Number(changes.proDailyDownloadLimit);
      if (!Number.isSafeInteger(quota) || quota < 1 || quota > 100000) throw Object.assign(new Error("Invalid subscription quota"), { status: 400 });
      const periods = await validPeriods(userId, session);
      const current = periods.find((period) => time(period.startsAt) <= time(at) && time(period.endsAt) > time(at));
      const until = changes.proUntil === undefined ? (current ? new Date(time(current.endsAt) - 1) : null) : normalizeProUntil(changes.proUntil);
      if (!until || until <= at) throw Object.assign(new Error("Subscription expiry must be in the future; use clearPro to cancel"), { status: 400 });
      const endsAt = new Date(time(until) + 1);
      if (current) {
        await SubscriptionPeriod.findByIdAndUpdate(current._id, { $set: { endsAt, dailyDownloadLimit: quota, adjustedAt: at } }, { session });
        let nextStart = endsAt;
        for (const period of periods.filter((entry) => time(entry.startsAt) >= time(current.endsAt))) {
          const nextEnd = subscriptionEnd(nextStart, Number(period.durationDays));
          await SubscriptionPeriod.findByIdAndUpdate(period._id, { $set: {
            startsAt: nextStart, endsAt: nextEnd, adjustedAt: at,
          } }, { session });
          nextStart = nextEnd;
        }
      } else {
        const data = { userId, sourceKey: `admin:${crypto.randomUUID()}`, planName: "Subscription", planCode: "ADMIN",
          billingPeriod: "month", durationDays: Math.max(1, Math.ceil((time(endsAt) - time(at)) / DAY_MS)),
          dailyDownloadLimit: quota, startsAt: at, endsAt, status: "valid" };
        if (session) await SubscriptionPeriod.create([data], { session });
        else await SubscriptionPeriod.create(data);
      }
    }
    return projectSchedule(userId, at, session);
  });
  publishAccountInvalidation(userId, "subscription_adjusted");
  return result;
}

export async function migrateSubscriptionUser(userId, { at = new Date() } = {}) {
  return scheduleMutation(userId, async (session) => {
    const user = await querySession(User.findById(userId), session);
    if (!user || user.subscriptionManaged) return user;
    await ensureSubscriptionBaseline(user, { at, session });
    return projectSchedule(userId, at, session);
  });
}
