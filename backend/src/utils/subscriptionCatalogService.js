import mongoose from "mongoose";
import MembershipPlan from "../models/MembershipPlan.js";
import SiteSetting from "../models/SiteSetting.js";
import { isMemoryDb } from "../config/memoryStore.js";
import { serializeMemoryPayments } from "./paymentBenefitService.js";
import { paymentError } from "./paymentMoney.js";

export const SUBSCRIPTION_CATALOG_VERSION = 2;
export const SUBSCRIPTION_PERIOD_DEFAULTS = Object.freeze({ day: 1, month: 30, year: 365 });
const CATALOG_KEY = "homepage";
const PERIOD_NAMES = { day: "Day", month: "Month", year: "Year" };

export const INITIAL_SUBSCRIPTION_PLANS = Object.freeze(
  Object.entries(SUBSCRIPTION_PERIOD_DEFAULTS).flatMap(([billingPeriod, durationDays], periodIndex) =>
    [20, 50, 100].map((dailyDownloadLimit, quotaIndex) => ({
      code: `SUB_${billingPeriod.toUpperCase()}_${dailyDownloadLimit}`,
      name: `${PERIOD_NAMES[billingPeriod]} ${dailyDownloadLimit}`,
      billingPeriod,
      catalogVersion: SUBSCRIPTION_CATALOG_VERSION,
      catalogRetired: false,
      durationDays,
      dailyDownloadLimit,
      price: null,
      paypalPriceCents: null,
      isActive: false,
      expiresEndOfDay: true,
      tier: "member",
      maxPurchasesPerUser: 0,
      sortOrder: (periodIndex * 3 + quotaIndex + 1) * 10,
      badge: "",
      features: [],
    })),
  ),
);

function querySession(query, session) {
  return session ? query.session(session) : query;
}

export function subscriptionBillingPeriod(plan) {
  if (Object.hasOwn(SUBSCRIPTION_PERIOD_DEFAULTS, plan?.billingPeriod)) {
    return plan.billingPeriod;
  }
  if (Number(plan?.durationDays) <= 1) return "day";
  if (Number(plan?.durationDays) >= 365) return "year";
  return "month";
}

export async function getSubscriptionCatalog(session = null) {
  const settings = await querySession(SiteSetting.findOne({ key: CATALOG_KEY }), session).lean();
  const preparedCount = await querySession(MembershipPlan.countDocuments({
    code: { $in: INITIAL_SUBSCRIPTION_PLANS.map((plan) => plan.code) },
  }), session);
  return {
    mode: "unified",
    version: Number(settings?.subscriptionCatalogVersion) === SUBSCRIPTION_CATALOG_VERSION ? SUBSCRIPTION_CATALOG_VERSION : 1,
    prepared: preparedCount === INITIAL_SUBSCRIPTION_PLANS.length,
    checkoutEnabled: settings?.subscriptionCheckoutEnabled !== false,
    revision: Number(settings?.subscriptionCatalogRevision || 0),
    activatedAt: settings?.subscriptionCatalogActivatedAt || null,
  };
}

export function subscriptionPlanQuery() {
  return { isActive: true, isArchived: { $ne: true }, price: { $ne: null } };
}

async function ensureCatalogSettings() {
  try {
    await SiteSetting.findOneAndUpdate(
      { key: CATALOG_KEY },
      { $setOnInsert: { subscriptionCatalogVersion: 1, subscriptionCheckoutEnabled: true, subscriptionCatalogRevision: 0 } },
      { upsert: true, new: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

// Catalog and plan writes share one Core document so checkout/edit races retry atomically.
export async function lockSubscriptionCatalog(session) {
  if (!session) return;
  await SiteSetting.findOneAndUpdate(
    { key: CATALOG_KEY }, { $inc: { subscriptionCatalogRevision: 1 } }, { session },
  );
}

export async function withSubscriptionCatalogWrite(fn) {
  if (isMemoryDb()) {
    return serializeMemoryPayments(async () => {
      await ensureCatalogSettings();
      return fn(null);
    });
  }
  await ensureCatalogSettings();
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      await lockSubscriptionCatalog(session);
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export function assertSubscriptionPlanFields(plan) {
  for (const field of ["durationDays", "dailyDownloadLimit"]) {
    if (!Number.isSafeInteger(plan[field]) || plan[field] < 1) {
      throw paymentError(`${field} must be a positive integer`, "INVALID_SUBSCRIPTION_PLAN", 400);
    }
  }
  if (!Object.hasOwn(SUBSCRIPTION_PERIOD_DEFAULTS, plan.billingPeriod)) {
    throw paymentError("Invalid billing period", "INVALID_SUBSCRIPTION_PLAN", 400);
  }
  if (plan.price != null && (!Number.isSafeInteger(plan.price) || plan.price < 0)) {
    throw paymentError("VND price must be a non-negative integer", "INVALID_SUBSCRIPTION_PRICE", 400);
  }
  if (plan.isActive && plan.price == null) {
    throw paymentError("Configure a VND price before enabling the plan", "SUBSCRIPTION_PRICE_REQUIRED", 400);
  }
}

export function assertPlanCatalogWrite(plan) {
  assertSubscriptionPlanFields(plan);
}

export async function prepareSubscriptionCatalog() {
  return withSubscriptionCatalogWrite(async (session) => {
    for (const defaults of INITIAL_SUBSCRIPTION_PLANS) {
      await MembershipPlan.findOneAndUpdate(
        { code: defaults.code }, { $setOnInsert: defaults }, { upsert: true, new: true, session },
      );
    }
    return getSubscriptionCatalog(session);
  });
}

export async function activateSubscriptionCatalog() {
  // Older admin clients may still call this endpoint; never retire other plans.
  return withSubscriptionCatalogWrite((session) => getSubscriptionCatalog(session));
}

export async function setSubscriptionCheckoutEnabled(enabled) {
  if (typeof enabled !== "boolean") {
    throw paymentError("enabled must be a boolean", "INVALID_SUBSCRIPTION_CHECKOUT", 400);
  }
  return withSubscriptionCatalogWrite(async (session) => {
    await SiteSetting.findOneAndUpdate(
      { key: CATALOG_KEY }, { $set: { subscriptionCheckoutEnabled: enabled } }, { session },
    );
    return getSubscriptionCatalog(session);
  });
}
