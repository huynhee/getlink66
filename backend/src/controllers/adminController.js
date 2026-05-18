import Cookie from "../models/Cookie.js";
import User from "../models/User.js";
import Voucher from "../models/Voucher.js";
import Topup from "../models/Topup.js";
import TopupPackage from "../models/TopupPackage.js";
import Getlink from "../models/Getlink.js";
import ProductCache from "../models/ProductCache.js";
import SystemLog from "../models/SystemLog.js";
import { addCredit } from "../utils/creditService.js";
import { approvePendingTopup } from "../utils/topupApprovalService.js";
import { validate3D66Cookie } from "../utils/3d66Service.js";
import { get3D66CookiePoolStatus } from "../utils/3d66CookiePool.js";
import { decryptSecret, encryptSecret } from "../utils/secretBox.js";
import { notifyTopupRejected } from "../utils/telegramNotifier.js";
import {
  integerInRange,
  isSafeId,
  isVoucherCode,
  limitedString,
  normalizeVoucherCode,
  numberInRange,
  rejectUnknownKeys,
} from "../utils/validators.js";

const MAX_MANUAL_CREDIT = Number(process.env.MAX_MANUAL_CREDIT || 1000000);
const MAX_STORED_CREDIT = Number(process.env.MAX_STORED_CREDIT || 10000000);
const MAX_VOUCHER_DISCOUNT_PERCENT = Number(
  process.env.MAX_VOUCHER_DISCOUNT_PERCENT || 90,
);

function normalizePackagePayload(body = {}) {
  const normalizedFeatures = Array.isArray(body.features)
    ? body.features
    : String(body.features || "")
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);

  return {
    name: body.name || "GÓI CREDIT",
    price: Number(body.price),
    credit: Number(body.credit),
    salePercent: Number(body.salePercent) || 0,
    badge: body.badge || "",
    features: normalizedFeatures,
    isActive: body.isActive !== false,
  };
}

function hardenPackagePayload(payload) {
  payload.name = limitedString(payload.name || "GOI CREDIT", 80, "GOI CREDIT");
  payload.badge = limitedString(payload.badge || "", 24);
  payload.features = Array.isArray(payload.features)
    ? payload.features
        .slice(0, 12)
        .map((item) => limitedString(item, 120))
        .filter(Boolean)
    : [];
  return payload;
}

function validatePackagePayload(payload) {
  if (
    !Number.isInteger(payload.price) ||
    payload.price < 1000 ||
    payload.price > 100000000
  ) {
    return "Valid package price is required";
  }
  if (
    !Number.isInteger(payload.credit) ||
    payload.credit <= 0 ||
    payload.credit > MAX_STORED_CREDIT
  ) {
    return "Valid package credit is required";
  }
  if (
    !Number.isFinite(payload.salePercent) ||
    payload.salePercent < 0 ||
    payload.salePercent > MAX_VOUCHER_DISCOUNT_PERCENT
  ) {
    return "Sale percent is too high";
  }
  return "";
}

function sortPackages(packages = []) {
  return [...packages].sort((a, b) => {
    const aOrder = Number.isFinite(Number(a.sortOrder))
      ? Number(a.sortOrder)
      : Number.MAX_SAFE_INTEGER;
    const bOrder = Number.isFinite(Number(b.sortOrder))
      ? Number(b.sortOrder)
      : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return Number(a.price || 0) - Number(b.price || 0);
  });
}

function cookieKeys(value = "") {
  return new Set(
    String(value)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.slice(0, part.indexOf("=")).trim())
      .filter(Boolean),
  );
}

function summarizeCookie(cookie) {
  const decryptedValue = decryptSecret(cookie?.value || "");
  const keys = cookieKeys(decryptedValue);
  const requiredKeys = ["PHPSESSID", "login_token", "login_sign"];
  const missingKeys = requiredKeys.filter((key) => !keys.has(key));
  const value = String(decryptedValue || "");
  const preview =
    value.length > 36 ? `${value.slice(0, 18)}...${value.slice(-12)}` : value;

  return {
    _id: cookie._id,
    label: cookie.label || "",
    isActive: cookie.isActive !== false,
    status: cookie.status || "active",
    failureCount: Number(cookie.failureCount || 0),
    useCount: Number(cookie.useCount || 0),
    cooldownUntil: cookie.cooldownUntil,
    lastUsedAt: cookie.lastUsedAt,
    lastErrorAt: cookie.lastErrorAt,
    lastErrorMessage: cookie.lastErrorMessage,
    preview,
    keyCount: keys.size,
    hasRequiredKeys: missingKeys.length === 0,
    missingKeys,
    lastTestAt: cookie.lastTestAt,
    lastTestOk: cookie.lastTestOk,
    lastTestMessage: cookie.lastTestMessage,
    createdAt: cookie.createdAt,
    updatedAt: cookie.updatedAt,
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function chartKey(date, period) {
  if (period === "year") return String(date.getFullYear());
  if (period === "month")
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function buildRevenueChart(approvedTopups, period = "day") {
  const now = new Date();
  const config = {
    day: {
      length: 14,
      label: (date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`,
    },
    month: {
      length: 12,
      label: (date) => `${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
    },
    year: { length: 5, label: (date) => String(date.getFullYear()) },
  }[period] || {
    length: 14,
    label: (date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`,
  };

  const revenueChart = Array.from({ length: config.length }, (_, index) => {
    let date;
    if (period === "year") {
      date = new Date(now.getFullYear() - (config.length - 1 - index), 0, 1);
    } else if (period === "month") {
      date = new Date(
        now.getFullYear(),
        now.getMonth() - (config.length - 1 - index),
        1,
      );
    } else {
      date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(now.getDate() - (config.length - 1 - index));
    }

    return {
      date: chartKey(date, period),
      label: config.label(date),
      revenue: 0,
      count: 0,
    };
  });

  const revenueBucket = new Map(revenueChart.map((item) => [item.date, item]));
  approvedTopups.forEach((topup) => {
    const topupDate = new Date(
      topup.paidAt || topup.updatedAt || topup.createdAt || now,
    );
    const bucket = revenueBucket.get(chartKey(topupDate, period));
    if (!bucket) return;
    bucket.revenue += Number(topup.amount || 0);
    bucket.count += 1;
  });

  return revenueChart;
}

export async function listUsers(_req, res, next) {
  try {
    const users = await User.find().sort({ createdAt: -1 }).limit(200);
    res.json({ users });
  } catch (error) {
    next(error);
  }
}

export async function getOverview(req, res, next) {
  try {
    const requestedPeriod = String(req.query.period || "day");
    const revenuePeriod = ["day", "month", "year"].includes(requestedPeriod)
      ? requestedPeriod
      : "day";
    const [users, packages, vouchers, topups, getlinks, caches] =
      await Promise.all([
        User.find(),
        TopupPackage.find(),
        Voucher.find(),
        Topup.find(),
        Getlink.find(),
        ProductCache.find(),
      ]);

    const approvedTopups = topups.filter(
      (topup) => topup.status === "approved",
    );
    const pendingTopups = topups.filter((topup) => topup.status === "pending");
    const now = new Date();
    const revenueChart = buildRevenueChart(approvedTopups, revenuePeriod);
    const activeVouchers = vouchers.filter((voucher) => {
      const expiresAt = voucher.expireAt ? new Date(voucher.expireAt) : null;
      return (
        expiresAt &&
        expiresAt > now &&
        Number(voucher.usedCount || 0) < Number(voucher.usageLimit || 0)
      );
    });

    res.json({
      overview: {
        totalUsers: users.length,
        totalCredit: users.reduce(
          (sum, user) => sum + Number(user.credit || 0),
          0,
        ),
        activePackages: packages.filter((pack) => pack.isActive !== false)
          .length,
        activeVouchers: activeVouchers.length,
        pendingTopups: pendingTopups.length,
        pendingAmount: pendingTopups.reduce(
          (sum, topup) => sum + Number(topup.amount || 0),
          0,
        ),
        approvedTopups: approvedTopups.length,
        revenue: approvedTopups.reduce(
          (sum, topup) => sum + Number(topup.amount || 0),
          0,
        ),
        revenuePeriod,
        revenueChart,
        totalGetlinks: getlinks.length,
        cachedProducts: caches.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminAddCredit(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["userId", "credit"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid credit request" });
    }

    const { userId, credit } = req.body;
    const amount = Number(credit);
    if (
      !isSafeId(userId) ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      amount > MAX_MANUAL_CREDIT
    ) {
      return res
        .status(400)
        .json({ message: "Valid userId and credit amount are required" });
    }

    // Atomic check: chi tang credit neu sau khi tang khong vuot MAX_STORED_CREDIT.
    // Tranh race khi 2 admin add credit cung luc lam vuot gioi han.
    const user = await User.findOneAndUpdate(
      { _id: userId, credit: { $lte: MAX_STORED_CREDIT - amount } },
      { $inc: { credit: amount } },
      { new: true },
    );
    if (!user) {
      const exists = await User.findById(userId);
      if (!exists) {
        return res.status(404).json({ message: "User not found" });
      }
      return res.status(400).json({
        message: `Tong credit sau khi cong se vuot gioi han ${MAX_STORED_CREDIT.toLocaleString("en-US")}.`,
        currentCredit: exists.credit,
        maxStored: MAX_STORED_CREDIT,
      });
    }

    let topup = null;
    if (amount > 0) {
      topup = await Topup.create({
        userId,
        amount: 0,
        credit: amount,
        type: "manual",
        status: "approved",
        paidAt: new Date(),
      });
    }
    res.json({ user, topup });
  } catch (error) {
    next(error);
  }
}

export async function adminSetCredit(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["userId", "credit"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid credit request" });
    }

    const { userId, credit } = req.body;
    const amount = Number(credit);
    if (
      !isSafeId(userId) ||
      !Number.isInteger(amount) ||
      amount < 0 ||
      amount > MAX_STORED_CREDIT
    ) {
      return res
        .status(400)
        .json({ message: "Valid userId and non-negative credit are required" });
    }
    const user = await User.findByIdAndUpdate(
      userId,
      { credit: amount },
      { new: true },
    );
    res.json({ user });
  } catch (error) {
    next(error);
  }
}

export async function saveCookie(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["value", "label"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid cookie request" });
    }

    const value = String(req.body.value || "").trim();
    const label = limitedString(req.body.label || "", 80);
    if (!value) {
      return res.status(400).json({ message: "Cookie value is required" });
    }

    const cookie = await Cookie.create({
      value: encryptSecret(value),
      label,
      isActive: true,
      status: "active",
    });
    res.json({ cookie: summarizeCookie(cookie) });
  } catch (error) {
    next(error);
  }
}

export async function listCookies(_req, res, next) {
  try {
    const cookies = await Cookie.find()
      .sort({ isActive: -1, status: 1, updatedAt: -1 })
      .limit(50);
    res.json({ cookies: cookies.map(summarizeCookie) });
  } catch (error) {
    next(error);
  }
}

export async function cookiePoolStatus(_req, res, next) {
  try {
    const pool = await get3D66CookiePoolStatus();
    res.json({ pool });
  } catch (error) {
    next(error);
  }
}

export async function listSystemLogs(req, res, next) {
  try {
    const type = String(req.query.type || "").trim();
    const query = ["getlink", "download", "cookie", "payment", "security", "system"].includes(type)
      ? { type }
      : {};
    const logs = await SystemLog.find(query).sort({ createdAt: -1 }).limit(100);
    res.json({ logs });
  } catch (error) {
    next(error);
  }
}

export async function deleteCookie(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid cookie id" });
    }
    await Cookie.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function testCookie(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["value", "url", "id"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid cookie test request" });
    }

    const value = String(req.body.value || "").trim();
    const modelUrl = String(req.body.url || "").trim();
    const cookie = value
      ? { value }
      : await Cookie.findOne().sort({ updatedAt: -1 });
    const cookieValue = decryptSecret(cookie?.value || "");
    if (!cookieValue) {
      return res.status(400).json({ message: "Cookie value is required" });
    }

    const result = await validate3D66Cookie(cookieValue, modelUrl);
    if (cookie._id) {
      await Cookie.findByIdAndUpdate(cookie._id, {
        lastTestAt: new Date(),
        lastTestOk: true,
        lastTestMessage: "Cookie hợp lệ",
        status: "active",
        isActive: true,
        failureCount: 0,
        cooldownUntil: null,
        lastErrorMessage: "",
      });
    }
    res.json(result);
  } catch (error) {
    if (req.body?.id && isSafeId(req.body.id)) {
      await Cookie.findByIdAndUpdate(req.body.id, {
        lastTestAt: new Date(),
        lastTestOk: false,
        lastTestMessage: error.message,
        status: "warning",
        lastErrorAt: new Date(),
        lastErrorMessage: error.message,
      }).catch(() => {});
    }
    next(error);
  }
}

export async function testSavedCookie(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid cookie id" });
    }
    const unknownKey = rejectUnknownKeys(req.body || {}, ["url"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid cookie test request" });
    }

    const cookie = await Cookie.findById(req.params.id);
    if (!cookie?.value) {
      return res.status(404).json({ message: "Cookie not found" });
    }

    const modelUrl = String(req.body?.url || "").trim();
    const result = await validate3D66Cookie(
      decryptSecret(cookie.value),
      modelUrl,
    );
    const updated = await Cookie.findByIdAndUpdate(
      cookie._id,
      {
        lastTestAt: new Date(),
        lastTestOk: true,
        lastTestMessage: "Cookie hợp lệ",
        status: "active",
        isActive: true,
        failureCount: 0,
        cooldownUntil: null,
        lastErrorMessage: "",
      },
      { new: true },
    );
    res.json({ ...result, cookie: summarizeCookie(updated || cookie) });
  } catch (error) {
    await Cookie.findByIdAndUpdate(req.params.id, {
      lastTestAt: new Date(),
      lastTestOk: false,
      lastTestMessage: error.message,
      status: "warning",
      lastErrorAt: new Date(),
      lastErrorMessage: error.message,
    }).catch(() => {});
    next(error);
  }
}

export async function createVoucher(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, [
      "code",
      "creditBonus",
      "discountPercent",
      "usageLimit",
      "perUserLimit",
      "applicablePackageIds",
      "expireAt",
      "description",
    ]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid voucher request" });
    }

    const {
      code,
      creditBonus = 0,
      discountPercent = 0,
      usageLimit,
      perUserLimit,
      applicablePackageIds = [],
      expireAt,
      description = "",
    } = req.body;
    const normalizedCode = normalizeVoucherCode(code);
    const bonus = integerInRange(creditBonus, 0, MAX_STORED_CREDIT);
    const discount = numberInRange(
      discountPercent,
      0,
      MAX_VOUCHER_DISCOUNT_PERCENT,
    );
    const limit = integerInRange(usageLimit, 1, 100000);
    const rawAccountLimit = perUserLimit === undefined || perUserLimit === null || perUserLimit === ""
      ? limit
      : perUserLimit;
    const accountLimit = integerInRange(rawAccountLimit, 0, 100000);
    const packageIds = Array.isArray(applicablePackageIds)
      ? applicablePackageIds.filter(Boolean)
      : [];
    if (packageIds.length > 100 || packageIds.some((id) => !isSafeId(id))) {
      return res.status(400).json({ message: "Invalid voucher package list" });
    }
    const expiresAt = new Date(expireAt);
    if (
      !isVoucherCode(normalizedCode) ||
      bonus === null ||
      discount === null ||
      limit === null ||
      accountLimit === null ||
      Number.isNaN(expiresAt.valueOf()) ||
      expiresAt <= new Date()
    ) {
      return res.status(400).json({ message: "Invalid voucher data" });
    }
    if (bonus <= 0 && discount <= 0) {
      return res
        .status(400)
        .json({ message: "Voucher must add credit or discount percent" });
    }
    const voucher = await Voucher.create({
      code: normalizedCode,
      creditBonus: bonus,
      discountPercent: discount,
      usageLimit: limit,
      perUserLimit: accountLimit,
      applicablePackageIds: packageIds,
      expireAt: expiresAt,
      description: limitedString(description, 500),
    });
    res.json({ voucher });
  } catch (error) {
    next(error);
  }
}

export async function listVouchers(_req, res, next) {
  try {
    const vouchers = await Voucher.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .populate("applicablePackageIds", "name price");
    res.json({ vouchers });
  } catch (error) {
    next(error);
  }
}

export async function deleteVoucher(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid voucher id" });
    }
    await Voucher.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function listTopupPackages(req, res, next) {
  try {
    const packages = await TopupPackage.find();
    res.json({ packages: sortPackages(packages) });
  } catch (error) {
    next(error);
  }
}

export async function createTopupPackage(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, [
      "name",
      "price",
      "credit",
      "salePercent",
      "badge",
      "features",
      "isActive",
    ]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid package request" });
    }

    const payload = hardenPackagePayload(normalizePackagePayload(req.body));
    const validationError = validatePackagePayload(payload);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }
    const packages = await TopupPackage.find();
    const maxOrder = packages.reduce(
      (max, pack) => Math.max(max, Number(pack.sortOrder || 0)),
      0,
    );
    const pack = await TopupPackage.create({
      ...payload,
      sortOrder: maxOrder + 10,
    });
    res.json({ package: pack });
  } catch (error) {
    next(error);
  }
}

export async function updateTopupPackage(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, [
      "name",
      "price",
      "credit",
      "salePercent",
      "badge",
      "features",
      "isActive",
    ]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid package request" });
    }
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid package id" });
    }

    const payload = hardenPackagePayload(normalizePackagePayload(req.body));
    const validationError = validatePackagePayload(payload);
    if (validationError) {
      return res.status(400).json({ message: validationError });
    }

    const pack = await TopupPackage.findByIdAndUpdate(req.params.id, payload, {
      new: true,
    });
    if (!pack) {
      return res.status(404).json({ message: "Topup package not found" });
    }
    res.json({ package: pack });
  } catch (error) {
    next(error);
  }
}

export async function reorderTopupPackages(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["orderedIds"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid reorder request" });
    }

    const orderedIds = Array.isArray(req.body.orderedIds)
      ? req.body.orderedIds
      : [];
    if (
      !orderedIds.length ||
      orderedIds.length > 100 ||
      orderedIds.some((id) => !isSafeId(id))
    ) {
      return res.status(400).json({ message: "orderedIds is required" });
    }

    await Promise.all(
      orderedIds.map((id, index) =>
        TopupPackage.findByIdAndUpdate(id, { sortOrder: (index + 1) * 10 }),
      ),
    );

    const packages = await TopupPackage.find();
    res.json({ packages: sortPackages(packages) });
  } catch (error) {
    next(error);
  }
}

export async function deleteTopupPackage(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid package id" });
    }
    await TopupPackage.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function listPendingTopups(req, res, next) {
  try {
    const topups = await Topup.find({ status: "pending" })
      .populate("userId", "email name")
      .populate("packageId", "name")
      .sort({ createdAt: -1 });
    res.json({ topups });
  } catch (error) {
    next(error);
  }
}

export async function approveTopup(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid topup id" });
    }

    const topup = await Topup.findById(req.params.id);
    if (!topup || topup.status !== "pending") {
      return res
        .status(404)
        .json({ message: "Topup not found or not pending" });
    }

    const approved = await approvePendingTopup(topup);
    if (!approved) {
      return res.status(409).json({ message: "Topup was already handled" });
    }

    res.json({ topup: approved.topup, user: approved.user });
  } catch (error) {
    next(error);
  }
}

export async function rejectTopup(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid topup id" });
    }

    const topup = await Topup.findById(req.params.id);
    if (!topup || topup.status !== "pending") {
      return res
        .status(404)
        .json({ message: "Topup not found or not pending" });
    }
    await Topup.findByIdAndUpdate(req.params.id, { status: "rejected" });
    topup.status = "rejected";
    notifyTopupRejected({ topup, actor: req.user });
    res.json({ topup });
  } catch (error) {
    next(error);
  }
}
