import Cookie from "../models/Cookie.js";
import User from "../models/User.js";
import Voucher from "../models/Voucher.js";
import Topup from "../models/Topup.js";
import TopupPackage from "../models/TopupPackage.js";
import Getlink from "../models/Getlink.js";
import ProductCache from "../models/ProductCache.js";
import SystemLog from "../models/SystemLog.js";
import Referral from "../models/Referral.js";
import { isMemoryDb } from "../config/memoryStore.js";
import { grantManualCredit } from "../utils/manualCreditService.js";
import { validate3D66Cookie } from "../utils/3d66Service.js";
import { get3D66CookiePoolStatus } from "../utils/3d66CookiePool.js";
import { decryptSecret, encryptSecret } from "../utils/secretBox.js";
import {
  integerInRange,
  isSafeId,
  isVoucherCode,
  limitedString,
  normalizeVoucherCode,
  numberInRange,
  rejectUnknownKeys,
} from "../utils/validators.js";
import { expirePendingSepayTopups } from "../utils/topupExpiryService.js";

const MAX_MANUAL_CREDIT = Number(process.env.MAX_MANUAL_CREDIT || 1000000);
const MAX_STORED_CREDIT = Number(process.env.MAX_STORED_CREDIT || 10000000);
const MAX_VOUCHER_DISCOUNT_PERCENT = Number(
  process.env.MAX_VOUCHER_DISCOUNT_PERCENT || 90,
);
const ADMIN_USER_PAGE_SIZE = 10;
const ADMIN_GETLINK_PAGE_SIZE = 10;
const ADMIN_TOPUP_PAGE_SIZE = 10;

export function serializeAdminUser(user) {
  if (!user) return null;
  const doc = typeof user.toObject === "function" ? user.toObject() : user;
  return {
    _id: doc._id,
    email: doc.email || "",
    name: doc.name || "",
    avatar: doc.avatar || "",
    role: doc.role || "user",
    credit: Number(doc.credit || 0),
    referralCode: doc.referralCode || "",
    referredBy: doc.referredBy || null,
    referralRewardedAt: doc.referralRewardedAt || null,
    isTwoFactorEnabled: Boolean(doc.isTwoFactorEnabled),
    isBanned: Boolean(doc.isBanned),
    banReason: doc.banReason || "",
    bannedAt: doc.bannedAt || null,
    bannedBy: doc.bannedBy || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizedSearch(value = "") {
  return String(value || "").trim().toLowerCase().slice(0, 120);
}

function escapedRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "vi", {
    sensitivity: "base",
  });
}

function compareAdminUsers(a, b, sort = "created-desc") {
  if (sort === "created-asc") {
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  }
  if (sort === "credit-desc") return Number(b.credit || 0) - Number(a.credit || 0);
  if (sort === "credit-asc") return Number(a.credit || 0) - Number(b.credit || 0);
  if (sort === "email-asc") return compareText(a.email, b.email);
  if (sort === "email-desc") return compareText(b.email, a.email);
  return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
}

function adminUserSort(sort = "created-desc") {
  if (sort === "created-asc") return { createdAt: 1 };
  if (sort === "credit-desc") return { credit: -1 };
  if (sort === "credit-asc") return { credit: 1 };
  if (sort === "email-asc") return { email: 1 };
  if (sort === "email-desc") return { email: -1 };
  return { createdAt: -1 };
}

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
    salePrice:
      body.salePrice === "" || body.salePrice === undefined
        ? 0
        : Number(body.salePrice),
    maxTopupsPerUser:
      body.maxTopupsPerUser === "" || body.maxTopupsPerUser === undefined
        ? 0
        : Number(body.maxTopupsPerUser),
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
  if (
    !Number.isInteger(payload.salePrice) ||
    payload.salePrice < 0 ||
    payload.salePrice > payload.price
  ) {
    return "Valid sale price is required";
  }
  if (
    !Number.isInteger(payload.maxTopupsPerUser) ||
    payload.maxTopupsPerUser < 0 ||
    payload.maxTopupsPerUser > 100000
  ) {
    return "Valid per-user top-up limit is required";
  }
  return "";
}

function normalizeVoucherPayload(body = {}, currentVoucher = null) {
  const {
    code,
    creditBonus = 0,
    discountPercent = 0,
    usageLimit,
    perUserLimit,
    applicablePackageIds = [],
    expireAt,
    description = "",
  } = body;
  const normalizedCode = normalizeVoucherCode(code);
  const bonus = integerInRange(creditBonus, 0, MAX_STORED_CREDIT);
  const discount = numberInRange(
    discountPercent,
    0,
    MAX_VOUCHER_DISCOUNT_PERCENT,
  );
  const limit = integerInRange(usageLimit, 1, 100000);
  const rawAccountLimit =
    perUserLimit === undefined || perUserLimit === null || perUserLimit === ""
      ? limit
      : perUserLimit;
  const accountLimit = integerInRange(rawAccountLimit, 0, 100000);
  const packageIds = Array.isArray(applicablePackageIds)
    ? applicablePackageIds.filter(Boolean).map((id) => String(id?._id || id))
    : [];
  const expiresAt = new Date(expireAt);

  if (packageIds.length > 100 || packageIds.some((id) => !isSafeId(id))) {
    return { error: "Invalid voucher package list" };
  }

  if (
    !isVoucherCode(normalizedCode) ||
    bonus === null ||
    discount === null ||
    limit === null ||
    accountLimit === null ||
    Number.isNaN(expiresAt.valueOf()) ||
    expiresAt <= new Date()
  ) {
    return { error: "Invalid voucher data" };
  }

  if (bonus <= 0 && discount <= 0) {
    return { error: "Voucher must add credit or discount percent" };
  }

  if (currentVoucher && limit < Number(currentVoucher.usedCount || 0)) {
    return { error: "Usage limit cannot be lower than current used count" };
  }

  return {
    payload: {
      code: normalizedCode,
      creditBonus: bonus,
      discountPercent: discount,
      usageLimit: limit,
      perUserLimit: accountLimit,
      applicablePackageIds: packageIds,
      expireAt: expiresAt,
      description: limitedString(description, 500),
    },
  };
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
    preview: decryptedValue ? "[stored]" : "",
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

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function toVietnamShiftedDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  return new Date(date.getTime() + VIETNAM_OFFSET_MS);
}

function shiftedChartKey(date, period) {
  if (period === "year") return String(date.getUTCFullYear());
  if (period === "month")
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function shiftedChartLabel(date, period) {
  if (period === "year") return String(date.getUTCFullYear());
  if (period === "month")
    return `${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
  return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}`;
}

function vietnamChartKey(value, period = "day") {
  const shiftedDate = toVietnamShiftedDate(value);
  return shiftedDate ? shiftedChartKey(shiftedDate, period) : "";
}

function recentVietnamDayKeys(length = 7, now = new Date()) {
  const shiftedNow = toVietnamShiftedDate(now) || toVietnamShiftedDate(new Date());
  return Array.from({ length }, (_, index) => {
    const date = new Date(
      Date.UTC(
        shiftedNow.getUTCFullYear(),
        shiftedNow.getUTCMonth(),
        shiftedNow.getUTCDate() - (length - 1 - index),
      ),
    );
    return shiftedChartKey(date, "day");
  });
}

function buildRevenueChart(approvedTopups, period = "day") {
  const now = new Date();
  const config = {
    day: { length: 14 },
    month: { length: 12 },
    year: { length: 5 },
  }[period] || { length: 14 };
  const shiftedNow = toVietnamShiftedDate(now) || toVietnamShiftedDate(new Date());

  const revenueChart = Array.from({ length: config.length }, (_, index) => {
    let date;
    if (period === "year") {
      date = new Date(
        Date.UTC(shiftedNow.getUTCFullYear() - (config.length - 1 - index), 0, 1),
      );
    } else if (period === "month") {
      date = new Date(
        Date.UTC(
          shiftedNow.getUTCFullYear(),
          shiftedNow.getUTCMonth() - (config.length - 1 - index),
          1,
        ),
      );
    } else {
      date = new Date(
        Date.UTC(
          shiftedNow.getUTCFullYear(),
          shiftedNow.getUTCMonth(),
          shiftedNow.getUTCDate() - (config.length - 1 - index),
        ),
      );
    }

    return {
      date: shiftedChartKey(date, period),
      label: shiftedChartLabel(date, period),
      revenue: 0,
      count: 0,
    };
  });

  const revenueBucket = new Map(revenueChart.map((item) => [item.date, item]));
  approvedTopups.forEach((topup) => {
    const bucket = revenueBucket.get(
      vietnamChartKey(topup.paidAt || topup.updatedAt || topup.createdAt || now, period),
    );
    if (!bucket) return;
    bucket.revenue += Number(topup.amount || 0);
    bucket.count += 1;
  });

  return revenueChart;
}

export async function listUsers(req, res, next) {
  try {
    const search = normalizedSearch(req.query.search);
    const sort = String(req.query.sort || "created-desc");
    const requestedPage = Number(req.query.page || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
    if (!isMemoryDb()) {
      const regex = search ? new RegExp(escapedRegex(search), "i") : null;
      const query = regex
        ? { $or: [{ email: regex }, { name: regex }] }
        : {};
      const total = await User.countDocuments(query);
      const totalPages = Math.max(1, Math.ceil(total / ADMIN_USER_PAGE_SIZE));
      const safePage = Math.min(page, totalPages);
      const users = await User.find(query)
        .sort(adminUserSort(sort))
        .skip((safePage - 1) * ADMIN_USER_PAGE_SIZE)
        .limit(ADMIN_USER_PAGE_SIZE);
      return res.json({
        users: users.map(serializeAdminUser),
        pagination: {
          page: safePage,
          pageSize: ADMIN_USER_PAGE_SIZE,
          total,
          totalPages,
        },
      });
    }

    const allUsers = await User.find();
    const filteredUsers = allUsers
      .filter((user) => {
        if (!search) return true;
        return [user.email, user.name, user._id]
          .some((value) => String(value || "").toLowerCase().includes(search));
      })
      .sort((a, b) => compareAdminUsers(a, b, sort));
    const total = filteredUsers.length;
    const totalPages = Math.max(1, Math.ceil(total / ADMIN_USER_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * ADMIN_USER_PAGE_SIZE;
    const users = filteredUsers.slice(start, start + ADMIN_USER_PAGE_SIZE);

    res.json({
      users: users.map(serializeAdminUser),
      pagination: {
        page: safePage,
        pageSize: ADMIN_USER_PAGE_SIZE,
        total,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getUserCreditHistory(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const [topups, getlinks, referrals] = await Promise.all([
      Topup.find({ userId: user._id, status: "approved" })
        .sort({ createdAt: -1 })
        .limit(200)
        .populate("packageId", "name"),
      Getlink.find({ userId: user._id }).sort({ createdAt: -1 }).limit(200),
      Referral.find({
        status: "rewarded",
        $or: [{ referrerId: user._id }, { referredUserId: user._id }],
      })
        .sort({ createdAt: -1 })
        .limit(200)
        .populate("referrerId", "name email")
        .populate("referredUserId", "name email"),
    ]);

    const entries = [
      ...topups.map((item) => ({
        _id: `topup-${item._id}`,
        type: item.type === "manual" ? "admin-credit" : "topup",
        amount: Number(item.credit || 0),
        title:
          item.type === "manual"
            ? "Admin cộng credit"
            : `Nạp credit${item.packageId?.name ? ` - ${item.packageId.name}` : ""}`,
        detail: item.gatewayTransactionId || item.paymentCode || "",
        createdAt: item.paidAt || item.createdAt,
      })),
      ...getlinks.map((item) => ({
        _id: `getlink-${item._id}`,
        type: "getlink",
        amount: -Number(item.creditUsed || 0),
        title: `Getlink ${item.productId}`,
        detail: item.title || "",
        createdAt: item.createdAt,
      })),
      ...referrals.map((item) => {
        const isReferrer = String(item.referrerId?._id || item.referrerId) === String(user._id);
        const otherUser = isReferrer ? item.referredUserId : item.referrerId;
        const amount = isReferrer
          ? Number(item.referrerRewardCredit ?? item.rewardCredit ?? 0)
          : Number(item.referredRewardCredit ?? item.rewardCredit ?? 0);
        return {
          _id: `referral-${item._id}-${isReferrer ? "referrer" : "referred"}`,
          type: "referral",
          amount,
          title: isReferrer ? "Thưởng giới thiệu bạn bè" : "Thưởng đăng ký qua giới thiệu",
          detail: otherUser?.email || otherUser?.name || "",
          createdAt: item.rewardedAt || item.createdAt,
        };
      }),
    ]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 300);

    res.json({
      user: {
        _id: user._id,
        name: user.name || "",
        email: user.email || "",
        credit: Number(user.credit || 0),
      },
      history: entries,
    });
  } catch (error) {
    next(error);
  }
}

export async function banUser(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["reason"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid ban request" });
    }
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).json({ message: "You cannot ban yourself" });
    }

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ message: "User not found" });
    if (target.role === "admin") {
      return res.status(400).json({ message: "Cannot ban admin user" });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        isBanned: true,
        banReason: limitedString(
          req.body.reason || "Tai khoan cua ban da bi khoa.",
          500,
        ),
        bannedAt: new Date(),
        bannedBy: req.user._id,
      },
      { new: true },
    );
    res.json({ user: serializeAdminUser(user) });
  } catch (error) {
    next(error);
  }
}

export async function unbanUser(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        isBanned: false,
        banReason: "",
        bannedAt: null,
        bannedBy: null,
      },
      { new: true },
    );
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ user: serializeAdminUser(user) });
  } catch (error) {
    next(error);
  }
}

export async function listReferrals(_req, res, next) {
  try {
    const referrals = await Referral.find()
      .sort({ createdAt: -1 })
      .populate("referrerId", "name email avatar referralCode")
      .populate("referredUserId", "name email avatar")
      .limit(200);
    res.json({ referrals });
  } catch (error) {
    next(error);
  }
}

export async function getOverview(req, res, next) {
  try {
    await expirePendingSepayTopups();

    const requestedPeriod = String(req.query.period || "day");
    const revenuePeriod = ["day", "month", "year"].includes(requestedPeriod)
      ? requestedPeriod
      : "day";
    const [users, packages, vouchers, topups, getlinks, caches, cookiePool] =
      await Promise.all([
        User.find(),
        TopupPackage.find(),
        Voucher.find(),
        Topup.find(),
        Getlink.find(),
        ProductCache.find(),
        get3D66CookiePoolStatus(),
      ]);

    const approvedTopups = topups.filter(
      (topup) => topup.status === "approved",
    );
    const pendingTopups = topups.filter((topup) => topup.status === "pending");
    const now = new Date();
    const todayKey = vietnamChartKey(now, "day");
    const recentWeekKeys = new Set(recentVietnamDayKeys(7, now));
    const revenueChart = buildRevenueChart(approvedTopups, revenuePeriod);
    const userById = new Map(
      users.map((user) => [String(user._id), user]),
    );
    const packageById = new Map(
      packages.map((pack) => [String(pack._id), pack]),
    );
    const isToday = (value) => vietnamChartKey(value, "day") === todayKey;
    const isInRecentWeek = (value) =>
      recentWeekKeys.has(vietnamChartKey(value, "day"));
    const activeVouchers = vouchers.filter((voucher) => {
      const expiresAt = voucher.expireAt ? new Date(voucher.expireAt) : null;
      return (
        expiresAt &&
        expiresAt > now &&
        Number(voucher.usedCount || 0) < Number(voucher.usageLimit || 0)
      );
    });
    const packageStats = approvedTopups.reduce((stats, topup) => {
      const packageId = topup.packageId ? String(topup.packageId) : "unknown";
      const current = stats.get(packageId) || {
        packageId,
        name: packageById.get(packageId)?.name || "Không rõ gói",
        count: 0,
        revenue: 0,
        credit: 0,
      };
      current.count += 1;
      current.revenue += Number(topup.amount || 0);
      current.credit += Number(topup.credit || 0);
      stats.set(packageId, current);
      return stats;
    }, new Map());
    const recentGetlinks = [...getlinks]
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 6)
      .map((item) => {
        const itemUser = userById.get(String(item.userId));
        return {
          _id: item._id,
          userEmail: itemUser?.email || "",
          userName: itemUser?.name || "",
          productId: item.productId || "",
          title: item.title || "",
          creditUsed: Number(item.creditUsed || 0),
          createdAt: item.createdAt,
        };
      });
    const recentTopups = [...topups]
      .sort((a, b) => new Date(b.paidAt || b.createdAt || 0) - new Date(a.paidAt || a.createdAt || 0))
      .slice(0, 6)
      .map((item) => {
        const itemUser = userById.get(String(item.userId));
        const packageName = item.packageId ? packageById.get(String(item.packageId))?.name : "";
        return {
          _id: item._id,
          userEmail: itemUser?.email || "",
          userName: itemUser?.name || "",
          packageName: packageName || "",
          amount: Number(item.amount || 0),
          credit: Number(item.credit || 0),
          status: item.status || "",
          type: item.type || "",
          paidAt: item.paidAt,
          createdAt: item.createdAt,
        };
      });
    const topPackages = [...packageStats.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
    const approvedRevenue = approvedTopups.reduce(
      (sum, topup) => sum + Number(topup.amount || 0),
      0,
    );

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
        rejectedTopups: topups.filter((topup) => topup.status === "rejected")
          .length,
        revenue: approvedRevenue,
        todayRevenue: approvedTopups
          .filter((topup) => isToday(topup.paidAt || topup.updatedAt || topup.createdAt))
          .reduce((sum, topup) => sum + Number(topup.amount || 0), 0),
        weekRevenue: approvedTopups
          .filter((topup) => isInRecentWeek(topup.paidAt || topup.updatedAt || topup.createdAt))
          .reduce((sum, topup) => sum + Number(topup.amount || 0), 0),
        averageTopupAmount: approvedTopups.length
          ? Math.round(approvedRevenue / approvedTopups.length)
          : 0,
        revenuePeriod,
        revenueChart,
        totalGetlinks: getlinks.length,
        todayGetlinks: getlinks.filter((item) =>
          isToday(item.createdAt),
        ).length,
        weekGetlinks: getlinks.filter((item) =>
          isInRecentWeek(item.createdAt),
        ).length,
        totalCreditSpent: getlinks.reduce(
          (sum, item) => sum + Number(item.creditUsed || 0),
          0,
        ),
        cachedProducts: caches.length,
        todayUsers: users.filter((user) => isToday(user.createdAt))
          .length,
        bannedUsers: users.filter((user) => user.isBanned).length,
        adminUsers: users.filter((user) => user.role === "admin").length,
        cookieStats: cookiePool.stats,
        queueStatus: cookiePool.queue,
        recentGetlinks,
        recentTopups,
        topPackages,
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
    const result = await grantManualCredit({
      userId,
      amount,
      maxStoredCredit: MAX_STORED_CREDIT,
    });
    if (!result) {
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

    res.json({
      user: serializeAdminUser(result.user),
      topup: result.topup,
    });
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
    res.json({ user: serializeAdminUser(user) });
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

export async function listGetlinkRecords(req, res, next) {
  try {
    const search = normalizedSearch(req.query.search);
    const requestedPage = Number(req.query.page || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
    let records;
    let total;
    let safePage;
    let totalPages;
    if (!isMemoryDb()) {
      const regex = search ? new RegExp(escapedRegex(search), "i") : null;
      const matchedUsers = regex
        ? await User.find({ $or: [{ email: regex }, { name: regex }] })
            .select("_id")
            .limit(500)
        : [];
      const query = regex
        ? {
            $or: [
              { userId: { $in: matchedUsers.map((user) => user._id) } },
              { productId: regex },
              { title: regex },
            ],
          }
        : {};
      total = await Getlink.countDocuments(query);
      totalPages = Math.max(1, Math.ceil(total / ADMIN_GETLINK_PAGE_SIZE));
      safePage = Math.min(page, totalPages);
      records = await Getlink.find(query)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * ADMIN_GETLINK_PAGE_SIZE)
        .limit(ADMIN_GETLINK_PAGE_SIZE)
        .populate("userId", "name email avatar credit role");
    } else {
      const candidates = await Getlink.find()
        .sort({ createdAt: -1 })
        .populate("userId", "name email avatar credit role");
      const filteredRecords = search
        ? candidates
            .filter((item) => {
              const user = item.userId && typeof item.userId === "object" ? item.userId : null;
              return [
                user?.email,
                user?.name,
                user?._id || item.userId,
                item.productId,
                item.title,
              ].some((value) => String(value || "").toLowerCase().includes(search));
            })
        : candidates;
      total = filteredRecords.length;
      totalPages = Math.max(1, Math.ceil(total / ADMIN_GETLINK_PAGE_SIZE));
      safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * ADMIN_GETLINK_PAGE_SIZE;
      records = filteredRecords.slice(start, start + ADMIN_GETLINK_PAGE_SIZE);
    }
    const productIds = [
      ...new Set(records.map((item) => String(item.productId || "")).filter(Boolean)),
    ];
    const productCaches = productIds.length
      ? await ProductCache.find({ productId: { $in: productIds } }).select(
          "productId title creditCost priceKnown",
        )
      : [];
    const cacheByProductId = new Map(
      productCaches.map((item) => [String(item.productId), item]),
    );

    const getlinks = records.map((item) => {
      const doc = item.toObject ? item.toObject() : item;
      const user = doc.userId && typeof doc.userId === "object" ? doc.userId : null;
      const creditUsed = Number(doc.creditUsed || 0);
      const cache = cacheByProductId.get(String(doc.productId || ""));
      const modelPrice = Number(cache?.creditCost || creditUsed || 0);
      return {
        _id: doc._id,
        user: user
          ? {
              _id: user._id,
              name: user.name || "",
              email: user.email || "",
              avatar: user.avatar || "",
              credit: Number(user.credit || 0),
              role: user.role || "user",
            }
          : null,
        userId: user?._id || doc.userId,
        productId: doc.productId,
        title: doc.title || cache?.title || "",
        imageUrl: doc.imageUrl || "",
        sourceUrl: doc.sourceUrl || "",
        resolvedSourceUrl: doc.resolvedSourceUrl || "",
        modelPrice,
        priceKnown: Boolean(cache?.priceKnown || modelPrice > 1),
        creditDeducted: creditUsed,
        redownloadCount: Number(doc.redownloadCount || 0),
        createdAt: doc.createdAt,
      };
    });

    res.json({
      getlinks,
      pagination: {
        page: safePage,
        pageSize: ADMIN_GETLINK_PAGE_SIZE,
        total,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listTopupRecords(req, res, next) {
  try {
    const search = normalizedSearch(req.query.search);
    const requestedStatus = String(req.query.status || "approved").trim();
    const status = ["all", "approved", "pending", "rejected"].includes(requestedStatus)
      ? requestedStatus
      : "approved";
    const requestedPage = Number(req.query.page || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
    let records;
    let total;
    let safePage;
    let totalPages;

    if (!isMemoryDb()) {
      const regex = search ? new RegExp(escapedRegex(search), "i") : null;
      const [matchedUsers, matchedPackages] = regex
        ? await Promise.all([
            User.find({ $or: [{ email: regex }, { name: regex }] })
              .select("_id")
              .limit(500),
            TopupPackage.find({ name: regex }).select("_id").limit(500),
          ])
        : [[], []];
      const query = {
        type: { $ne: "manual" },
        ...(status !== "all" ? { status } : {}),
        ...(regex
          ? {
              $or: [
                { userId: { $in: matchedUsers.map((user) => user._id) } },
                { packageId: { $in: matchedPackages.map((pack) => pack._id) } },
                { paymentCode: regex },
                { gatewayTransactionId: regex },
                { voucherCode: regex },
              ],
            }
          : {}),
      };
      total = await Topup.countDocuments(query);
      totalPages = Math.max(1, Math.ceil(total / ADMIN_TOPUP_PAGE_SIZE));
      safePage = Math.min(page, totalPages);
      records = await Topup.find(query)
        .sort({ createdAt: -1 })
        .skip((safePage - 1) * ADMIN_TOPUP_PAGE_SIZE)
        .limit(ADMIN_TOPUP_PAGE_SIZE)
        .populate("userId", "name email avatar credit role")
        .populate("packageId", "name price credit badge");
    } else {
      const candidates = await Topup.find()
        .sort({ createdAt: -1 })
        .populate("userId", "name email avatar credit role")
        .populate("packageId", "name price credit badge");
      const filteredRecords = candidates.filter((item) => {
        if (item.type === "manual") return false;
        if (status !== "all" && item.status !== status) return false;
        if (!search) return true;
        const user = item.userId && typeof item.userId === "object" ? item.userId : null;
        const pack = item.packageId && typeof item.packageId === "object" ? item.packageId : null;
        return [
          user?.email,
          user?.name,
          pack?.name,
          item.paymentCode,
          item.gatewayTransactionId,
          item.voucherCode,
        ].some((value) => String(value || "").toLowerCase().includes(search));
      });
      total = filteredRecords.length;
      totalPages = Math.max(1, Math.ceil(total / ADMIN_TOPUP_PAGE_SIZE));
      safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * ADMIN_TOPUP_PAGE_SIZE;
      records = filteredRecords.slice(start, start + ADMIN_TOPUP_PAGE_SIZE);
    }

    const topups = records.map((item) => {
      const doc = item.toObject ? item.toObject() : item;
      const user = doc.userId && typeof doc.userId === "object" ? doc.userId : null;
      const pack = doc.packageId && typeof doc.packageId === "object" ? doc.packageId : null;
      return {
        _id: doc._id,
        user: user
          ? {
              _id: user._id,
              name: user.name || "",
              email: user.email || "",
              avatar: user.avatar || "",
            }
          : null,
        userId: user?._id || doc.userId,
        package: pack
          ? {
              _id: pack._id,
              name: pack.name || "",
              price: Number(pack.price || 0),
              credit: Number(pack.credit || 0),
              badge: pack.badge || "",
            }
          : null,
        packageId: pack?._id || doc.packageId,
        amount: Number(doc.amount || 0),
        originalAmount: Number(doc.originalAmount || doc.amount || 0),
        discountAmount: Number(doc.discountAmount || 0),
        credit: Number(doc.credit || 0),
        status: doc.status || "pending",
        type: doc.type || "auto",
        voucherCode: doc.voucherCode || "",
        paymentCode: doc.paymentCode || "",
        gatewayProvider: doc.gatewayProvider || "",
        gatewayTransactionId: doc.gatewayTransactionId || "",
        rejectionReason: doc.rejectionReason || "",
        paidAt: doc.paidAt,
        createdAt: doc.createdAt,
      };
    });

    res.json({
      topups,
      pagination: {
        page: safePage,
        pageSize: ADMIN_TOPUP_PAGE_SIZE,
        total,
        totalPages,
      },
    });
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

    const { payload, error } = normalizeVoucherPayload(req.body);
    if (error) return res.status(400).json({ message: error });

    const voucher = await Voucher.create(payload);
    res.json({ voucher });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Voucher code already exists" });
    }
    next(error);
  }
}

export async function updateVoucher(req, res, next) {
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
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid voucher id" });
    }

    const currentVoucher = await Voucher.findById(req.params.id);
    if (!currentVoucher) {
      return res.status(404).json({ message: "Voucher not found" });
    }

    const { payload, error } = normalizeVoucherPayload(req.body, currentVoucher);
    if (error) return res.status(400).json({ message: error });

    let voucher = await Voucher.findByIdAndUpdate(req.params.id, payload, {
      new: true,
    });
    if (typeof voucher?.populate === "function") {
      voucher = await voucher.populate("applicablePackageIds", "name price");
    }
    res.json({ voucher });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Voucher code already exists" });
    }
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
      "salePrice",
      "maxTopupsPerUser",
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
      "salePrice",
      "maxTopupsPerUser",
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
