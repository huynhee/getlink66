import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, Archive, Ban, BarChart3, Box, Check, CircleDollarSign, Cookie, CreditCard, Database, FileDown, FileText, Flag, Gauge, Gift, Globe2, GripVertical, History as HistoryIcon, KeyRound, Loader2, Megaphone, Package, Pencil, Plus, RotateCcw, Save, Search, ShieldAlert, Timer, Type, UserPlus, Users, Wallet, X, Zap } from "lucide-react";
import AdminArticles from "../components/AdminArticles.jsx";
import AdminDownloadHistory from "../components/AdminDownloadHistory.jsx";
import AdminMarketplace from "../components/AdminMarketplace.jsx";
import CoinAmount from "../components/CoinAmount.jsx";
import Pagination from "../components/Pagination.jsx";
import { api } from "../api.js";
import { text, translations } from "../i18n.js";

const emptyPackage = {
  name: "",
  price: "",
  credit: "",
  salePercent: "",
  salePrice: "",
  maxTopupsPerUser: "",
  badge: "",
  features: "5 lượt tải model\nLưu lịch sử tải\nHỗ trợ cơ bản"
};

const emptyMembershipPlan = {
  code: "",
  name: "",
  price: "",
  durationDays: "",
  dailyDownloadLimit: "100",
  badge: "",
  features: "100 lượt tải model mỗi ngày\nTải nhanh, không chờ 30s\nTải model Pro",
  isActive: true
};

const emptyVoucher = {
  code: "",
  description: "",
  targetKind: "credit",
  creditBonus: "",
  discountPercent: "",
  usageLimit: "",
  perUserLimit: "",
  applicablePackageIds: [],
  expireAt: "",
  isActive: true
};

const emptyNotification = {
  title: "",
  body: "",
  displayType: "dropdown",
  imageUrl: "",
  actionLabel: "",
  actionUrl: "",
  targetType: "all",
  emails: "",
  startsAt: "",
  expiresAt: ""
};

const referralModeOptions = [
  {
    value: "both",
    vi: "Thưởng cả hai người",
    en: "Reward both users",
  },
  {
    value: "referrer_only",
    vi: "Chỉ thưởng người giới thiệu",
    en: "Reward referrer only",
  },
  {
    value: "off",
    vi: "Tắt giới thiệu",
    en: "Disable referral",
  },
];

const referralRewardOptions = [
  { value: "both", credit: true, pro: true, vi: "1 ngày Pro + 28 credit", en: "1 Pro day + 28 credits" },
  { value: "credit", credit: true, pro: false, vi: "Chỉ 28 credit", en: "28 credits only" },
  { value: "pro", credit: false, pro: true, vi: "Chỉ 1 ngày Pro", en: "1 Pro day only" },
];

const HOME_TEXT_FIELDS = [
  "heroEyebrow",
  "heroText",
  "heroSubtitle",
  "saleText",
  "demoTitle",
  "demoSubmitText",
  "systemStatusLabel",
  "pricePerDownloadLabel",
  "pricePerDownloadValue",
  "referralTitleBoth",
  "referralTitleReferrerOnly",
  "pricingEyebrow",
  "pricingTitle",
  "pricingNote",
  "guideEyebrow",
  "guideTitle",
  "guideIntro",
  "ctaTitle",
  "ctaUserText",
  "ctaGuestText",
  "footerTagline",
];

const defaultSiteSettings = {
  referralMode: "both",
  referralRewardCreditEnabled: true,
  referralRewardProEnabled: true,
  heroEyebrow: "+ api 3d sdk",
  heroText: "SIÊU RẺ\nTẢI 3D\nGETLINK",
  heroSubtitle: "Thư viện 3D 200,000+ models giá chỉ 66đ/1 model. Dịch vụ getlink trung gian mua trung quốc giá rẻ.",
  saleText: "",
  demoTitle: "Bắt đầu tải ngay",
  demoSubmitText: "GET LINK",
  systemStatusLabel: "Trạng thái hệ thống",
  pricePerDownloadLabel: "Giá tải chỉ từ",
  pricePerDownloadValue: "10K",
  referralTitleBoth: "Mời bạn bè, cả hai nhận 1 ngày Pro + 28 credit.",
  referralTitleReferrerOnly: "Mời bạn bè để nhận 1 ngày Pro + 28 credit.",
  pricingEyebrow: "Bảng giá",
  pricingTitle: "Chọn gói phù hợp",
  pricingNote: "Nạp credit tự động, cộng credit ngay sau khi chọn gói.",
  guideEyebrow: "Hướng dẫn",
  guideTitle: "Bài hướng dẫn",
  guideIntro: "Đọc hướng dẫn sử dụng Getlink, nạp credit và tải lại file đã mua.",
  ctaTitle: "Sẵn sàng bắt đầu?",
  ctaUserText: "Vào trang getlink để tải model 3D và quản lý credit của bạn.",
  ctaGuestText: "Đăng nhập Google để bắt đầu getlink 3D và quản lý credit của bạn.",
  footerTagline: "Hỗ trợ 24/7",
  threed66GetlinkConcurrency: 1,
  threed66PreviewConcurrency: 1,
  threed66RefreshConcurrency: 1,
  threed66PaytypeValue: "4",
  threed66ModelResolveMode: "search",
  threed66RequestIntervalMs: 2500,
  threed66BrowserConcurrency: 1,
  threed66BrowserAlways: false,
  threed66DisableBrowserPageFallback: false,
  threed66DisableBrowserDownloadFallback: false,
  threed66DownloadHandleBrowserFallback: false,
  threed66ProxyEnabled: false,
  threed66ProxyUrl: "",
  threed66ProxyUrlConfigured: false,
  threed66ProxyUrlClear: false,
  threed66ProxyForPreview: false,
  threed66ProxyForApi: false,
  threed66ProxyForDownload: false,
  threed66ProxyForBrowser: false,
  threed66ProxyFailClosed: false,
  threed66TimeoutMs: 30000,
  threed66BrowserNavRetries: 3,
  threed66BrowserRetryDelayMs: 1500,
  threed66CookieMaxFailures: 2,
  threed66CookieCooldownMinutes: 30,
  maxGlobalDownloads: 20,
  maxDownloadsPerUser: 2,
  maxDownloadsPerIp: 4,
  getlinkRedownloadDays: 3,
  getlinkRedownloadLimit: 5,
  getlinkDetailRetentionDaysAfterExpiry: 1,
  getlinkHistoryRetentionDaysAfterExpiry: 365,
  marketplaceDownloadHistoryRetentionDays: 365,
  marketplaceReportHistoryRetentionDays: 365,
  auditLogHistoryRetentionDays: 365,
};

function discountedPrice(pkg) {
  if (Number(pkg.salePrice || 0) > 0) return Number(pkg.salePrice || 0);
  return Math.round(Number(pkg.price || 0) * (100 - Number(pkg.salePercent || 0)) / 100);
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function formatNumber(value, locale = "vi-VN") {
  return Number(value || 0).toLocaleString(locale);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function toDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function voucherTargetKind(voucher) {
  const explicit = String(voucher?.targetKind || "").trim().toLowerCase();
  if (["credit", "pro", "all"].includes(explicit)) return explicit;
  const applicablePackageIds = Array.isArray(voucher?.applicablePackageIds) ? voucher.applicablePackageIds : [];
  if (Number(voucher?.creditBonus || 0) > 0 || applicablePackageIds.length > 0) return "credit";
  if (Number(voucher?.discountPercent || 0) > 0) return "all";
  return "credit";
}

function voucherMatchesMode(voucher, mode) {
  return voucherTargetKind(voucher) === mode;
}

function voucherKindLabel(kind, l) {
  if (kind === "pro") return "PRO";
  if (kind === "all") return l("DÙNG CHUNG", "ALL");
  return "CREDIT";
}

function voucherOperationalState(voucher) {
  if (voucher?.isActive === false) return "archived";
  if (Number(voucher?.usedCount || 0) >= Number(voucher?.usageLimit || 0)) return "exhausted";
  if (!voucher?.expireAt || new Date(voucher.expireAt) <= new Date()) return "expired";
  return "active";
}

function timelineTypeLabel(type, l) {
  const labels = {
    credit: "Credit",
    pro: "Pro",
    getlink: "Getlink",
    model: "Model",
    scene: "Scene",
    referral: l("Giới thiệu", "Referral"),
    voucher: "Voucher",
  };
  return labels[type] || type || "-";
}

function timelineStatusLabel(status, l) {
  const labels = {
    approved: l("Thành công", "Approved"),
    pending: l("Đang chờ", "Pending"),
    rejected: l("Đã từ chối", "Rejected"),
    downloaded: l("Đã tải", "Downloaded"),
    used: l("Đã dùng", "Used"),
    rewarded: l("Đã nhận", "Rewarded"),
  };
  return labels[status] || status || "-";
}

function timelineStatusClass(status) {
  if (["approved", "downloaded", "used", "rewarded"].includes(status)) return "success";
  if (status === "pending") return "pending";
  return "error";
}

function adminTimelineAmount(event, locale, l) {
  const amount = Number(event?.amount || 0);
  if (!amount) return "-";
  if (event.type === "pro") return formatMoney(Math.abs(amount));
  if (["model", "scene"].includes(event.type)) return `${Math.abs(amount).toLocaleString(locale)} ${l("lượt", "downloads")}`;
  return `${amount > 0 ? "+" : "-"}${Math.abs(amount).toLocaleString(locale)} credit`;
}

export default function Admin({ user, language = "vi" }) {
  const t = translations[language] || translations.vi;
  const l = (vi, en) => text(language, vi, en);
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const [activeSection, setActiveSection] = useState("overview");
  const [generalSection, setGeneralSection] = useState("users");
  const [websiteSection, setWebsiteSection] = useState("packages");
  const [threed66SettingsTab, setThreed66SettingsTab] = useState("tasks");
  const [revenuePeriod, setRevenuePeriod] = useState("day");
  const [overview, setOverview] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [storageHealth, setStorageHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [membershipPlans, setMembershipPlans] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [articles, setArticles] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [siteSettings, setSiteSettings] = useState(defaultSiteSettings);
  const [homeTextMsg, setHomeTextMsg] = useState("");
  const [referralMsg, setReferralMsg] = useState("");
  const [runtimeSettingsMsg, setRuntimeSettingsMsg] = useState("");
  const [cookieRecords, setCookieRecords] = useState([]);
  const [cookiePool, setCookiePool] = useState(null);
  const [systemLogs, setSystemLogs] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPagination, setAuditPagination] = useState({ page: 1, pageSize: 30, total: 0, totalPages: 1 });
  const [getlinkRecords, setGetlinkRecords] = useState([]);
  const [getlinkSearch, setGetlinkSearch] = useState("");
  const [getlinkPage, setGetlinkPage] = useState(1);
  const [getlinkPagination, setGetlinkPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [topupRecords, setTopupRecords] = useState([]);
  const [topupSearch, setTopupSearch] = useState("");
  const [transactionKind, setTransactionKind] = useState("all");
  const [topupStatus, setTopupStatus] = useState("all");
  const [topupPage, setTopupPage] = useState(1);
  const [topupPagination, setTopupPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [userSearch, setUserSearch] = useState("");
  const [userFilter, setUserFilter] = useState("all");
  const [userSort, setUserSort] = useState("created-desc");
  const [userPage, setUserPage] = useState(1);
  const [userPagination, setUserPagination] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  const [cookie, setCookie] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [packageMode, setPackageMode] = useState("credit");
  const [packageForm, setPackageForm] = useState(emptyPackage);
  const [membershipPlanForm, setMembershipPlanForm] = useState(emptyMembershipPlan);
  const [voucherForm, setVoucherForm] = useState(emptyVoucher);
  const [voucherMode, setVoucherMode] = useState("credit");
  const [voucherSearch, setVoucherSearch] = useState("");
  const [voucherStatus, setVoucherStatus] = useState("all");
  const [voucherMsg, setVoucherMsg] = useState("");
  const [voucherMsgError, setVoucherMsgError] = useState(false);
  const [notificationForm, setNotificationForm] = useState(emptyNotification);
  const [notificationMsg, setNotificationMsg] = useState("");
  const [editingNotificationId, setEditingNotificationId] = useState("");
  const [editUser, setEditUser] = useState(null);
  const [editCredit, setEditCredit] = useState("");
  const [banReasonByUser, setBanReasonByUser] = useState({});
  const [editingPackageId, setEditingPackageId] = useState("");
  const [editingMembershipPlanId, setEditingMembershipPlanId] = useState("");
  const [editingVoucherId, setEditingVoucherId] = useState("");
  const [dragPackageId, setDragPackageId] = useState("");
  const [userDetail, setUserDetail] = useState(null);
  const [userQuota, setUserQuota] = useState(null);
  const [userTimeline, setUserTimeline] = useState([]);
  const [userTimelineType, setUserTimelineType] = useState("all");
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [userDetailMsg, setUserDetailMsg] = useState("");
  const [proAdjustForm, setProAdjustForm] = useState({ proUntil: "", proDailyDownloadLimit: "100" });
  const [twoFactorQr, setTwoFactorQr] = useState("");
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorToken, setTwoFactorToken] = useState("");
  const [twoFactorMsg, setTwoFactorMsg] = useState("");
  const [transactionMsg, setTransactionMsg] = useState("");
  const [transactionMsgError, setTransactionMsgError] = useState(false);
  const [reviewingTransactionId, setReviewingTransactionId] = useState("");

  const loadData = React.useCallback(async () => {
    const dashboardPeriod = revenuePeriod === "day" ? "day" : revenuePeriod === "month" ? "month" : "month";
    const [oRes, dRes, storageRes, pRes, planRes, vRes, cRes, sRes, lRes, aRes, nRes, rRes, settingRes] = await Promise.all([
      api(`/api/admin/overview?period=${revenuePeriod}`),
      api(`/api/admin/dashboard?period=${dashboardPeriod}`),
      api("/api/admin/storage-health").catch(() => ({ storage: null })),
      api("/api/admin/topup-packages"),
      api("/api/admin/membership-plans"),
      api("/api/admin/vouchers"),
      api("/api/admin/cookies"),
      api("/api/admin/cookies/status"),
      api("/api/admin/system-logs"),
      api("/api/admin/articles"),
      api("/api/admin/notifications"),
      api("/api/admin/referrals"),
      api("/api/settings")
    ]);
    setOverview(oRes.overview || null);
    setDashboard(dRes.dashboard || null);
    setStorageHealth(storageRes.storage || null);
    setPackages(pRes.packages || []);
    setMembershipPlans(planRes.plans || []);
    setVouchers(vRes.vouchers || []);
    setCookieRecords(cRes.cookies || []);
    setCookiePool(sRes.pool || null);
    setSystemLogs(lRes.logs || []);
    setArticles(aRes.articles || []);
    setNotifications(nRes.notifications || []);
    setReferrals(rRes.referrals || []);
    setSiteSettings({ ...defaultSiteSettings, ...(settingRes.settings || {}) });
  }, [revenuePeriod]);

  const loadUsers = React.useCallback(async () => {
    const query = new URLSearchParams({
      page: String(userPage),
      sort: userSort,
      filter: userFilter,
    });
    if (userSearch.trim()) query.set("search", userSearch.trim());
    const data = await api(`/api/admin/users?${query.toString()}`);
    setUsers(data.users || []);
    const pagination = data.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 };
    setUserPagination(pagination);
    if (pagination.page !== userPage) setUserPage(pagination.page);
  }, [userFilter, userPage, userSearch, userSort]);

  const loadGetlinks = React.useCallback(async () => {
    const query = new URLSearchParams({ page: String(getlinkPage) });
    if (getlinkSearch.trim()) query.set("search", getlinkSearch.trim());
    const data = await api(`/api/admin/getlinks?${query.toString()}`);
    setGetlinkRecords(data.getlinks || []);
    const pagination = data.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 };
    setGetlinkPagination(pagination);
    if (pagination.page !== getlinkPage) setGetlinkPage(pagination.page);
  }, [getlinkPage, getlinkSearch]);

  const loadTopups = React.useCallback(async () => {
    const query = new URLSearchParams({
      page: String(topupPage),
      kind: transactionKind,
    });
    if (topupStatus !== "all") query.set("status", topupStatus);
    if (topupSearch.trim()) query.set("search", topupSearch.trim());
    const data = await api(`/api/admin/transactions?${query.toString()}`);
    setTopupRecords(data.transactions || data.topups || []);
    const pagination = data.pagination || { page: 1, pageSize: 10, total: 0, totalPages: 1 };
    setTopupPagination(pagination);
    if (pagination.page !== topupPage) setTopupPage(pagination.page);
  }, [topupPage, topupSearch, topupStatus, transactionKind]);

  const loadAuditLogs = React.useCallback(async () => {
    const query = new URLSearchParams({ page: String(auditPage), limit: "30" });
    if (auditSearch.trim()) query.set("search", auditSearch.trim());
    const data = await api(`/api/admin/audit-logs?${query.toString()}`);
    setAuditLogs(data.logs || []);
    const pagination = data.pagination || { page: 1, pageSize: 30, total: 0, totalPages: 1 };
    setAuditPagination(pagination);
    if (pagination.page !== auditPage) setAuditPage(pagination.page);
  }, [auditPage, auditSearch]);

  async function reviewTransaction(item, action) {
    if (!item?.rawId) return;
    const actionLabel = action === "approve" ? l("duyệt", "approve") : l("hủy", "cancel");
    const kindLabel = item.kind === "pro" ? "Pro" : "Credit";
    if (!window.confirm(l(
      `Xác nhận ${actionLabel} giao dịch ${kindLabel} ${item.paymentCode || ""}?`,
      `Confirm ${actionLabel} ${kindLabel} transaction ${item.paymentCode || ""}?`,
    ))) return;
    const endpoint = item.kind === "pro"
      ? `/api/admin/membership-orders/${item.rawId}/${action}`
      : `/api/admin/topups/${item.rawId}/${action}`;
    setReviewingTransactionId(item.id || item.rawId);
    setTransactionMsg("");
    setTransactionMsgError(false);
    try {
      await api(endpoint, {
        method: "POST",
        body: action === "cancel" ? JSON.stringify({ reason: "admin_cancel" }) : undefined
      });
      setTransactionMsg(l(
        `Đã ${actionLabel} giao dịch ${kindLabel}.`,
        `${kindLabel} transaction ${action === "approve" ? "approved" : "canceled"}.`,
      ));
      await Promise.all([loadTopups(), loadData(), loadUsers()]);
      if (userDetail?.user?._id && item.user?._id === userDetail.user._id) {
        await loadUserDetail(userDetail.user, userTimelineType);
      }
    } catch (error) {
      setTransactionMsgError(true);
      setTransactionMsg(error.message || l("Không xử lý được giao dịch.", "Cannot process transaction."));
    } finally {
      setReviewingTransactionId("");
    }
  }

  useEffect(() => {
    loadData().catch(console.error);
  }, [loadData]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadUsers().catch(console.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [loadUsers]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadGetlinks().catch(console.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [loadGetlinks]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadTopups().catch(console.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [loadTopups]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadAuditLogs().catch(console.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [loadAuditLogs]);

  function fillPackageForm(pack) {
    setEditingPackageId(pack?._id || "");
    if (!pack) {
      setPackageForm(emptyPackage);
      return;
    }

    setPackageForm({
      name: pack.name || "",
      price: pack.price || "",
      credit: pack.credit || "",
      salePercent: pack.salePercent || "",
      salePrice: Number(pack.salePrice || 0) > 0 ? pack.salePrice : "",
      maxTopupsPerUser: Number(pack.maxTopupsPerUser || 0) > 0 ? pack.maxTopupsPerUser : "",
      badge: pack.badge || "",
      features: Array.isArray(pack.features) ? pack.features.join("\n") : ""
    });
  }

  async function savePackage(event) {
    event.preventDefault();
    await api(editingPackageId ? `/api/admin/topup-packages/${editingPackageId}` : "/api/admin/topup-packages", {
      method: editingPackageId ? "PUT" : "POST",
      body: JSON.stringify(packageForm)
    });
    setPackageForm(emptyPackage);
    setEditingPackageId("");
    await loadData();
  }

  async function deletePackage(id) {
    await api(`/api/admin/topup-packages/${id}`, { method: "DELETE" });
    if (editingPackageId === id) {
      setEditingPackageId("");
      setPackageForm(emptyPackage);
    }
    await loadData();
  }

  async function movePackage(dragId, targetId) {
    if (!dragId || dragId === targetId) return;
    const fromIndex = packages.findIndex((item) => item._id === dragId);
    const toIndex = packages.findIndex((item) => item._id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextPackages = [...packages];
    const [dragged] = nextPackages.splice(fromIndex, 1);
    nextPackages.splice(toIndex, 0, dragged);
    setPackages(nextPackages);
    setDragPackageId("");

    const data = await api("/api/admin/topup-packages/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds: nextPackages.map((item) => item._id) })
    });
    setPackages(data.packages || nextPackages);
    await loadData();
  }

  function fillMembershipPlanForm(plan) {
    setEditingMembershipPlanId(plan?._id || "");
    if (!plan) {
      setMembershipPlanForm(emptyMembershipPlan);
      return;
    }

    setMembershipPlanForm({
      code: plan.code || "",
      name: plan.name || "",
      price: plan.price || "",
      durationDays: plan.durationDays || "",
      dailyDownloadLimit: plan.dailyDownloadLimit || "100",
      badge: plan.badge || "",
      features: Array.isArray(plan.features) ? plan.features.join("\n") : "",
      isActive: plan.isActive !== false
    });
  }

  async function saveMembershipPlan(event) {
    event.preventDefault();
    const payload = {
      ...membershipPlanForm,
      price: Number(membershipPlanForm.price || 0),
      durationDays: Number(membershipPlanForm.durationDays || 1),
      dailyDownloadLimit: Number(membershipPlanForm.dailyDownloadLimit || 100)
    };
    await api(editingMembershipPlanId ? `/api/admin/membership-plans/${editingMembershipPlanId}` : "/api/admin/membership-plans", {
      method: editingMembershipPlanId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    setMembershipPlanForm(emptyMembershipPlan);
    setEditingMembershipPlanId("");
    await loadData();
  }

  async function deleteMembershipPlan(id) {
    await api(`/api/admin/membership-plans/${id}`, { method: "DELETE" });
    if (editingMembershipPlanId === id) {
      setEditingMembershipPlanId("");
      setMembershipPlanForm(emptyMembershipPlan);
    }
    await loadData();
  }

  function resetVoucherEditor(mode = voucherMode) {
    setEditingVoucherId("");
    setVoucherForm({ ...emptyVoucher, targetKind: mode });
    setVoucherMsg("");
    setVoucherMsgError(false);
  }

  function changeVoucherMode(mode) {
    setVoucherMode(mode);
    setVoucherStatus("all");
    resetVoucherEditor(mode);
  }

  function fillVoucherForm(voucher) {
    setEditingVoucherId(voucher?._id || "");
    if (!voucher) {
      resetVoucherEditor(voucherMode);
      return;
    }

    setVoucherForm({
      code: voucher.code || "",
      description: voucher.description || "",
      targetKind: voucherTargetKind(voucher),
      creditBonus: voucher.creditBonus || "",
      discountPercent: voucher.discountPercent || "",
      usageLimit: voucher.usageLimit || "",
      perUserLimit: Number(voucher.perUserLimit ?? 1) === Number(voucher.usageLimit || 0)
        ? ""
        : voucher.perUserLimit ?? "",
      applicablePackageIds: Array.isArray(voucher.applicablePackageIds)
        ? voucher.applicablePackageIds.map((pkg) => String(pkg?._id || pkg)).filter(Boolean)
        : [],
      expireAt: toDatetimeLocal(voucher.expireAt),
      isActive: voucher.isActive !== false
    });
    setVoucherMode(voucherTargetKind(voucher));
    setVoucherMsg("");
    setVoucherMsgError(false);
  }

  async function saveVoucher(event) {
    event.preventDefault();
    try {
      const isCreditMode = voucherMode === "credit";
      const payload = {
        ...voucherForm,
        targetKind: voucherMode,
        creditBonus: isCreditMode ? Number(voucherForm.creditBonus || 0) : 0,
        discountPercent: Number(voucherForm.discountPercent || 0),
        usageLimit: Number(voucherForm.usageLimit),
        perUserLimit:
          voucherForm.perUserLimit === "" ? undefined : Number(voucherForm.perUserLimit),
        applicablePackageIds: isCreditMode ? voucherForm.applicablePackageIds : [],
        expireAt: new Date(voucherForm.expireAt).toISOString(),
        isActive: voucherForm.isActive !== false
      };
      await api(editingVoucherId ? `/api/admin/vouchers/${editingVoucherId}` : "/api/admin/voucher", {
        method: editingVoucherId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      setVoucherForm({ ...emptyVoucher, targetKind: voucherMode });
      setEditingVoucherId("");
      setVoucherMsg(editingVoucherId
        ? l("Voucher đã cập nhật thành công.", "Voucher updated successfully.")
        : l("Voucher đã tạo thành công.", "Voucher created successfully."));
      setVoucherMsgError(false);
      await loadData();
    } catch (err) {
      setVoucherMsgError(true);
      setVoucherMsg(err.message);
    }
  }

  async function deleteVoucher(id) {
    const voucher = vouchers.find((item) => item._id === id);
    const willArchive = Boolean(voucher?.hasTransactions || Number(voucher?.usedCount || 0) > 0);
    if (!window.confirm(willArchive
      ? l("Voucher đã có giao dịch và sẽ được lưu trữ. Tiếp tục?", "This voucher has transactions and will be archived. Continue?")
      : l("Xóa vĩnh viễn voucher chưa sử dụng này?", "Permanently delete this unused voucher?"))) {
      return;
    }
    try {
      const result = await api(`/api/admin/vouchers/${id}`, { method: "DELETE" });
      if (editingVoucherId === id) resetVoucherEditor(voucherMode);
      setVoucherMsg(result.archived
        ? l("Voucher đã được lưu trữ.", "Voucher archived.")
        : l("Voucher đã được xóa.", "Voucher deleted."));
      setVoucherMsgError(false);
      await loadData();
    } catch (error) {
      setVoucherMsgError(true);
      setVoucherMsg(error.message || l("Không xử lý được voucher.", "Cannot process voucher."));
    }
  }

  async function saveNotification(event) {
    event.preventDefault();
    try {
      setNotificationMsg("");
      await api(editingNotificationId ? `/api/admin/notifications/${editingNotificationId}` : "/api/admin/notifications", {
        method: editingNotificationId ? "PUT" : "POST",
        body: JSON.stringify({
          ...notificationForm,
          startsAt: notificationForm.startsAt
            ? new Date(notificationForm.startsAt).toISOString()
            : undefined,
          expiresAt: notificationForm.expiresAt
            ? new Date(notificationForm.expiresAt).toISOString()
            : undefined
        })
      });
      setNotificationForm(emptyNotification);
      setEditingNotificationId("");
      setNotificationMsg(editingNotificationId
        ? l("Thông báo đã được cập nhật.", "Notification updated.")
        : l("Thông báo đã được gửi.", "Notification sent."));
      await loadData();
    } catch (err) {
      setNotificationMsg(err.message);
    }
  }

  function editNotification(item) {
    setEditingNotificationId(item._id);
    setNotificationMsg("");
    setNotificationForm({
      title: item.title || "",
      body: item.body || "",
      displayType: item.displayType || "dropdown",
      imageUrl: item.imageUrl || "",
      actionLabel: item.actionLabel || "",
      actionUrl: item.actionUrl || "",
      targetType: item.targetType || "all",
      emails: Array.isArray(item.userIds)
        ? item.userIds.map((target) => target?.email).filter(Boolean).join("\n")
        : "",
      startsAt: toDatetimeLocal(item.startsAt),
      expiresAt: toDatetimeLocal(item.expiresAt),
    });
  }

  function cancelNotificationEdit() {
    setEditingNotificationId("");
    setNotificationForm(emptyNotification);
    setNotificationMsg("");
  }

  async function deleteNotification(id) {
    await api(`/api/admin/notifications/${id}`, { method: "DELETE" });
    if (editingNotificationId === id) {
      cancelNotificationEdit();
    }
    await loadData();
  }

  async function saveReferralSettings(patch) {
    try {
      setReferralMsg("");
      const next = { ...siteSettings, ...patch };
      const data = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          referralMode: next.referralMode,
          referralRewardCreditEnabled: Boolean(next.referralRewardCreditEnabled),
          referralRewardProEnabled: Boolean(next.referralRewardProEnabled),
        })
      });
      setSiteSettings({ ...defaultSiteSettings, ...(data.settings || next) });
      setReferralMsg(l("Đã cập nhật chế độ giới thiệu.", "Referral settings updated."));
    } catch (err) {
      setReferralMsg(err.message);
    }
  }

  async function saveHomeTextSettings(event) {
    event.preventDefault();
    try {
      setHomeTextMsg("");
      const payload = {};
      HOME_TEXT_FIELDS.forEach((field) => {
        payload[field] = siteSettings[field] ?? "";
      });
      const data = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setSiteSettings({ ...defaultSiteSettings, ...(data.settings || {}) });
      setHomeTextMsg(l("Đã cập nhật text trang chủ.", "Homepage text updated."));
      await loadData();
    } catch (err) {
      setHomeTextMsg(err.message);
    }
  }

  function updateHomeText(field, value) {
    setSiteSettings((settings) => ({ ...settings, [field]: value }));
  }

  function updateRuntimeSetting(field, value) {
    setSiteSettings((settings) => ({ ...settings, [field]: value }));
  }

  function setPlaywrightMode(mode) {
    setSiteSettings((settings) => ({
      ...settings,
      threed66BrowserAlways: mode === "always",
      threed66DisableBrowserPageFallback: mode === "off",
      threed66DisableBrowserDownloadFallback: mode === "off",
      threed66DownloadHandleBrowserFallback: mode === "always",
    }));
  }

  async function saveRuntimeSettings(event) {
    event.preventDefault();
    try {
      setRuntimeSettingsMsg("");
      const data = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          threed66GetlinkConcurrency: Number(siteSettings.threed66GetlinkConcurrency || 1),
          threed66PreviewConcurrency: Number(siteSettings.threed66PreviewConcurrency || 1),
          threed66RefreshConcurrency: Number(siteSettings.threed66RefreshConcurrency || 1),
          threed66PaytypeValue: String(siteSettings.threed66PaytypeValue || "4").trim(),
          threed66ModelResolveMode: String(siteSettings.threed66ModelResolveMode || "search"),
          threed66RequestIntervalMs: Number(siteSettings.threed66RequestIntervalMs || 2500),
          threed66BrowserConcurrency: Number(siteSettings.threed66BrowserConcurrency || 1),
          threed66BrowserAlways: Boolean(siteSettings.threed66BrowserAlways),
          threed66DisableBrowserPageFallback: Boolean(siteSettings.threed66DisableBrowserPageFallback),
          threed66DisableBrowserDownloadFallback: Boolean(siteSettings.threed66DisableBrowserDownloadFallback),
          threed66DownloadHandleBrowserFallback: Boolean(siteSettings.threed66DownloadHandleBrowserFallback),
          threed66ProxyEnabled: Boolean(siteSettings.threed66ProxyEnabled),
          threed66ProxyUrl: String(siteSettings.threed66ProxyUrl || "").trim(),
          threed66ProxyUrlClear: Boolean(siteSettings.threed66ProxyUrlClear),
          threed66ProxyForPreview: Boolean(siteSettings.threed66ProxyForPreview),
          threed66ProxyForApi: Boolean(siteSettings.threed66ProxyForApi),
          threed66ProxyForDownload: Boolean(siteSettings.threed66ProxyForDownload),
          threed66ProxyForBrowser: Boolean(siteSettings.threed66ProxyForBrowser),
          threed66ProxyFailClosed: Boolean(siteSettings.threed66ProxyFailClosed),
          threed66TimeoutMs: Number(siteSettings.threed66TimeoutMs || 30000),
          threed66BrowserNavRetries: Number(siteSettings.threed66BrowserNavRetries || 3),
          threed66BrowserRetryDelayMs: Number(siteSettings.threed66BrowserRetryDelayMs ?? 1500),
          threed66CookieMaxFailures: Number(siteSettings.threed66CookieMaxFailures || 2),
          threed66CookieCooldownMinutes: Number(siteSettings.threed66CookieCooldownMinutes || 30),
          maxGlobalDownloads: Number(siteSettings.maxGlobalDownloads || 20),
          maxDownloadsPerUser: Number(siteSettings.maxDownloadsPerUser || 2),
          maxDownloadsPerIp: Number(siteSettings.maxDownloadsPerIp || 4),
          getlinkRedownloadDays: Number(siteSettings.getlinkRedownloadDays || 3),
          getlinkRedownloadLimit: Number(siteSettings.getlinkRedownloadLimit || 5),
          getlinkDetailRetentionDaysAfterExpiry: Number(siteSettings.getlinkDetailRetentionDaysAfterExpiry ?? 1),
          getlinkHistoryRetentionDaysAfterExpiry: Number(siteSettings.getlinkHistoryRetentionDaysAfterExpiry ?? 365),
          marketplaceDownloadHistoryRetentionDays: Number(siteSettings.marketplaceDownloadHistoryRetentionDays ?? 365),
          marketplaceReportHistoryRetentionDays: Number(siteSettings.marketplaceReportHistoryRetentionDays ?? 365),
          auditLogHistoryRetentionDays: Number(siteSettings.auditLogHistoryRetentionDays ?? 365),
        })
      });
      setSiteSettings({ ...defaultSiteSettings, ...(data.settings || {}) });
      setRuntimeSettingsMsg(l("Đã cập nhật thông số 3D66.", "3D66 runtime settings updated."));
      await loadData();
    } catch (err) {
      setRuntimeSettingsMsg(err.message);
    }
  }

  async function saveCookie(event) {
    event.preventDefault();
    setLoading(true);
    try {
      await api("/api/admin/cookie", {
        method: "POST",
        body: JSON.stringify({ value: cookie })
      });
      setCookie("");
      await loadData();
      setMessage(l("Cookie 3D66 đã được lưu.", "3D66 cookie saved."));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function test3D66Cookie() {
    setLoading(true);
    try {
      const data = await api("/api/admin/cookie/test", {
        method: "POST",
        body: JSON.stringify({ value: cookie || undefined })
      });
      const details = data.mode === "model-page"
        ? ` ll_id:${data.hasLlId ? "ok" : "missing"} token:${data.hasToken ? "ok" : "missing"} up_time:${data.hasUpTime ? "ok" : "missing"}`
        : "";
      setMessage(l(`Cookie 3D66 hợp lệ.${details}`, `3D66 cookie is valid.${details}`));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function testSaved3D66Cookie(id) {
    setLoading(true);
    try {
      const data = await api(`/api/admin/cookies/${id}/test`, { method: "POST" });
      const details = data.mode === "model-page"
        ? ` ll_id:${data.hasLlId ? "ok" : "missing"} token:${data.hasToken ? "ok" : "missing"} up_time:${data.hasUpTime ? "ok" : "missing"}`
        : "";
      setMessage(l(`Cookie 3D66 hợp lệ.${details}`, `3D66 cookie is valid.${details}`));
      await loadData();
    } catch (err) {
      setMessage(err.message);
      await loadData();
    } finally {
      setLoading(false);
    }
  }

  async function delete3D66Cookie(id) {
    await api(`/api/admin/cookies/${id}`, { method: "DELETE" });
    setMessage(l("Đã xóa cookie 3D66.", "3D66 cookie deleted."));
    await loadData();
  }

  async function addCredit(userId) {
    await api("/api/admin/add-credit", {
      method: "POST",
      body: JSON.stringify({ userId, credit: 1 })
    });
    await Promise.all([loadData(), loadUsers()]);
    if (userDetail?.user?._id === userId) await loadUserDetail(userDetail.user, userTimelineType);
  }

  async function saveUserCredit(userId) {
    await api("/api/admin/set-credit", {
      method: "POST",
      body: JSON.stringify({ userId, credit: Number(editCredit) })
    });
    setEditUser(null);
    await Promise.all([loadData(), loadUsers()]);
    if (userDetail?.user?._id === userId) await loadUserDetail(userDetail.user, userTimelineType);
  }

  async function toggleBanUser(targetUser) {
    const isBanned = Boolean(targetUser.isBanned);
    const endpoint = isBanned
      ? `/api/admin/users/${targetUser._id}/unban`
      : `/api/admin/users/${targetUser._id}/ban`;
    const options = isBanned
      ? { method: "POST" }
      : {
        method: "POST",
        body: JSON.stringify({
          reason:
            banReasonByUser[targetUser._id] ||
            "Tài khoản của bạn đã bị khóa quyền getlink.",
        }),
      };
    await api(endpoint, options);
    setBanReasonByUser((items) => ({ ...items, [targetUser._id]: "" }));
    await loadUsers();
    if (userDetail?.user?._id === targetUser._id) await loadUserDetail(targetUser, userTimelineType);
  }

  async function loadUserDetail(targetUser, timelineType = userTimelineType) {
    if (!targetUser?._id) return;
    setUserDetailLoading(true);
    setUserDetailMsg("");
    try {
      const [profileRes, quotaRes, timelineRes] = await Promise.all([
        api(`/api/admin/users/${targetUser._id}/profile`),
        api(`/api/admin/users/${targetUser._id}/quota`),
        api(`/api/admin/users/${targetUser._id}/timeline?type=${timelineType}&limit=12`)
      ]);
      const profileUser = profileRes.user || targetUser;
      setUserDetail({
        user: profileUser,
        stats: profileRes.stats || {},
        auditLogs: profileRes.auditLogs || []
      });
      setUserQuota(quotaRes.quota || null);
      setUserTimeline(timelineRes.events || []);
      setUserTimelineType(timelineRes.type || timelineType);
      setProAdjustForm({
        proUntil: toDateInput(profileUser.proUntil),
        proDailyDownloadLimit: String(profileUser.proDailyDownloadLimit ?? 100)
      });
    } catch (err) {
      setUserDetailMsg(err.message);
    } finally {
      setUserDetailLoading(false);
    }
  }

  async function saveUserProAdjust(event) {
    event.preventDefault();
    if (!userDetail?.user?._id) return;
    try {
      setUserDetailMsg("");
      await api(`/api/admin/users/${userDetail.user._id}/pro-adjust`, {
        method: "POST",
        body: JSON.stringify({
          proUntil: proAdjustForm.proUntil ? new Date(proAdjustForm.proUntil).toISOString() : undefined,
          proDailyDownloadLimit: Number(proAdjustForm.proDailyDownloadLimit || 100)
        })
      });
      setUserDetailMsg(l("Đã cập nhật Pro cho user.", "User Pro updated."));
      await Promise.all([loadUsers(), loadUserDetail(userDetail.user, userTimelineType)]);
    } catch (err) {
      setUserDetailMsg(err.message);
    }
  }

  async function clearUserPro() {
    if (!userDetail?.user?._id) return;
    try {
      setUserDetailMsg("");
      await api(`/api/admin/users/${userDetail.user._id}/pro-adjust`, {
        method: "POST",
        body: JSON.stringify({ clearPro: true })
      });
      setUserDetailMsg(l("Đã gỡ Pro của user.", "User Pro cleared."));
      await Promise.all([loadUsers(), loadUserDetail(userDetail.user, userTimelineType)]);
    } catch (err) {
      setUserDetailMsg(err.message);
    }
  }

  async function handleGenerate2FA() {
    try {
      setLoading(true);
      setTwoFactorMsg("");
      const res = await api("/api/auth/2fa/generate", { method: "POST" });
      setTwoFactorQr(res.qrCode);
      setTwoFactorSecret(res.secret);
    } catch (err) {
      setTwoFactorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEnable2FA(e) {
    e.preventDefault();
    try {
      setLoading(true);
      setTwoFactorMsg("");
      await api("/api/auth/2fa/enable", {
        method: "POST",
        body: JSON.stringify({ token: twoFactorToken })
      });
      setTwoFactorMsg(l("Bật 2FA thành công! Vui lòng tải lại trang.", "2FA enabled successfully. Please reload the page."));
      setTwoFactorQr("");
      setTwoFactorToken("");
    } catch (err) {
      setTwoFactorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  const revenueChart = overview?.revenueChart || [];
  const chartRevenue = revenueChart.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  const maxRevenue = Math.max(...revenueChart.map((item) => Number(item.revenue || 0)), 1);
  const chartLabels = {
    day: l("14 ngày gần nhất", "Last 14 days"),
    month: l("12 tháng gần nhất", "Last 12 months"),
    year: l("5 năm gần nhất", "Last 5 years")
  };
  const cookieStats = overview?.cookieStats || {};
  const queueStatus = overview?.queueStatus || {};
  const recentGetlinks = overview?.recentGetlinks || [];
  const recentTopups = overview?.recentTopups || [];
  const topPackages = overview?.topPackages || [];
  const adminKpis = dashboard?.kpis || {};
  const maxPackageRevenue = Math.max(...topPackages.map((item) => Number(item.revenue || 0)), 1);
  const cookieHealthLabel = Number(cookieStats.active || 0) > 0
    ? l("Có cookie sẵn sàng", "Cookie ready")
    : l("Cần kiểm tra cookie", "Check cookies");
  const overviewKpis = [
    {
      label: l("Doanh thu hôm nay", "Today revenue"),
      value: formatMoney(overview?.todayRevenue),
      detail: l(`7 ngày: ${formatMoney(overview?.weekRevenue)}`, `7 days: ${formatMoney(overview?.weekRevenue)}`),
      icon: CircleDollarSign,
      tone: "green",
    },
    {
      label: l("Getlink hôm nay", "Today getlinks"),
      value: formatNumber(overview?.todayGetlinks, locale),
      detail: l(`7 ngày: ${formatNumber(overview?.weekGetlinks, locale)} lượt`, `7 days: ${formatNumber(overview?.weekGetlinks, locale)} requests`),
      icon: FileDown,
      tone: "cyan",
    },
    {
      label: l("Người dùng mới", "New users"),
      value: formatNumber(overview?.todayUsers, locale),
      detail: l(`Tổng: ${formatNumber(overview?.totalUsers, locale)} user`, `Total: ${formatNumber(overview?.totalUsers, locale)} users`),
      icon: Users,
      tone: "magenta",
    },
    {
      label: l("Cookie 3D66", "3D66 cookies"),
      value: `${formatNumber(cookieStats.active, locale)}/${formatNumber(cookieStats.total, locale)}`,
      detail: cookieHealthLabel,
      icon: Cookie,
      tone: Number(cookieStats.active || 0) > 0 ? "green" : "danger",
    },
    {
      label: l("Doanh thu Pro", "Pro revenue"),
      value: formatMoney(adminKpis.proRevenue),
      detail: l(`${formatNumber(adminKpis.activePro, locale)} tài khoản Pro`, `${formatNumber(adminKpis.activePro, locale)} active Pro accounts`),
      icon: Zap,
      tone: "magenta",
    },
    {
      label: l("Tải model & scene", "Model & scene downloads"),
      value: formatNumber(adminKpis.marketplaceDownloads, locale),
      detail: l(
        `${formatNumber(adminKpis.modelDownloads, locale)} model · ${formatNumber(adminKpis.sceneDownloads, locale)} scene`,
        `${formatNumber(adminKpis.modelDownloads, locale)} models · ${formatNumber(adminKpis.sceneDownloads, locale)} scenes`,
      ),
      icon: Package,
      tone: "cyan",
    },
    {
      label: l("Tài nguyên thiếu file", "Assets missing files"),
      value: formatNumber(Number(adminKpis.missingModels || 0) + Number(adminKpis.missingScenes || 0), locale),
      detail: l(
        `${formatNumber(adminKpis.missingModels, locale)} model · ${formatNumber(adminKpis.missingScenes, locale)} scene`,
        `${formatNumber(adminKpis.missingModels, locale)} models · ${formatNumber(adminKpis.missingScenes, locale)} scenes`,
      ),
      icon: AlertTriangle,
      tone: Number(adminKpis.missingModels || 0) + Number(adminKpis.missingScenes || 0) > 0 ? "danger" : "green",
    },
    {
      label: l("Báo lỗi cần xử lý", "Issue reports"),
      value: formatNumber(adminKpis.activeMarketplaceReports, locale),
      detail: l(
        `${formatNumber(adminKpis.reportedModels, locale)} model · ${formatNumber(adminKpis.reportedScenes, locale)} scene`,
        `${formatNumber(adminKpis.reportedModels, locale)} models · ${formatNumber(adminKpis.reportedScenes, locale)} scenes`,
      ),
      icon: Flag,
      tone: Number(adminKpis.activeMarketplaceReports || 0) > 0 ? "danger" : "green",
    },
  ];
  const systemHealthItems = [
    {
      label: l("Queue getlink", "Getlink queue"),
      value: `${formatNumber(queueStatus.running, locale)}/${formatNumber(queueStatus.concurrency, locale)}`,
      detail: l(`${formatNumber(queueStatus.queued, locale)} đang chờ`, `${formatNumber(queueStatus.queued, locale)} queued`),
      icon: Gauge,
    },
    {
      label: l("Credit user còn", "User credit balance"),
      value: formatNumber(overview?.totalCredit, locale),
      detail: l(`${formatNumber(overview?.totalCreditSpent, locale)} credit đã trừ`, `${formatNumber(overview?.totalCreditSpent, locale)} credit spent`),
      icon: Wallet,
    },
    {
      label: l("Đơn chờ thanh toán", "Pending payments"),
      value: formatNumber(overview?.pendingTopups, locale),
      detail: formatMoney(overview?.pendingAmount),
      icon: Timer,
    },
    {
      label: l("Cache model", "Model cache"),
      value: formatNumber(overview?.cachedProducts, locale),
      detail: l("ProductCache đang lưu", "Stored ProductCache records"),
      icon: Zap,
    },
  ];
  const sections = [
    { key: "overview", label: t.adminOverview, icon: BarChart3 },
    { key: "general", label: l("Chung", "General"), icon: Database },
    { key: "getlink", label: "Getlink", icon: FileDown },
    { key: "models", label: "Model", icon: Package },
    { key: "scenes", label: "Scene", icon: Box },
    { key: "website", label: "Website", icon: Globe2 },
  ];
  const generalSections = [
    { key: "users", label: t.adminUsers, icon: Users, count: userPagination.total },
    { key: "downloads", label: l("Lịch sử tải", "Download history"), icon: FileDown },
    { key: "topups", label: l("Lịch sử nạp", "Top-up history"), icon: CreditCard, count: topupPagination.total },
    { key: "referrals", label: l("Giới thiệu", "Referrals"), icon: UserPlus, count: referrals.length },
    { key: "logs", label: l("Log lỗi", "Error logs"), icon: AlertTriangle, count: systemLogs.length },
    { key: "cookie", label: "Cookie", icon: Cookie, count: cookieRecords.length },
    { key: "audit", label: "Audit", icon: HistoryIcon, count: auditPagination.total },
    { key: "security", label: l("Bảo mật", "Security"), icon: ShieldAlert },
  ];
  const websiteSections = [
    { key: "packages", label: l("Gói nạp", "Top-up packages"), icon: CreditCard, count: packages.length + membershipPlans.length },
    { key: "vouchers", label: t.adminVouchers, icon: Gift, count: vouchers.length },
    { key: "notifications", label: t.notifications, icon: Megaphone, count: notifications.length },
    { key: "homeText", label: l("Text trang chủ", "Homepage text"), icon: Type },
    { key: "articles", label: t.adminArticles || l("Bài viết", "Articles"), icon: FileText, count: articles.length },
  ];
  const subNavigation = activeSection === "general"
    ? {
      title: l("Quản lý chung", "General management"),
      description: l("Tài khoản, giao dịch, giới thiệu và nhật ký vận hành toàn hệ thống.", "Accounts, transactions, referrals, and system-wide operations."),
      icon: Database,
      items: generalSections,
      activeKey: generalSection,
      onChange: setGeneralSection,
    }
    : activeSection === "website"
      ? {
        title: l("Nội dung Website", "Website content"),
        description: l("Quản lý sản phẩm thanh toán và toàn bộ nội dung hiển thị trên website.", "Manage payment products and all content displayed on the website."),
        icon: Globe2,
        items: websiteSections,
        activeKey: websiteSection,
        onChange: setWebsiteSection,
      }
      : null;
  const homeTextGroups = [
    {
      title: l("Hero đầu trang", "Hero section"),
      fields: [
        { field: "heroEyebrow", label: l("Nhãn nhỏ phía trên", "Small eyebrow"), type: "input" },
        { field: "heroText", label: l("Tiêu đề lớn", "Main headline"), type: "textarea", rows: 3 },
        { field: "heroSubtitle", label: l("Mô tả dưới tiêu đề", "Subtitle"), type: "textarea", rows: 3 },
        { field: "saleText", label: l("Dòng khuyến mại", "Promotion text"), type: "input" },
      ],
    },
    {
      title: l("Ô nhập getlink demo", "Demo getlink box"),
      fields: [
        { field: "demoTitle", label: l("Tiêu đề ô nhập", "Box title"), type: "input" },
        { field: "demoSubmitText", label: l("Chữ nút getlink", "Getlink button text"), type: "input" },
        { field: "systemStatusLabel", label: l("Nhãn trạng thái", "Status label"), type: "input" },
        { field: "pricePerDownloadLabel", label: l("Nhãn giá tải", "Price label"), type: "input" },
        { field: "pricePerDownloadValue", label: l("Giá hiển thị", "Displayed price"), type: "input" },
      ],
    },
    {
      title: l("Mời bạn", "Referral invite"),
      fields: [
        { field: "referralTitleBoth", label: l("Text khi cả hai nhận thưởng", "Text when both receive reward"), type: "input" },
        { field: "referralTitleReferrerOnly", label: l("Text khi chỉ người mời nhận", "Text when only referrer receives reward"), type: "input" },
      ],
    },
    {
      title: l("Bảng giá", "Pricing"),
      fields: [
        { field: "pricingEyebrow", label: l("Nhãn bảng giá", "Pricing eyebrow"), type: "input" },
        { field: "pricingTitle", label: l("Tiêu đề bảng giá", "Pricing title"), type: "input" },
        { field: "pricingNote", label: l("Mô tả bảng giá", "Pricing note"), type: "textarea", rows: 2 },
      ],
    },
    {
      title: l("Hướng dẫn trên trang chủ", "Homepage guide"),
      fields: [
        { field: "guideEyebrow", label: l("Nhãn hướng dẫn", "Guide eyebrow"), type: "input" },
        { field: "guideTitle", label: l("Tiêu đề hướng dẫn", "Guide title"), type: "input" },
        { field: "guideIntro", label: l("Mô tả hướng dẫn", "Guide intro"), type: "textarea", rows: 2 },
      ],
    },
    {
      title: l("CTA cuối trang và footer", "Bottom CTA and footer"),
      fields: [
        { field: "ctaTitle", label: l("Tiêu đề CTA", "CTA title"), type: "input" },
        { field: "ctaUserText", label: l("Mô tả CTA khi đã đăng nhập", "CTA text for signed-in users"), type: "textarea", rows: 2 },
        { field: "ctaGuestText", label: l("Mô tả CTA khi chưa đăng nhập", "CTA text for guests"), type: "textarea", rows: 2 },
        { field: "footerTagline", label: l("Dòng mô tả footer", "Footer tagline"), type: "input" },
      ],
    },
  ];
  const threed66RuntimeSettings = [
    {
      field: "threed66GetlinkConcurrency",
      label: l("Getlink chạy cùng lúc", "Concurrent getlink tasks"),
      help: l("Số job mua/generate link 3D66 được chạy song song. VPS nhỏ nên để 1.", "Number of 3D66 purchase/generate jobs running in parallel. Keep 1 on small VPS."),
      type: "number",
      min: 1,
      max: 10,
      fallback: 1,
    },
    {
      field: "threed66PreviewConcurrency",
      label: l("Preview chạy cùng lúc", "Concurrent preview tasks"),
      help: l("Số job lấy tên, ảnh và giá model từ 3D66 chạy song song.", "Number of metadata preview jobs fetching title, image, and price from 3D66."),
      type: "number",
      min: 1,
      max: 10,
      fallback: 1,
    },
    {
      field: "threed66RefreshConcurrency",
      label: l("Refresh chạy cùng lúc", "Concurrent refresh tasks"),
      help: l("Số job lấy lại fileUrl mới khi link tải 3D66 cũ hết hạn hoặc bị 401/403.", "Number of jobs refreshing fileUrl when old 3D66 links expire or return 401/403."),
      type: "number",
      min: 1,
      max: 10,
      fallback: 1,
    },
    {
      field: "threed66PaytypeValue",
      label: l("Paytype value 3D66", "3D66 paytype value"),
      help: l("Value của ví thanh toán trong popup 3D66. Ví dụ value=\"4\" là ví 赠点.", "Payment wallet value in the 3D66 popup. For example value=\"4\" is 赠点."),
      type: "text",
      fallback: "4",
      placeholder: "4",
    },
    {
      field: "threed66RequestIntervalMs",
      label: l("Khoảng nghỉ request (ms)", "Request interval (ms)"),
      help: l("Khoảng nghỉ tối thiểu giữa các request sang 3D66 để giảm rủi ro bị chặn.", "Minimum delay between requests sent to 3D66 to reduce blocking risk."),
      type: "number",
      min: 0,
      max: 60000,
      fallback: 2500,
    },
    {
      field: "threed66BrowserConcurrency",
      label: l("Browser chạy cùng lúc", "Concurrent browser tasks"),
      help: l("Số tác vụ Playwright chạy song song khi cần fallback browser.", "Number of Playwright tasks running in parallel when browser fallback is needed."),
      type: "number",
      min: 1,
      max: 5,
      fallback: 1,
    },
    {
      field: "threed66TimeoutMs",
      label: l("Timeout 3D66 (ms)", "3D66 timeout (ms)"),
      help: l("Thời gian chờ tối đa cho request/browser 3D66 trước khi báo lỗi.", "Maximum wait time for 3D66 request/browser work before failing."),
      type: "number",
      min: 5000,
      max: 120000,
      fallback: 30000,
    },
    {
      field: "threed66BrowserNavRetries",
      label: l("Số lần thử mở trang", "Browser navigation attempts"),
      help: l("Tổng số lần Playwright thử mở trang 3D66, gồm cả lần đầu. Nên để 3.", "Total Playwright attempts to open a 3D66 page, including the first attempt. Keep 3."),
      type: "number",
      min: 1,
      max: 5,
      fallback: 3,
    },
    {
      field: "threed66BrowserRetryDelayMs",
      label: l("Nghỉ giữa các lần thử (ms)", "Delay between attempts (ms)"),
      help: l("Thời gian chờ trước khi Playwright thử mở lại trang 3D66.", "Delay before Playwright retries opening a 3D66 page."),
      type: "number",
      min: 0,
      max: 10000,
      fallback: 1500,
    },
    {
      field: "threed66CookieMaxFailures",
      label: l("Lỗi cookie trước khi nghỉ", "Cookie failures before cooldown"),
      help: l("Cookie lỗi liên tiếp bao nhiêu lần thì chuyển sang trạng thái cooldown.", "How many consecutive failures before a cookie is put into cooldown."),
      type: "number",
      min: 1,
      max: 20,
      fallback: 2,
    },
    {
      field: "threed66CookieCooldownMinutes",
      label: l("Thời gian nghỉ cookie (phút)", "Cookie cooldown (minutes)"),
      help: l("Cookie bị lỗi sẽ nghỉ bao nhiêu phút trước khi được thử lại.", "How many minutes a failed cookie rests before it can be tried again."),
      type: "number",
      min: 1,
      max: 1440,
      fallback: 30,
    },
  ];
  const userRuntimeSettings = [
    {
      field: "maxGlobalDownloads",
      label: l("Tổng file tải cùng lúc", "Global concurrent downloads"),
      help: l("Tổng số file mà server được proxy cho tất cả user cùng lúc.", "Total files the server can proxy for all users at the same time."),
      type: "number",
      min: 1,
      max: 200,
      fallback: 20,
    },
    {
      field: "maxDownloadsPerUser",
      label: l("Mỗi user tải cùng lúc", "Concurrent downloads per user"),
      help: l("Giới hạn số file một tài khoản được tải đồng thời.", "Limits how many files one account can download at the same time."),
      type: "number",
      min: 1,
      max: 50,
      fallback: 2,
    },
    {
      field: "maxDownloadsPerIp",
      label: l("Mỗi IP tải cùng lúc", "Concurrent downloads per IP"),
      help: l("Giới hạn số file một IP được tải đồng thời để giảm lạm dụng/IDM quá nhiều kết nối.", "Limits simultaneous downloads from one IP to reduce abuse or too many IDM connections."),
      type: "number",
      min: 1,
      max: 100,
      fallback: 4,
    },
    {
      field: "getlinkRedownloadDays",
      label: l("Số ngày tải lại miễn phí", "Free redownload days"),
      help: l("User được tải lại file đã getlink trong bao nhiêu ngày mà không bị trừ credit lại.", "How many days users can redownload a getlinked file without being charged again."),
      type: "number",
      min: 1,
      max: 30,
      fallback: 3,
    },
    {
      field: "getlinkRedownloadLimit",
      label: l("Số lần tải lại miễn phí", "Free redownload limit"),
      help: l("Số lần tải lại miễn phí cho mỗi file trong thời hạn tải lại.", "Number of free redownloads for each file within the redownload window."),
      type: "number",
      min: 1,
      max: 100,
      fallback: 5,
    },
    {
      field: "getlinkDetailRetentionDaysAfterExpiry",
      label: l("Xóa link chi tiết sau khi hết hạn (ngày)", "Purge sensitive links after expiry (days)"),
      help: l("Xóa URL file, URL nguồn và ảnh sau khi hết hạn tải lại. Nhập 0 để giữ vĩnh viễn.", "Removes file, source and image URLs after redownload expiry. Use 0 to keep forever."),
      type: "number",
      min: 0,
      max: 3650,
      fallback: 1,
    },
    {
      field: "getlinkHistoryRetentionDaysAfterExpiry",
      label: l("Lưu lịch sử Getlink online (ngày)", "Online Getlink history retention (days)"),
      help: l("Archive lên Drive rồi xóa khỏi Atlas. 0 là giữ vĩnh viễn; giá trị khác tối thiểu 30 ngày.", "Archives to Drive before removal from Atlas. 0 keeps forever; other values have a 30-day minimum."),
      type: "number",
      min: 0,
      max: 3650,
      fallback: 365,
    },
    {
      field: "marketplaceDownloadHistoryRetentionDays",
      label: l("Lưu lịch sử tải Model/Scene (ngày)", "Model/Scene download history retention (days)"),
      help: l("Archive sang Drive rồi xóa khỏi MongoDB VPS; tổng lượt tải không bị giảm. 0 là giữ vĩnh viễn.", "Archives to Drive before removal from the VPS; cumulative counts stay unchanged. 0 keeps forever."),
      type: "number",
      min: 0,
      max: 3650,
      fallback: 365,
    },
    {
      field: "marketplaceReportHistoryRetentionDays",
      label: l("Lưu báo lỗi đã đóng (ngày)", "Closed report retention (days)"),
      help: l("Archive báo lỗi đã xử lý hoặc bỏ qua lên Drive trước khi xóa khỏi MongoDB VPS.", "Archives resolved or dismissed reports to Drive before deleting them from the VPS."),
      type: "number",
      min: 0,
      max: 3650,
      fallback: 365,
    },
    {
      field: "auditLogHistoryRetentionDays",
      label: l("Lưu AuditLog online (ngày)", "Online AuditLog retention (days)"),
      help: l("Archive nhật ký thao tác admin lên Drive trước khi xóa khỏi MongoDB VPS.", "Archives admin audit history to Drive before deleting it from the VPS."),
      type: "number",
      min: 0,
      max: 3650,
      fallback: 365,
    },
  ];
  const proxyRuntimeSettings = [
    {
      field: "threed66ProxyEnabled",
      label: l("Bật proxy 3D66", "Enable 3D66 proxy"),
      help: l("Bật lớp proxy riêng cho request backend gửi sang 3D66. Không ảnh hưởng user vào web.", "Enable a dedicated proxy for backend requests to 3D66. User traffic to the site is not affected."),
    },
    {
      field: "threed66ProxyForPreview",
      label: l("Proxy khi kiểm tra model", "Proxy preview checks"),
      help: l("Dùng proxy khi đọc trang/metadata model. Mặc định nên tắt để preview nhanh và ít rủi ro.", "Use proxy for model page and metadata reads. Keep off by default for faster, lower-risk previews."),
    },
    {
      field: "threed66ProxyForApi",
      label: l("Proxy khi mua/generate link", "Proxy purchase/generate API"),
      help: l("Dùng proxy khi gọi download/pop và download/handle của 3D66.", "Use proxy for 3D66 download/pop and download/handle API calls."),
    },
    {
      field: "threed66ProxyForDownload",
      label: l("Proxy khi kéo file tải", "Proxy file download"),
      help: l("Dùng proxy khi VPS kéo fileUrl thật từ 3D66 trước khi stream về user.", "Use proxy when the VPS pulls the real 3D66 fileUrl before streaming to the user."),
    },
    {
      field: "threed66ProxyForBrowser",
      label: l("Proxy cho Playwright", "Proxy Playwright"),
      help: l("Dùng proxy cho browser fallback. Chỉ bật khi đã test proxy ổn.", "Use proxy for browser fallback. Enable only after the proxy is tested."),
    },
    {
      field: "threed66ProxyFailClosed",
      label: l("Proxy lỗi thì dừng", "Fail closed on proxy error"),
      help: l("Mặc định tắt: proxy lỗi sẽ tự chuyển về IP VPS và gửi cảnh báo Telegram. Bật nếu muốn dừng hẳn khi proxy lỗi.", "Off by default: proxy failures fall back to the VPS IP and send a Telegram alert. Enable to stop requests when proxy fails."),
    },
  ];
  const currentPlaywrightMode = siteSettings.threed66BrowserAlways
    ? "always"
    : siteSettings.threed66DisableBrowserPageFallback &&
      siteSettings.threed66DisableBrowserDownloadFallback &&
      !siteSettings.threed66DownloadHandleBrowserFallback
      ? "off"
      : "fallback";
  const playwrightModes = [
    {
      value: "off",
      label: l("Tắt Playwright", "Playwright off"),
      help: l("Chỉ dùng HTTP. Nhẹ VPS nhất nhưng model bị 3D66 render/challenge có thể không đọc được.", "HTTP-only. Lightest on the VPS, but rendered/challenged 3D66 models may fail."),
    },
    {
      value: "fallback",
      label: l("Tự fallback", "Auto fallback"),
      help: l("Ưu tiên HTTP. Chỉ dùng Playwright khi HTTP đọc trang/thiếu dữ liệu. Nên dùng hằng ngày.", "Prefer HTTP. Use Playwright only when HTTP cannot read the page or misses fields. Recommended daily mode."),
    },
    {
      value: "always",
      label: l("Luôn Playwright", "Always Playwright"),
      help: l("Ép preview/getlink đi qua browser để test model khó. Tốn RAM/CPU hơn.", "Force preview/getlink through the browser for hard models. Uses more RAM/CPU."),
    },
  ];
  const modelResolveModes = [
    {
      value: "search",
      label: l("Tìm bằng ID", "Search by ID"),
      help: l(
        "Dùng cookie gọi search 3D66 để lấy URL model. Phù hợp khi user chỉ nhập mã model.",
        "Use the cookie to search 3D66 for the model URL. Best when users enter only a model ID.",
      ),
    },
    {
      value: "footprint",
      label: l("Lấy qua lịch sử truy cập", "Resolve via footprint"),
      help: l(
        "Preview đọc link user cho nhanh. Khi tải, Playwright mở link, làm mới lịch sử truy cập và lấy URL thuộc tài khoản cookie.",
        "Preview the submitted link directly. On download, Playwright opens it, refreshes footprint history, and uses the cookie account URL.",
      ),
    },
    {
      value: "direct",
      label: l("Dùng link trực tiếp", "Use direct URL"),
      help: l(
        "Dùng nguyên link đầu vào cho cả preview và tải. Chỉ nên dùng để kiểm tra.",
        "Use the submitted URL for both preview and download. Intended for diagnostics only.",
      ),
    },
  ];
  const threed66SettingsTabs = [
    { key: "tasks", label: l("Tác vụ", "Tasks"), icon: Activity },
    { key: "downloads", label: l("Tải file", "Downloads"), icon: FileDown },
    { key: "proxy", label: l("Proxy", "Proxy"), icon: Zap },
    { key: "playwright", label: l("Playwright", "Playwright"), icon: Gauge },
    { key: "status", label: l("Trạng thái", "Status"), icon: Cookie },
  ];
  const normalizedVoucherSearch = voucherSearch.trim().toLowerCase();
  const visibleVouchers = vouchers.filter((voucher) => {
    if (!voucherMatchesMode(voucher, voucherMode)) return false;
    if (voucherStatus !== "all" && voucherOperationalState(voucher) !== voucherStatus) return false;
    if (!normalizedVoucherSearch) return true;
    return [voucher.code, voucher.description]
      .some((value) => String(value || "").toLowerCase().includes(normalizedVoucherSearch));
  });
  const voucherModeCounts = ["credit", "pro", "all"].reduce((counts, mode) => ({
    ...counts,
    [mode]: vouchers.filter((voucher) => voucherMatchesMode(voucher, mode)).length,
  }), {});

  return (
    <div className="stack adminPage">
      <section className="panel">
        <h2>{l("Quản trị hệ thống", "System administration")}</h2>
        <nav className="adminSectionNav" aria-label="Admin sections">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.key}
                type="button"
                className={activeSection === section.key ? "active" : ""}
                onClick={() => setActiveSection(section.key)}
              >
                <Icon size={16} />
                {section.label}
                {typeof section.count === "number" && <span>{section.count}</span>}
              </button>
            );
          })}
        </nav>
      </section>

      {subNavigation && (
        <section className="panel adminDataPanel adminGroupPanel">
          <div>
            <h2>
              <subNavigation.icon size={20} /> {subNavigation.title}
            </h2>
            <p className="muted">{subNavigation.description}</p>
          </div>
          <nav className="adminSectionNav adminDataNav" aria-label="Admin subsections">
            {subNavigation.items.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.key}
                  type="button"
                  className={subNavigation.activeKey === section.key ? "active" : ""}
                  onClick={() => subNavigation.onChange(section.key)}
                >
                  <Icon size={16} />
                  {section.label}
                  {typeof section.count === "number" && <span>{section.count}</span>}
                </button>
              );
            })}
          </nav>
        </section>
      )}

      {activeSection === "overview" && (
        <section className="overviewDashboard">
          <div className="overviewHero panel">
            <div>
              <p className="eyebrowSignal">{l("Admin command center", "Admin command center")}</p>
              <h2><BarChart3 size={20} /> {l("Tổng quan vận hành", "Operations overview")}</h2>
              <p className="muted">
                {l("Theo dõi doanh thu, getlink, cookie 3D66 và các hoạt động mới nhất trong một màn hình.", "Track revenue, getlinks, 3D66 cookies, and latest activity in one screen.")}
              </p>
            </div>
            <div className="overviewHeroStats">
              <span>{l("Tổng doanh thu", "Total revenue")}</span>
              <strong>{formatMoney(overview?.revenue)}</strong>
              <small>{l(`TB đơn: ${formatMoney(overview?.averageTopupAmount)}`, `Avg order: ${formatMoney(overview?.averageTopupAmount)}`)}</small>
            </div>
          </div>

          <div className="adminKpiGrid">
            {overviewKpis.map((item) => {
              const Icon = item.icon;
              return (
                <div className={`adminKpiCard ${item.tone}`} key={item.label}>
                  <div>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <Icon size={28} />
                </div>
              );
            })}
          </div>

          <div className="overviewTopGrid">
            <div className="panel">
              <h3><Package size={16} /> {l("Top gói nạp", "Top packages")}</h3>
              <div className="packageBars">
                {topPackages.map((item) => {
                  const width = Math.max(8, Math.round((Number(item.revenue || 0) / maxPackageRevenue) * 100));
                  return (
                    <div className="packageBarItem" key={item.packageId}>
                      <div>
                        <strong>{item.name}</strong>
                        <span>{formatMoney(item.revenue)} · {formatNumber(item.count, locale)} {l("đơn", "orders")}</span>
                      </div>
                      <div className="packageBarTrack">
                        <i style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
                {!topPackages.length && <p className="muted">{l("Chưa có gói nạp thành công.", "No successful package top-ups yet.")}</p>}
              </div>
            </div>

            <div className="panel">
              <h3><Activity size={16} /> {l("Sức khỏe hệ thống", "System health")}</h3>
              <div className="systemHealthGrid">
                {systemHealthItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div className="systemHealthItem" key={item.label}>
                      <Icon size={16} />
                      <div>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                        <small>{item.detail}</small>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="panel storageHealthPanel">
            <div className="storageHealthHeading">
              <div>
                <h3><Database size={16} /> {l("Lưu trữ và khôi phục", "Storage and recovery")}</h3>
                <p className="muted">
                  {l("Atlas Core, MongoDB VPS, Drive backup và worker archive.", "Atlas Core, marketplace VPS, Drive backups, and archive workers.")}
                </p>
              </div>
              <span className={storageHealth?.ok ? "status active" : "status error"}>
                {storageHealth?.ok ? l("Ổn định", "Healthy") : l("Cần kiểm tra", "Needs attention")}
              </span>
            </div>
            <div className="storageHealthGrid">
              <div className="systemHealthItem">
                <Database size={16} />
                <div>
                  <span>Atlas Core</span>
                  <strong>{storageHealth?.databases?.core?.connected ? l("Đã kết nối", "Connected") : l("Mất kết nối", "Disconnected")}</strong>
                  <small>{formatBytes(storageHealth?.databases?.core?.storageBytes)}{storageHealth?.databases?.core?.usagePercent != null ? ` · ${storageHealth.databases.core.usagePercent}%` : ""}</small>
                </div>
              </div>
              <div className="systemHealthItem">
                <Database size={16} />
                <div>
                  <span>MongoDB VPS</span>
                  <strong>{storageHealth?.databases?.marketplace?.replicaSet || storageHealth?.databases?.marketplace?.topology || "-"}</strong>
                  <small>{formatBytes(storageHealth?.databases?.marketplace?.storageBytes)} · {storageHealth?.databases?.routing?.distinct ? l("Đã tách", "Split") : l("Chưa tách", "Not split")}</small>
                </div>
              </div>
              <div className="systemHealthItem">
                <Archive size={16} />
                <div>
                  <span>{l("Backup Core", "Core backup")}</span>
                  <strong>{storageHealth?.backups?.core ? `${storageHealth.backups.core.ageHours}h` : "-"}</strong>
                  <small>{formatBytes(storageHealth?.backups?.core?.encryptedBytes)} · {storageHealth?.backups?.core?.encryptedSha256?.slice(0, 12) || "-"}</small>
                </div>
              </div>
              <div className="systemHealthItem">
                <Archive size={16} />
                <div>
                  <span>{l("Backup Marketplace", "Marketplace backup")}</span>
                  <strong>{storageHealth?.backups?.marketplace ? `${storageHealth.backups.marketplace.ageHours}h` : "-"}</strong>
                  <small>{formatBytes(storageHealth?.backups?.marketplace?.encryptedBytes)} · {storageHealth?.backups?.marketplace?.encryptedSha256?.slice(0, 12) || "-"}</small>
                </div>
              </div>
              <div className="systemHealthItem">
                <Gauge size={16} />
                <div>
                  <span>{l("Ổ đĩa VPS", "VPS disk")}</span>
                  <strong>{storageHealth?.disk?.usagePercent != null ? `${storageHealth.disk.usagePercent}%` : "-"}</strong>
                  <small>{formatBytes(storageHealth?.disk?.availableBytes)} {l("còn trống", "available")}</small>
                </div>
              </div>
              <div className="systemHealthItem">
                <Package size={16} />
                <div>
                  <span>{l("Cache ảnh cover", "Cover cache")}</span>
                  <strong>
                    {Number(storageHealth?.coverCache?.counts?.ready || 0).toLocaleString()}
                    {" / "}
                    {Object.values(storageHealth?.coverCache?.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0).toLocaleString()}
                  </strong>
                  <small>
                    {formatBytes(storageHealth?.coverCache?.diskBytes)}
                    {" · "}
                    {Number(storageHealth?.coverCache?.counts?.queued || 0).toLocaleString()} {l("đang chờ", "queued")}
                    {" · "}
                    {Number(storageHealth?.coverCache?.counts?.error || 0).toLocaleString()} {l("lỗi", "errors")}
                  </small>
                </div>
              </div>
              <div className="systemHealthItem">
                <RotateCcw size={16} />
                <div>
                  <span>Restore drill</span>
                  <strong>{storageHealth?.backups?.restoreDrill ? `${storageHealth.backups.restoreDrill.ageHours}h` : l("Chưa chạy", "Not run")}</strong>
                  <small>{l("Khôi phục vào DB tách biệt", "Restored into an isolated DB")}</small>
                </div>
              </div>
            </div>
            {!!storageHealth?.alerts?.length && (
              <div className="storageAlertList">
                {storageHealth.alerts.map((alert) => (
                  <span key={alert.code}><AlertTriangle size={14} /> {alert.message}</span>
                ))}
              </div>
            )}
          </div>

          <div className="revenueChartPanel">
            <div className="chartHeader">
              <div>
                <h3>{l("Biểu đồ doanh thu", "Revenue chart")}</h3>
                <p>{chartLabels[revenuePeriod]}, {l("tính theo giao dịch đã thanh toán.", "based on paid transactions.")}</p>
              </div>
              <div className="chartControls">
                {[
                  ["day", l("Ngày", "Day")],
                  ["month", l("Tháng", "Month")],
                  ["year", l("Năm", "Year")]
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={revenuePeriod === value ? "active" : ""}
                    onClick={() => setRevenuePeriod(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="chartTotal">
                <span>{l("Tổng kỳ", "Period total")}</span>
                <strong>{formatMoney(chartRevenue)}</strong>
              </div>
            </div>
            <div className={`revenueChart ${revenuePeriod}`} aria-label={l("Biểu đồ doanh thu", "Revenue chart")}>
              {revenueChart.map((item) => {
                const height = Math.max(6, Math.round((Number(item.revenue || 0) / maxRevenue) * 100));
                const tooltip = `${item.label} · ${formatMoney(item.revenue)} · ${formatNumber(item.count, locale)} ${l("giao dịch", "transactions")}`;
                return (
                  <div className="chartBarItem" key={item.date}>
                    <div className="chartBarTrack" aria-label={tooltip}>
                      <div className="chartBarFill" style={{ height: `${height}%` }} />
                    </div>
                    <div className="chartTooltip" role="tooltip">
                      <strong>{formatMoney(item.revenue)}</strong>
                      <small>{formatNumber(item.count, locale)} {l("giao dịch", "transactions")}</small>
                    </div>
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="overviewActivityGrid">
            <div className="panel">
              <h3><FileDown size={16} /> {l("Getlink mới nhất", "Latest getlinks")}</h3>
              <div className="adminActivityList">
                {recentGetlinks.map((item) => (
                  <div className="adminActivityItem" key={item._id}>
                    <FileDown size={16} />
                    <div>
                      <strong>{item.productId || item.title || l("Model 3D66", "3D66 model")}</strong>
                      <span>{item.userEmail || item.userName || l("Không rõ user", "Unknown user")}</span>
                    </div>
                    <small><CoinAmount value={formatNumber(item.creditUsed, locale)} prefix="-" /></small>
                  </div>
                ))}
                {!recentGetlinks.length && <p className="muted">{l("Chưa có getlink.", "No getlinks yet.")}</p>}
              </div>
            </div>

            <div className="panel">
              <h3><CreditCard size={16} /> {l("Nạp credit mới nhất", "Latest top-ups")}</h3>
              <div className="adminActivityList">
                {recentTopups.map((item) => (
                  <div className={`adminActivityItem ${item.status}`} key={item._id}>
                    <CreditCard size={16} />
                    <div>
                      <strong>{item.packageName || item.type || l("Nạp credit", "Credit top-up")}</strong>
                      <span>{item.userEmail || item.userName || l("Không rõ user", "Unknown user")}</span>
                    </div>
                    <small>{formatMoney(item.amount)} · {item.status}</small>
                  </div>
                ))}
                {!recentTopups.length && <p className="muted">{l("Chưa có giao dịch.", "No transactions yet.")}</p>}
              </div>
            </div>
          </div>
        </section>
      )}

      {(activeSection === "models" || activeSection === "scenes") && (
        <AdminMarketplace
          key={activeSection}
          language={language}
          assetType={activeSection === "scenes" ? "scene" : "model"}
        />
      )}

      {activeSection === "website" && websiteSection === "packages" && (
        <section className="panel">
          <h2><Package size={20} /> {l("Quản lý gói nạp", "Manage top-up packages")}</h2>
          <div className="adminSubTabs" role="tablist" aria-label={l("Loại gói nạp", "Top-up package type")}>
            <button type="button" className={packageMode === "credit" ? "active" : ""} onClick={() => setPackageMode("credit")}>
              <CreditCard size={15} /> Credit
            </button>
            <button type="button" className={packageMode === "pro" ? "active" : ""} onClick={() => setPackageMode("pro")}>
              <Zap size={15} /> Pro
            </button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {packageMode === "credit"
              ? l("Gói Credit chỉ cộng số dư dùng cho Getlink, không kích hoạt Pro và không cộng quota thư viện Model/Scene.", "Credit packages only add Getlink balance; they do not activate Pro or add Model/Scene library quota.")
              : l("Gói Pro kích hoạt quyền thành viên và quota tải Model/Scene, không cộng credit.", "Pro plans activate membership and Model/Scene download quota, not credit.")}
          </p>

          {packageMode === "credit" ? (
            <>
              <form onSubmit={savePackage} style={{ display: "grid", gap: 10, marginTop: 14 }}>
                <div className="inputRow">
                  <select
                    value={editingPackageId}
                    onChange={(event) => {
                      const selected = packages.find((item) => item._id === event.target.value);
                      fillPackageForm(selected);
                    }}
                  >
                    <option value="">{l("Tạo gói mới", "Create new package")}</option>
                    {packages.map((pkg) => (
                      <option key={pkg._id} value={pkg._id}>{pkg.name || t.defaultPackageName}</option>
                    ))}
                  </select>
                  {editingPackageId && (
                    <button type="button" className="smallButton" onClick={() => fillPackageForm(null)}>
                      <RotateCcw size={14} /> {l("Hủy sửa", "Cancel edit")}
                    </button>
                  )}
                </div>
                <div className="inputRow">
                  <input value={packageForm.name} onChange={(e) => setPackageForm({ ...packageForm, name: e.target.value })} placeholder={l("Tên gói, ví dụ: GÓI STARTER", "Package name, e.g. STARTER PACKAGE")} />
                  <input type="number" value={packageForm.price} onChange={(e) => setPackageForm({ ...packageForm, price: e.target.value })} placeholder={t.price} />
                  <input type="number" value={packageForm.credit} onChange={(e) => setPackageForm({ ...packageForm, credit: e.target.value })} placeholder="Credit" />
                </div>
                <div className="inputRow">
                  <input type="number" value={packageForm.salePercent} onChange={(e) => setPackageForm({ ...packageForm, salePercent: e.target.value })} placeholder={l("Sale %, ví dụ 20", "Sale %, e.g. 20")} />
                  <input
                    type="number"
                    min="0"
                    value={packageForm.salePrice}
                    onChange={(e) => setPackageForm({ ...packageForm, salePrice: e.target.value })}
                    placeholder={l("Giá thực sau sale, bỏ trống = tự tính", "Final price after sale, blank = auto")}
                  />
                  <input
                    type="number"
                    min="0"
                    value={packageForm.maxTopupsPerUser}
                    onChange={(e) => setPackageForm({ ...packageForm, maxTopupsPerUser: e.target.value })}
                    placeholder={l("Giới hạn mỗi tài khoản, bỏ trống = không giới hạn", "Per-account limit, blank = unlimited")}
                  />
                </div>
                <div className="inputRow">
                  <input value={packageForm.badge} onChange={(e) => setPackageForm({ ...packageForm, badge: e.target.value })} placeholder={l("Nhãn: SALE, POPULAR...", "Badge: SALE, POPULAR...")} />
                </div>
                <textarea
                  value={packageForm.features}
                  onChange={(e) => setPackageForm({ ...packageForm, features: e.target.value })}
                  rows={4}
                  style={{ height: "auto", minHeight: 110 }}
                  placeholder={l("Mỗi dòng là một quyền lợi của gói", "Each line is one package benefit")}
                />
                <button className="smallButton" disabled={!packageForm.name || !packageForm.price || !packageForm.credit} style={{ justifySelf: "start", minHeight: 42, padding: "0 20px" }}>
                  {editingPackageId ? <Save size={16} /> : <Plus size={16} />}
                  {editingPackageId ? l("Lưu chỉnh sửa", "Save changes") : l("Thêm gói", "Add package")}
                </button>
              </form>

              <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 13 }}>
                {l("Kéo thả gói để đổi thứ tự hiển thị ngoài trang nạp.", "Drag packages to change their order on the top-up page.")}
              </p>
              <div className="packageGrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                {packages.map((pkg) => (
                  <div
                    className={`package draggablePackage ${dragPackageId === pkg._id ? "dragging" : ""}`}
                    key={pkg._id}
                    draggable
                    onDragStart={() => setDragPackageId(pkg._id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => movePackage(dragPackageId, pkg._id)}
                    onDragEnd={() => setDragPackageId("")}
                    style={{ alignItems: "stretch", padding: 16, position: "relative", textAlign: "left" }}
                  >
                    <div className="packageActions">
                      <span title={l("Kéo để sắp xếp", "Drag to sort")}>
                        <GripVertical size={16} />
                      </span>
                      <button type="button" onClick={() => fillPackageForm(pkg)} title={l("Sửa gói", "Edit package")}>
                        <Pencil size={15} />
                      </button>
                      <button type="button" onClick={() => deletePackage(pkg._id)} title={l("Xóa gói", "Delete package")} style={{ color: "var(--error)" }}>
                        <X size={16} />
                      </button>
                    </div>
                    <button onClick={() => deletePackage(pkg._id)} title={l("Xóa gói", "Delete package")} style={{ position: "absolute", top: 8, right: 8, color: "var(--error)" }}>
                      <X size={16} />
                    </button>
                    {pkg.badge && <span className="badge success" style={{ alignSelf: "start" }}>{pkg.badge}</span>}
                    <h3 style={{ marginTop: 8 }}>{pkg.name || t.defaultPackageName}</h3>
                    <div className="priceBlock compact" style={{ alignItems: "flex-start" }}>
                      {(Number(pkg.salePercent || 0) > 0 || (Number(pkg.salePrice || 0) > 0 && Number(pkg.salePrice || 0) < Number(pkg.price || 0))) && (
                        <div className="priceOriginal">
                          {Number(pkg.price).toLocaleString(locale)}<span>đ</span>
                        </div>
                      )}
                      <strong>{Number(discountedPrice(pkg)).toLocaleString(locale)}đ</strong>
                    </div>
                    {(Number(pkg.salePercent || 0) > 0 || (Number(pkg.salePrice || 0) > 0 && Number(pkg.salePrice || 0) < Number(pkg.price || 0))) && (
                      <span className="topupPackageSale">
                        {Number(pkg.salePercent || 0) > 0
                          ? (language === "vi"
                            ? `Sale ${pkg.salePercent}% từ ${Number(pkg.price).toLocaleString(locale)}đ`
                            : `Sale ${pkg.salePercent}% from ${Number(pkg.price).toLocaleString(locale)}đ`)
                          : (language === "vi"
                            ? `Giá sale từ ${Number(pkg.price).toLocaleString(locale)}đ`
                            : `Sale price from ${Number(pkg.price).toLocaleString(locale)}đ`)}
                      </span>
                    )}
                    {Number(pkg.salePrice || 0) > 0 && (
                      <span className="muted">
                        {l("Giá nhập tay sau sale", "Manual final sale price")}: {Number(pkg.salePrice).toLocaleString(locale)}đ
                      </span>
                    )}
                    <span>{pkg.credit} CREDIT</span>
                    <span className="muted">
                      {Number(pkg.maxTopupsPerUser || 0) > 0
                        ? l(`Giới hạn ${pkg.maxTopupsPerUser} lần/tài khoản`, `Limit ${pkg.maxTopupsPerUser} times/account`)
                        : l("Không giới hạn số lần nạp/tài khoản", "Unlimited per account")}
                    </span>
                    <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                      {((pkg.features && pkg.features.length > 0)
                        ? pkg.features
                        : t.defaultPackageFeatures
                      ).map((feature, index) => (
                        <li key={index}>{feature}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <form onSubmit={saveMembershipPlan} style={{ display: "grid", gap: 10, marginTop: 14 }}>
                <div className="inputRow">
                  <select
                    value={editingMembershipPlanId}
                    onChange={(event) => {
                      const selected = membershipPlans.find((item) => item._id === event.target.value);
                      fillMembershipPlanForm(selected);
                    }}
                  >
                    <option value="">{l("Tạo gói Pro mới", "Create new Pro plan")}</option>
                    {membershipPlans.map((plan) => (
                      <option key={plan._id} value={plan._id}>{plan.name || plan.code}</option>
                    ))}
                  </select>
                  {editingMembershipPlanId && (
                    <button type="button" className="smallButton" onClick={() => fillMembershipPlanForm(null)}>
                      <RotateCcw size={14} /> {l("Hủy sửa", "Cancel edit")}
                    </button>
                  )}
                </div>
                <div className="inputRow">
                  <input value={membershipPlanForm.code} disabled={Boolean(editingMembershipPlanId)} onChange={(e) => setMembershipPlanForm({ ...membershipPlanForm, code: e.target.value.toUpperCase() })} placeholder="CODE: DAILY, SILVER, GOLD" />
                  <input value={membershipPlanForm.name} onChange={(e) => setMembershipPlanForm({ ...membershipPlanForm, name: e.target.value })} placeholder={l("Tên gói Pro", "Pro plan name")} />
                  <input type="number" value={membershipPlanForm.price} onChange={(e) => setMembershipPlanForm({ ...membershipPlanForm, price: e.target.value })} placeholder={t.price} />
                </div>
                <div className="inputRow">
                  <input type="number" min="1" value={membershipPlanForm.durationDays} onChange={(e) => setMembershipPlanForm({ ...membershipPlanForm, durationDays: e.target.value })} placeholder={l("Số ngày hiệu lực", "Duration days")} />
                  <input type="number" min="1" value={membershipPlanForm.dailyDownloadLimit} onChange={(e) => setMembershipPlanForm({ ...membershipPlanForm, dailyDownloadLimit: e.target.value })} placeholder={l("Quota tải/ngày", "Downloads/day")} />
                  <input value={membershipPlanForm.badge} onChange={(e) => setMembershipPlanForm({ ...membershipPlanForm, badge: e.target.value })} placeholder={l("Nhãn: HOT, BEST...", "Badge: HOT, BEST...")} />
                  <label className="adminCheckboxRow">
                    <input type="checkbox" checked={membershipPlanForm.isActive} onChange={(e) => setMembershipPlanForm({ ...membershipPlanForm, isActive: e.target.checked })} />
                    {l("Đang bán", "Active")}
                  </label>
                </div>
                <textarea
                  value={membershipPlanForm.features}
                  onChange={(e) => setMembershipPlanForm({ ...membershipPlanForm, features: e.target.value })}
                  rows={4}
                  style={{ height: "auto", minHeight: 110 }}
                  placeholder={l("Mỗi dòng là một quyền lợi Pro", "Each line is one Pro benefit")}
                />
                <button className="smallButton" disabled={!membershipPlanForm.name || !membershipPlanForm.price || !membershipPlanForm.durationDays} style={{ justifySelf: "start", minHeight: 42, padding: "0 20px" }}>
                  {editingMembershipPlanId ? <Save size={16} /> : <Plus size={16} />}
                  {editingMembershipPlanId ? l("Lưu gói Pro", "Save Pro plan") : l("Thêm gói Pro", "Add Pro plan")}
                </button>
              </form>

              <div className="packageGrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
                {membershipPlans.map((plan) => (
                  <div className="package membershipPlanCard" key={plan._id} style={{ alignItems: "stretch", padding: 16, textAlign: "left" }}>
                    <div className="packageActions">
                      <button type="button" onClick={() => fillMembershipPlanForm(plan)} title={l("Sửa gói Pro", "Edit Pro plan")}>
                        <Pencil size={15} />
                      </button>
                      <button type="button" onClick={() => deleteMembershipPlan(plan._id)} title={l("Tắt gói Pro", "Disable Pro plan")} style={{ color: "var(--error)" }}>
                        <X size={16} />
                      </button>
                    </div>
                    <span className={`badge ${plan.isActive !== false ? "success" : "error"}`}>{plan.isActive !== false ? "ACTIVE" : "OFF"}</span>
                    <h3 style={{ marginTop: 8 }}>{plan.name || plan.code}</h3>
                    <div className="priceBlock compact" style={{ alignItems: "flex-start" }}>
                      <strong>{Number(plan.price || 0).toLocaleString(locale)}đ</strong>
                    </div>
                    <span>{Number(plan.durationDays || 0).toLocaleString(locale)} {l("ngày, hết hạn cuối ngày", "days, expires end of day")}</span>
                    <span>{Number(plan.dailyDownloadLimit || 100).toLocaleString(locale)} {l("lượt tải/ngày", "downloads/day")}</span>
                    {plan.badge && <span className="badge success" style={{ alignSelf: "start" }}>{plan.badge}</span>}
                    <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                      {(Array.isArray(plan.features) && plan.features.length ? plan.features : emptyMembershipPlan.features.split("\n")).map((feature, index) => (
                        <li key={index}>{feature}</li>
                      ))}
                    </ul>
                  </div>
                ))}
                {!membershipPlans.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>{l("Chưa có gói Pro.", "No Pro plans yet.")}</p>}
              </div>
            </>
          )}
        </section>
      )}

      {activeSection === "website" && websiteSection === "articles" && (
        <AdminArticles articles={articles} onChanged={loadData} language={language} />
      )}

      {activeSection === "website" && websiteSection === "vouchers" && (
        <section className="panel adminVoucherPanel">
          <div className="adminVoucherHeading">
            <div>
              <h2><Gift size={20} /> {l("Quản lý voucher", "Manage vouchers")}</h2>
              <span>{vouchers.length} voucher</span>
            </div>
          </div>
          <div className="adminSubTabs" role="tablist" aria-label={l("Loại voucher", "Voucher type")}>
            <button type="button" className={voucherMode === "credit" ? "active" : ""} onClick={() => changeVoucherMode("credit")}>
              <CreditCard size={15} /> Credit <span>{voucherModeCounts.credit || 0}</span>
            </button>
            <button type="button" className={voucherMode === "pro" ? "active" : ""} onClick={() => changeVoucherMode("pro")}>
              <Zap size={15} /> Pro <span>{voucherModeCounts.pro || 0}</span>
            </button>
            <button type="button" className={voucherMode === "all" ? "active" : ""} onClick={() => changeVoucherMode("all")}>
              <Gift size={15} /> {l("Dùng chung", "Shared")} <span>{voucherModeCounts.all || 0}</span>
            </button>
          </div>

          <div className="adminVoucherToolbar">
            <label className="adminSearchField">
              <Search size={15} />
              <input
                value={voucherSearch}
                onChange={(event) => setVoucherSearch(event.target.value)}
                placeholder={l("Tìm mã hoặc mô tả", "Search code or description")}
              />
            </label>
            <select value={voucherStatus} onChange={(event) => setVoucherStatus(event.target.value)}>
              <option value="all">{l("Tất cả trạng thái", "All statuses")}</option>
              <option value="active">{l("Đang hoạt động", "Active")}</option>
              <option value="exhausted">{l("Hết lượt", "Exhausted")}</option>
              <option value="expired">{l("Hết hạn", "Expired")}</option>
              <option value="archived">{l("Đã lưu trữ", "Archived")}</option>
            </select>
          </div>

          <form className="voucherEditor" onSubmit={saveVoucher}>
            <div className="voucherEditorHeading">
              <h3>
                {editingVoucherId
                  ? l(`Sửa voucher ${voucherForm.code}`, `Edit voucher ${voucherForm.code}`)
                  : l(`Tạo voucher ${voucherKindLabel(voucherMode, l)}`, `Create ${voucherKindLabel(voucherMode, l)} voucher`)}
              </h3>
              <label className="voucherActiveToggle">
                <input
                  type="checkbox"
                  checked={voucherForm.isActive !== false}
                  onChange={(event) => setVoucherForm({ ...voucherForm, isActive: event.target.checked })}
                />
                <span>{l("Hoạt động", "Active")}</span>
              </label>
            </div>
            <div className="inputRow">
              <select
                value={editingVoucherId}
                onChange={(event) => {
                  const selected = vouchers.find((item) => item._id === event.target.value);
                  fillVoucherForm(selected);
                }}
              >
                <option value="">{l("Tạo voucher mới", "Create new voucher")}</option>
                {vouchers
                  .filter((voucher) => voucherMatchesMode(voucher, voucherMode))
                  .map((voucher) => (
                    <option key={voucher._id} value={voucher._id}>{voucher.code}</option>
                  ))}
              </select>
              {editingVoucherId && (
                <button type="button" className="smallButton" onClick={() => fillVoucherForm(null)}>
                  <RotateCcw size={14} /> {l("Hủy sửa", "Cancel edit")}
                </button>
              )}
            </div>
            <div className="voucherFieldGrid twoColumns">
              <label className="voucherField">
                <span>{l("Mã voucher", "Voucher code")}</span>
                <input
                  value={voucherForm.code}
                  disabled={Boolean(editingVoucherId)}
                  onChange={(event) => setVoucherForm({ ...voucherForm, code: event.target.value.toUpperCase() })}
                  placeholder="SUMMER2026"
                />
              </label>
              <label className="voucherField">
                <span>{l("Mô tả nội bộ", "Internal description")}</span>
                <input value={voucherForm.description} onChange={(event) => setVoucherForm({ ...voucherForm, description: event.target.value })} />
              </label>
            </div>
            <div className="voucherFieldGrid">
              <label className="voucherField">
                <span>{l("Giảm giá (%)", "Discount (%)")}</span>
                <input type="number" min="0" max="90" value={voucherForm.discountPercent} onChange={(event) => setVoucherForm({ ...voucherForm, discountPercent: event.target.value })} />
              </label>
              {voucherMode === "credit" && (
                <label className="voucherField">
                  <span>{l("Credit tặng thêm", "Bonus credit")}</span>
                  <input type="number" min="0" value={voucherForm.creditBonus} onChange={(event) => setVoucherForm({ ...voucherForm, creditBonus: event.target.value })} />
                </label>
              )}
              <label className="voucherField">
                <span>{l("Tổng lượt dùng", "Total uses")}</span>
                <input type="number" min="1" value={voucherForm.usageLimit} onChange={(event) => setVoucherForm({ ...voucherForm, usageLimit: event.target.value })} />
              </label>
              <label className="voucherField">
                <span>{l("Lượt mỗi tài khoản", "Uses per account")}</span>
                <input type="number" min="0" value={voucherForm.perUserLimit} onChange={(event) => setVoucherForm({ ...voucherForm, perUserLimit: event.target.value })} placeholder={l("Mặc định bằng tổng lượt", "Defaults to total uses")} />
              </label>
              <label className="voucherField">
                <span>{l("Hết hạn", "Expires at")}</span>
                <input type="datetime-local" value={voucherForm.expireAt} onChange={(event) => setVoucherForm({ ...voucherForm, expireAt: event.target.value })} />
              </label>
            </div>
            {voucherMode === "credit" ? (
              <div className="voucherPackagePicker">
                <div>
                  <strong>{l("Áp dụng cho gói Credit", "Apply to Credit packages")}</strong>
                </div>
                <div>
                  {packages.map((pkg) => {
                    const checked = voucherForm.applicablePackageIds.includes(pkg._id);
                    return (
                      <label key={pkg._id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            const nextIds = event.target.checked
                              ? [...voucherForm.applicablePackageIds, pkg._id]
                              : voucherForm.applicablePackageIds.filter((id) => id !== pkg._id);
                            setVoucherForm({ ...voucherForm, applicablePackageIds: nextIds });
                          }}
                        />
                        <span>{pkg.name || t.defaultPackageName}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="voucherScopeSummary">
                <span>{l("Phạm vi", "Scope")}</span>
                <strong>{voucherMode === "pro" ? l("Tất cả gói Pro", "All Pro plans") : l("Tất cả gói Credit và Pro", "All Credit and Pro plans")}</strong>
              </div>
            )}
            <button
              className="smallButton"
              disabled={
                !voucherForm.code ||
                !voucherForm.usageLimit ||
                !voucherForm.expireAt ||
                (voucherMode === "pro"
                  ? !voucherForm.discountPercent
                  : voucherMode === "all"
                    ? !voucherForm.discountPercent
                    : (!voucherForm.discountPercent && !voucherForm.creditBonus))
              }
              style={{ justifySelf: "start", minHeight: 42, padding: "0 20px" }}
            >
              {editingVoucherId ? <Save size={16} /> : <Gift size={16} />}
              {editingVoucherId ? l("Lưu chỉnh sửa", "Save changes") : l("Tạo voucher", "Create voucher")}
            </button>
          </form>
          {voucherMsg && <p className={voucherMsgError ? "error" : "success"}>{voucherMsg}</p>}

          <div className="voucherList">
            {visibleVouchers.map((voucher) => {
              const kind = voucherTargetKind(voucher);
              const proVoucher = kind === "pro";
              const sharedVoucher = kind === "all";
              const operationalState = voucherOperationalState(voucher);
              const statusConfig = {
                active: [l("Đang hoạt động", "Active"), "success"],
                exhausted: [l("Hết lượt", "Exhausted"), "error"],
                expired: [l("Hết hạn", "Expired"), "error"],
                archived: [l("Đã lưu trữ", "Archived"), "pending"],
              }[operationalState];
              return (
                <div className="voucherCard" key={voucher._id}>
                  <div className="voucherCardHeader">
                    <div>
                      <strong>{voucher.code} <span className={`badge ${proVoucher ? "pending" : sharedVoucher ? "" : "success"}`}>{voucherKindLabel(kind, l)}</span></strong>
                      <p>{voucher.description || t.noDescription}</p>
                    </div>
                    <span className={`badge ${statusConfig[1]}`}>
                      {statusConfig[0]}
                    </span>
                  </div>
                  <div className="voucherValue">
                    {Number(voucher.discountPercent || 0) > 0 && (
                      <div>
                        <span>{t.discount}</span>
                        <strong>-{voucher.discountPercent}%</strong>
                      </div>
                    )}
                    {Number(voucher.creditBonus || 0) > 0 && (
                      <div>
                        <span>{t.creditBonus}</span>
                        <strong>+{voucher.creditBonus} credit</strong>
                      </div>
                    )}
                  </div>
                  <div className="voucherMetaGrid">
                    <div>
                      <span>{t.used}</span>
                      <strong>{voucher.usedCount}/{voucher.usageLimit}</strong>
                    </div>
                    <div>
                      <span>{t.perAccount}</span>
                      <strong>{Number(voucher.perUserLimit ?? 1) === 0 ? t.unlimited : `${voucher.perUserLimit || 1} ${l("lượt", "uses")}`}</strong>
                    </div>
                    <div>
                      <span>{t.expires}</span>
                      <strong>{new Date(voucher.expireAt).toLocaleDateString(locale)}</strong>
                    </div>
                  </div>
                  <div className="voucherApplies">
                    <span>{t.appliesTo}</span>
                    <strong>
                      {proVoucher
                        ? l("Gói Pro / Membership", "Pro / Membership plans")
                        : sharedVoucher
                          ? l("Credit và Pro", "Credit and Pro")
                          : Array.isArray(voucher.applicablePackageIds) && voucher.applicablePackageIds.length > 0
                            ? voucher.applicablePackageIds.map((pkg) => pkg?.name || t.defaultPackageName).join(", ")
                            : t.allTopupPackages}
                    </strong>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button className="smallButton" type="button" onClick={() => fillVoucherForm(voucher)}>
                      <Pencil size={14} /> {l("Sửa voucher", "Edit voucher")}
                    </button>
                    <button className="smallButton voucherDeleteButton" type="button" onClick={() => deleteVoucher(voucher._id)}>
                      {voucher.hasTransactions || Number(voucher.usedCount || 0) > 0 ? <Archive size={14} /> : <X size={14} />}
                      {voucher.hasTransactions || Number(voucher.usedCount || 0) > 0
                        ? l("Lưu trữ", "Archive")
                        : l("Xóa", "Delete")}
                    </button>
                  </div>
                </div>
              );
            })}
            {!visibleVouchers.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>{l("Không có voucher phù hợp.", "No matching vouchers.")}</p>}
          </div>
        </section>
      )}

      {activeSection === "website" && websiteSection === "notifications" && (
        <section className="panel">
          <h2><Megaphone size={20} /> {editingNotificationId ? l("Sửa thông báo", "Edit notification") : l("Gửi thông báo", "Send notification")}</h2>
          <form className="notificationEditor" onSubmit={saveNotification} style={{ display: "grid", gap: 10, marginTop: 14 }}>
            <textarea
              className="notificationTitleInput"
              value={notificationForm.title}
              onChange={(e) => setNotificationForm({ ...notificationForm, title: e.target.value })}
              rows={2}
              placeholder={l("Tiêu đề thông báo", "Notification title")}
            />
            <div className="inputRow">
              <select
                value={notificationForm.targetType}
                onChange={(e) => setNotificationForm({ ...notificationForm, targetType: e.target.value })}
              >
                <option value="all">{l("Tất cả người dùng", "All users")}</option>
                <option value="users">{l("Theo email cụ thể", "Specific emails")}</option>
              </select>
              <select
                value={notificationForm.displayType}
                onChange={(e) => setNotificationForm({ ...notificationForm, displayType: e.target.value })}
              >
                <option value="dropdown">{l("Thông báo chuông", "Bell notification")}</option>
                <option value="fullscreen">{l("Popup phủ toàn màn hình", "Fullscreen popup")}</option>
              </select>
            </div>
            <div className="inputRow">
              <input
                type="datetime-local"
                value={notificationForm.startsAt}
                onChange={(e) => setNotificationForm({ ...notificationForm, startsAt: e.target.value })}
                title={l("Thời gian bắt đầu, có thể bỏ trống", "Start time, optional")}
              />
              <input
                type="datetime-local"
                value={notificationForm.expiresAt}
                onChange={(e) => setNotificationForm({ ...notificationForm, expiresAt: e.target.value })}
                title={l("Thời gian hết hạn, có thể bỏ trống", "Expiration time, optional")}
              />
            </div>
            {notificationForm.displayType === "fullscreen" && (
              <>
                <input
                  value={notificationForm.imageUrl}
                  onChange={(e) => setNotificationForm({ ...notificationForm, imageUrl: e.target.value })}
                  placeholder={l("URL ảnh khuyến mại / banner", "Promotion/banner image URL")}
                />
                <div className="inputRow">
                  <input
                    value={notificationForm.actionLabel}
                    onChange={(e) => setNotificationForm({ ...notificationForm, actionLabel: e.target.value })}
                    placeholder={l("Chữ nút, ví dụ: Nạp ngay", "Button text, e.g. Top up now")}
                  />
                  <input
                    value={notificationForm.actionUrl}
                    onChange={(e) => setNotificationForm({ ...notificationForm, actionUrl: e.target.value })}
                    placeholder={l("Link nút, ví dụ: /topup", "Button link, e.g. /topup")}
                  />
                </div>
              </>
            )}
            {notificationForm.targetType === "users" && (
              <textarea
                value={notificationForm.emails}
                onChange={(e) => setNotificationForm({ ...notificationForm, emails: e.target.value })}
                rows={3}
                style={{ height: "auto", minHeight: 88 }}
                placeholder={l("Nhập email người nhận, mỗi dòng hoặc cách nhau bằng dấu phẩy", "Enter recipient emails, one per line or separated by commas")}
              />
            )}
            <textarea
              value={notificationForm.body}
              onChange={(e) => setNotificationForm({ ...notificationForm, body: e.target.value })}
              rows={5}
              style={{ height: "auto", minHeight: 130 }}
              placeholder={l("Nội dung thông báo...", "Notification content...")}
            />
            <div className="inputRow" style={{ justifyContent: "start" }}>
              <button
                className="smallButton"
                disabled={!notificationForm.title || !notificationForm.body}
                style={{ justifySelf: "start", minHeight: 42, padding: "0 20px" }}
              >
                <Megaphone size={16} /> {editingNotificationId ? l("Cập nhật thông báo", "Update notification") : l("Gửi thông báo", "Send notification")}
              </button>
              {editingNotificationId && (
                <button className="smallButton" type="button" onClick={cancelNotificationEdit}>
                  <X size={14} /> {l("Hủy sửa", "Cancel edit")}
                </button>
              )}
            </div>
          </form>
          {notificationMsg && <p className={/được gửi|cập nhật|sent|updated/i.test(notificationMsg) ? "success" : "error"}>{notificationMsg}</p>}
          <div className="table">
            {notifications.map((item) => (
              <div className="tableRow" key={item._id}>
                <strong>{item.title}</strong>
                <span>
                  {item.displayType === "fullscreen" ? "Popup" : l("Chuông", "Bell")} - {item.targetType === "users"
                    ? `${item.userIds?.length || 0} ${l("người nhận", "recipients")}`
                    : l("Tất cả người dùng", "All users")}
                </span>
                <span>{item.body}</span>
                <time>{new Date(item.createdAt).toLocaleString("vi-VN")}</time>
                <div className="inputRow" style={{ justifyContent: "start" }}>
                  <button className="smallButton" onClick={() => editNotification(item)}>
                    <Pencil size={14} /> {l("Sửa", "Edit")}
                  </button>
                  <button className="smallButton" onClick={() => deleteNotification(item._id)} style={{ color: "var(--error)" }}>
                    <X size={14} /> {l("Xóa", "Delete")}
                  </button>
                </div>
              </div>
            ))}
            {!notifications.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>{t.noNotifications}</p>}
          </div>
        </section>
      )}

      {activeSection === "website" && websiteSection === "homeText" && (
        <section className="panel">
          <h2><Type size={20} /> {l("Sửa text trang chủ", "Edit homepage text")}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            {l("Các text này hiển thị ở trang chủ. Để trống dòng khuyến mại nếu không muốn hiện banner sale.", "These texts appear on the homepage. Leave promotion text empty to hide the sale banner.")}
          </p>
          <form className="homeTextEditor" onSubmit={saveHomeTextSettings}>
            {homeTextGroups.map((group) => (
              <div className="runtimeSettingGroup" key={group.title}>
                <h3>{group.title}</h3>
                <div className="homeTextGrid">
                  {group.fields.map((item) => (
                    <label className="homeTextField" key={item.field}>
                      <span>{item.label}</span>
                      {item.type === "textarea" ? (
                        <textarea
                          value={siteSettings[item.field] || ""}
                          rows={item.rows || 2}
                          onChange={(event) => updateHomeText(item.field, event.target.value)}
                        />
                      ) : (
                        <input
                          value={siteSettings[item.field] || ""}
                          onChange={(event) => updateHomeText(item.field, event.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <button className="smallButton" style={{ justifySelf: "start", minHeight: 42, padding: "0 20px" }}>
              <Save size={14} /> {l("Lưu text trang chủ", "Save homepage text")}
            </button>
            {homeTextMsg && (
              <p className={/cập nhật|updated/i.test(homeTextMsg) ? "success" : "error"}>
                {homeTextMsg}
              </p>
            )}
          </form>
        </section>
      )}

      {activeSection === "general" && generalSection === "referrals" && (
        <section className="panel">
          <h2><UserPlus size={20} /> {l("Ai đã mời ai", "Who invited whom")}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            {l("Danh sách người dùng đăng ký qua link giới thiệu cùng Pro và credit đã thưởng.", "Users who signed up through referral links and their Pro and credit rewards.")}
          </p>
          <div className="segmentedControl" style={{ marginTop: 16 }}>
            {referralModeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={siteSettings.referralMode === option.value ? "active" : ""}
                onClick={() => saveReferralSettings({ referralMode: option.value })}
              >
                {l(option.vi, option.en)}
              </button>
            ))}
          </div>
          <h3 style={{ marginTop: 18 }}>{l("Loại phần thưởng", "Reward type")}</h3>
          <div className="segmentedControl" style={{ marginTop: 10 }}>
            {referralRewardOptions.map((option) => {
              const active = Boolean(siteSettings.referralRewardCreditEnabled) === option.credit
                && Boolean(siteSettings.referralRewardProEnabled) === option.pro;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={active ? "active" : ""}
                  onClick={() => saveReferralSettings({
                    referralRewardCreditEnabled: option.credit,
                    referralRewardProEnabled: option.pro,
                  })}
                >
                  {l(option.vi, option.en)}
                </button>
              );
            })}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            {siteSettings.referralMode === "both"
              ? l("Người mời và người được mời đều nhận loại phần thưởng đã chọn.", "Both referrer and invited user receive the selected reward.")
              : siteSettings.referralMode === "referrer_only"
                ? l("Chỉ người giới thiệu nhận loại phần thưởng đã chọn.", "Only the referrer receives the selected reward.")
                : l("Ẩn thanh giới thiệu trên trang chủ và không thưởng referral mới.", "Referral invite is hidden and new referral rewards are disabled.")}
          </p>
          {referralMsg && (
            <p className={referralMsg.includes("cập nhật") || referralMsg.includes("updated") ? "success" : "error"}>
              {referralMsg}
            </p>
          )}
          <div className="table referralTable" style={{ marginTop: 16 }}>
            {referrals.map((item) => (
              <div className="tableRow" key={item._id}>
                <div>
                  <span className="muted">{l("Người mời", "Referrer")}</span>
                  <strong>{item.referrerId?.email || item.referrerId?.name || "unknown"}</strong>
                </div>
                <div>
                  <span className="muted">{l("Người được mời", "Invited user")}</span>
                  <strong>{item.referredUserId?.email || item.referredUserId?.name || "unknown"}</strong>
                </div>
                <code>{item.referralCode}</code>
                <span>
                  {`+${Number(item.referrerRewardProDays || 0)} Pro + `}
                  <CoinAmount value={item.referrerRewardCredit ?? item.rewardCredit ?? 0} prefix="+" />
                  {" / "}
                  {`+${Number(item.referredRewardProDays || 0)} Pro + `}
                  <CoinAmount value={item.referredRewardCredit ?? item.rewardCredit ?? 0} prefix="+" />
                </span>
                <time>{new Date(item.rewardedAt || item.createdAt).toLocaleString(locale)}</time>
              </div>
            ))}
            {!referrals.length && (
              <p className="muted" style={{ textAlign: "center", padding: 16 }}>
                {l("Chưa có lượt giới thiệu nào.", "No referrals yet.")}
              </p>
            )}
          </div>
        </section>
      )}

      {activeSection === "getlink" && (
        <section className="panel">
          <h2><Activity size={20} /> {l("Cài đặt Getlink", "Getlink settings")}</h2>
          <div className="segmentedControl threed66SettingsTabs" style={{ marginTop: 14 }}>
            {threed66SettingsTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={threed66SettingsTab === tab.key ? "active" : ""}
                  onClick={() => setThreed66SettingsTab(tab.key)}
                >
                  <Icon size={14} /> {tab.label}
                </button>
              );
            })}
          </div>
          {threed66SettingsTab !== "status" && (
            <form className="stack" onSubmit={saveRuntimeSettings} style={{ marginTop: 14 }}>
              {threed66SettingsTab === "tasks" && (
                <div className="runtimeSettingGroup">
                  <h3>{l("Tác vụ sang 3D66", "3D66 task settings")}</h3>
                  <div className="runtimeModeGrid" style={{ marginBottom: 12 }}>
                    {modelResolveModes.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        className={`runtimeModeButton ${siteSettings.threed66ModelResolveMode === mode.value ? "active" : ""}`}
                        aria-pressed={siteSettings.threed66ModelResolveMode === mode.value}
                        onClick={() => updateRuntimeSetting("threed66ModelResolveMode", mode.value)}
                      >
                        <strong>{mode.label}</strong>
                        <small>{mode.help}</small>
                      </button>
                    ))}
                  </div>
                  <div className="runtimeSettingList">
                    {threed66RuntimeSettings.map((setting) => (
                      <label className="runtimeSettingRow" key={setting.field}>
                        <span className="runtimeSettingText">
                          <strong>{setting.label}</strong>
                          <small>{setting.help}</small>
                        </span>
                        <input
                          type={setting.type}
                          min={setting.min}
                          max={setting.max}
                          value={siteSettings[setting.field] ?? setting.fallback}
                          placeholder={setting.placeholder}
                          onChange={(event) => updateRuntimeSetting(setting.field, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {threed66SettingsTab === "downloads" && (
                <div className="runtimeSettingGroup">
                  <h3>{l("User và tải file", "User and download settings")}</h3>
                  <div className="runtimeSettingList">
                    {userRuntimeSettings.map((setting) => (
                      <label className="runtimeSettingRow" key={setting.field}>
                        <span className="runtimeSettingText">
                          <strong>{setting.label}</strong>
                          <small>{setting.help}</small>
                        </span>
                        <input
                          type={setting.type}
                          min={setting.min}
                          max={setting.max}
                          value={siteSettings[setting.field] ?? setting.fallback}
                          onChange={(event) => updateRuntimeSetting(setting.field, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {threed66SettingsTab === "proxy" && (
                <div className="runtimeSettingGroup">
                  <h3>{l("Proxy Hong Kong", "Hong Kong proxy")}</h3>
                  <div className="runtimeSettingList">
                    <label className="runtimeSettingRow">
                      <span className="runtimeSettingText">
                        <strong>{l("Proxy URL", "Proxy URL")}</strong>
                        <small>
                          {siteSettings.threed66ProxyUrlConfigured
                            ? l("Đã cấu hình proxy URL. Nhập URL mới nếu muốn thay thế; để trống sẽ giữ nguyên.", "Proxy URL is configured. Enter a new URL to replace it; leave blank to keep it.")
                            : l("Chưa cấu hình proxy. Nhập dạng http://user:pass@host:port sau khi mua proxy.", "No proxy configured. Enter http://user:pass@host:port after buying a proxy.")}
                        </small>
                      </span>
                      <input
                        type="password"
                        value={siteSettings.threed66ProxyUrl || ""}
                        placeholder="http://user:pass@host:port"
                        autoComplete="off"
                        onChange={(event) =>
                          setSiteSettings((settings) => ({
                            ...settings,
                            threed66ProxyUrl: event.target.value,
                            threed66ProxyUrlClear: false,
                          }))
                        }
                      />
                    </label>
                    {siteSettings.threed66ProxyUrlConfigured && (
                      <button
                        type="button"
                        className="smallButton dangerButton"
                        style={{ alignSelf: "flex-start" }}
                        onClick={() =>
                          setSiteSettings((settings) => ({
                            ...settings,
                            threed66ProxyUrl: "",
                            threed66ProxyUrlConfigured: false,
                            threed66ProxyUrlClear: true,
                          }))
                        }
                      >
                        <X size={14} /> {l("Xóa proxy URL", "Clear proxy URL")}
                      </button>
                    )}
                    {proxyRuntimeSettings.map((setting) => (
                      <label className="runtimeSettingRow" key={setting.field}>
                        <span className="runtimeSettingText">
                          <strong>{setting.label}</strong>
                          <small>{setting.help}</small>
                        </span>
                        <input
                          type="checkbox"
                          checked={Boolean(siteSettings[setting.field])}
                          onChange={(event) => updateRuntimeSetting(setting.field, event.target.checked)}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {threed66SettingsTab === "playwright" && (
                <div className="runtimeSettingGroup">
                  <h3>{l("Chế độ Playwright", "Playwright mode")}</h3>
                  <div className="runtimeModeGrid">
                    {playwrightModes.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        className={`runtimeModeButton ${currentPlaywrightMode === mode.value ? "active" : ""}`}
                        aria-pressed={currentPlaywrightMode === mode.value}
                        onClick={() => setPlaywrightMode(mode.value)}
                      >
                        <strong>{mode.label}</strong>
                        <small>{mode.help}</small>
                      </button>
                    ))}
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    {l(
                      "Muốn dùng Playwright thì VPS vẫn phải cài package playwright và Chromium.",
                      "Using Playwright still requires the VPS to have the playwright package and Chromium installed."
                    )}
                  </p>
                </div>
              )}
              <p className="muted" style={{ margin: 0 }}>
                {l(
                  "Các giá trị này áp dụng ngay sau khi lưu. Paytype value dùng để chọn ví thanh toán 3D66, ví dụ value=\"4\" là 赠点. Tăng concurrency quá cao có thể làm cookie bị chặn hoặc VPS quá tải.",
                  "These values apply immediately after saving. Paytype value selects the 3D66 payment wallet, for example value=\"4\" is 赠点. Raising concurrency too high can trigger cookie blocks or overload the VPS."
                )}
              </p>
              {runtimeSettingsMsg && (
                <p className={runtimeSettingsMsg.includes("cập nhật") || runtimeSettingsMsg.includes("updated") ? "success" : "error"}>
                  {runtimeSettingsMsg}
                </p>
              )}
              <button className="smallButton" type="submit" style={{ alignSelf: "flex-start" }}>
                <Save size={14} /> {l("Lưu cài đặt Getlink", "Save Getlink settings")}
              </button>
            </form>
          )}
          {threed66SettingsTab === "status" && cookiePool && (
            <div className="cookiePoolGrid">
              <div className="cookiePoolCard">
                <span>Queue getlink</span>
                <strong>{cookiePool.queue?.getlink?.active || 0}/{cookiePool.queue?.getlink?.queued || 0}</strong>
                <small>{l("đang chạy / đang chờ", "running / queued")}</small>
              </div>
              <div className="cookiePoolCard">
                <span>Queue preview</span>
                <strong>{cookiePool.queue?.preview?.active || 0}/{cookiePool.queue?.preview?.queued || 0}</strong>
                <small>{l("đang chạy / đang chờ", "running / queued")}</small>
              </div>
              <div className="cookiePoolCard">
                <span>Queue refresh</span>
                <strong>{cookiePool.queue?.refresh?.active || 0}/{cookiePool.queue?.refresh?.queued || 0}</strong>
                <small>{l("đang chạy / đang chờ", "running / queued")}</small>
              </div>
            </div>
          )}
          {threed66SettingsTab === "status" && !cookiePool && (
            <p className="muted" style={{ marginTop: 14 }}>
              {l("Chưa có dữ liệu trạng thái 3D66.", "No 3D66 status data yet.")}
            </p>
          )}
        </section>
      )}

      {activeSection === "general" && generalSection === "cookie" && (
        <section className="panel">
          <h2><Cookie size={20} /> {l("Quản lý Cookie", "Cookie management")}</h2>
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="runtimeSettingGroup">
              <h3>{l("Cookie tài khoản nguồn", "Source account cookies")}</h3>
              <form className="inputRow" onSubmit={saveCookie}>
                <input value={cookie} onChange={(event) => setCookie(event.target.value)} placeholder={l("Dán cookie 3D66 VIP vào đây...", "Paste 3D66 VIP cookie here...")} />
                <button disabled={!cookie || loading}>
                  {loading ? <Loader2 size={16} className="spin" /> : <KeyRound size={16} />}
                  {l("Lưu", "Save")}
                </button>
                <button type="button" className="smallButton" onClick={test3D66Cookie} disabled={loading}>
                  <Check size={14} /> {l("Kiểm tra", "Check")}
                </button>
              </form>
              {message && <p className="success">{message}</p>}
            </div>
            {cookiePool && (
              <div className="cookiePoolGrid">
                <div className="cookiePoolCard">
                  <span>Active</span>
                  <strong>{cookiePool.stats?.active || 0}</strong>
                </div>
                <div className="cookiePoolCard warning">
                  <span>Warning</span>
                  <strong>{cookiePool.stats?.warning || 0}</strong>
                </div>
                <div className="cookiePoolCard error">
                  <span>{l("Cooldown / lỗi", "Cooldown / errors")}</span>
                  <strong>{(cookiePool.stats?.cooldown || 0) + (cookiePool.stats?.invalid || 0)}</strong>
                </div>
              </div>
            )}
            <div className="table" style={{ marginTop: 16 }}>
              {cookieRecords.map((item, index) => (
                <div className="tableRow" key={item._id}>
                  <span>{item.status === "cooldown" ? l("Tạm nghỉ", "Cooldown") : index === 0 ? l("Ưu tiên", "Primary") : l("Dự phòng", "Backup")}</span>
                  <code>{item.preview || "cookie"}</code>
                  <span>{item.keyCount || 0} keys</span>
                  <span className={item.hasRequiredKeys ? "success" : "error"}>
                    {item.hasRequiredKeys ? l("Đủ key", "Keys OK") : `${l("Thiếu", "Missing")}: ${(item.missingKeys || []).join(", ")}`}
                  </span>
                  <span className={item.status === "cooldown" ? "error" : item.status === "warning" ? "muted" : "success"}>
                    {item.status || "active"} · {l("lỗi", "errors")} {item.failureCount || 0} · {l("dùng", "uses")} {item.useCount || 0}
                  </span>
                  <span>
                    {item.lastTestAt
                      ? `${item.lastTestOk ? "OK" : l("Lỗi", "Error")} - ${new Date(item.lastTestAt).toLocaleString(locale)}`
                      : l("Chưa test", "Not tested")}
                  </span>
                  {item.cooldownUntil && (
                    <span className="muted">
                      {l("nghỉ tới", "cooldown until")} {new Date(item.cooldownUntil).toLocaleString(locale)}
                    </span>
                  )}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="smallButton" onClick={() => testSaved3D66Cookie(item._id)} disabled={loading}>
                      <Check size={14} /> Test
                    </button>
                    <button type="button" className="smallButton" onClick={() => delete3D66Cookie(item._id)} style={{ color: "var(--error)" }}>
                      <X size={14} /> {l("Xóa", "Delete")}
                    </button>
                  </div>
                </div>
              ))}
              {!cookieRecords.length && (
                <p className="muted" style={{ textAlign: "center", padding: 16 }}>
                  {l("Chưa lưu cookie nào.", "No cookies saved yet.")}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

      {activeSection === "general" && generalSection === "logs" && (
        <section className="panel">
          <h2><AlertTriangle size={20} /> {l("Log lỗi getlink / tải file", "Getlink / download error logs")}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            {l("Hiển thị 100 lỗi mới nhất để kiểm tra cookie, queue, tải file và request getlink.", "Shows the latest 100 errors for checking cookies, queue, downloads, and getlink requests.")}
          </p>
          <div className="table logTable" style={{ marginTop: 16 }}>
            {systemLogs.map((item) => (
              <div className="tableRow" key={item._id}>
                <span className={`badge ${item.level === "error" ? "error" : item.level === "warn" ? "pending" : "success"}`}>
                  {item.type}
                </span>
                <div className="logUserIdentity" title={item.user?.email || String(item.userId || "")}>
                  <strong>{item.user?.email || l("Không có user", "No user")}</strong>
                  {item.user?.name && <span>{item.user.name}</span>}
                </div>
                <div className="logMessageDetails">
                  <strong>{item.message}</strong>
                  {(item.details?.expectedProductIds?.length || item.details?.footprintProductIds?.length) && (
                    <small>
                      Expected: {(item.details.expectedProductIds || []).join(", ") || "-"}
                      {" | "}Footprint: {(item.details.footprintProductIds || []).join(", ") || "-"}
                      {item.details.footprintRefreshAttempts
                        ? ` | Refresh: ${item.details.footprintRefreshAttempts}`
                        : ""}
                    </small>
                  )}
                </div>
                <span>{item.productId || item.historyId || "system"}</span>
                <span>{item.status ? `HTTP ${item.status}` : item.level}</span>
                <time>{new Date(item.createdAt).toLocaleString(locale)}</time>
              </div>
            ))}
            {!systemLogs.length && (
              <p className="muted" style={{ textAlign: "center", padding: 16 }}>
                {l("Chưa có log lỗi.", "No error logs yet.")}
              </p>
            )}
          </div>
        </section>
      )}

      {activeSection === "general" && generalSection === "audit" && (
        <section className="panel">
          <h2><HistoryIcon size={20} /> {l("Nhật ký thao tác admin", "Admin audit log")}</h2>
          <div className="adminTableToolbar" style={{ marginTop: 14 }}>
            <label className="adminSearchField">
              <Search size={15} />
              <input
                value={auditSearch}
                onChange={(event) => {
                  setAuditSearch(event.target.value);
                  setAuditPage(1);
                }}
                placeholder={l("Tìm action, admin hoặc đối tượng", "Search action, admin, or target")}
              />
            </label>
          </div>
          <div className="table logTable" style={{ marginTop: 16 }}>
            {auditLogs.map((item) => (
              <div className="tableRow" key={item._id}>
                <span className={`badge ${Number(item.statusCode || 200) >= 400 ? "error" : "success"}`}>
                  {item.action}
                </span>
                <strong>{item.actor?.email || item.actorEmail || "admin"}</strong>
                <span>{item.target || item.targetId || "system"}</span>
                <span>HTTP {item.statusCode || 200}</span>
                <time>{new Date(item.createdAt).toLocaleString(locale)}</time>
              </div>
            ))}
            {!auditLogs.length && (
              <p className="muted" style={{ textAlign: "center", padding: 16 }}>
                {l("Chưa có nhật ký phù hợp.", "No matching audit entries.")}
              </p>
            )}
          </div>
          <Pagination
            page={auditPagination.page}
            totalPages={auditPagination.totalPages}
            total={auditPagination.total}
            onPageChange={setAuditPage}
            language={language}
            itemLabel={l("nhật ký", "logs")}
          />
        </section>
      )}

      {activeSection === "general" && generalSection === "downloads" && (
        <AdminDownloadHistory
          language={language}
          getlinkRecords={getlinkRecords}
          getlinkSearch={getlinkSearch}
          onGetlinkSearchChange={(value) => {
            setGetlinkSearch(value);
            setGetlinkPage(1);
          }}
          getlinkPagination={getlinkPagination}
          onGetlinkPageChange={setGetlinkPage}
        />
      )}

      {activeSection === "general" && generalSection === "topups" && (
        <section className="panel">
          <h2><CreditCard size={20} /> {l("Giao dịch Credit / Pro", "Credit / Pro transactions")}</h2>
          <div className="adminSubTabs" role="tablist" aria-label={l("Loại giao dịch", "Transaction type")}>
            {[
              ["credit", "Credit", CreditCard],
              ["pro", "Pro", Zap],
              ["all", l("Tất cả", "All"), Wallet],
            ].map(([kind, label, Icon]) => (
              <button
                key={kind}
                type="button"
                className={transactionKind === kind ? "active" : ""}
                onClick={() => {
                  setTransactionKind(kind);
                  setTopupPage(1);
                  setTransactionMsg("");
                }}
              >
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
          <div className="adminTableToolbar">
            <label className="adminSearchField">
              <Search size={15} />
              <input
                value={topupSearch}
                onChange={(event) => {
                  setTopupSearch(event.target.value);
                  setTopupPage(1);
                }}
                placeholder={l("Tìm email, tên gói hoặc mã giao dịch", "Search email, package, or transaction code")}
              />
            </label>
            <select
              value={topupStatus}
              onChange={(event) => {
                setTopupStatus(event.target.value);
                setTopupPage(1);
              }}
              aria-label={l("Lọc trạng thái nạp", "Filter top-up status")}
            >
              <option value="approved">{l("Thành công", "Approved")}</option>
              <option value="pending">{l("Chờ thanh toán", "Pending")}</option>
              <option value="rejected">{l("Đã hủy / từ chối", "Rejected")}</option>
              <option value="all">{l("Tất cả trạng thái", "All statuses")}</option>
            </select>
          </div>
          {transactionMsg && <p className={transactionMsgError ? "error" : "success"}>{transactionMsg}</p>}
          <div className="table topupAuditTable" style={{ marginTop: 16 }}>
            {topupRecords.map((item) => (
              <div className="tableRow" key={item.id || item._id}>
                <div className="topupAuditIdentity">
                  <strong>{item.user?.email || l("Không rõ user", "Unknown user")}</strong>
                  <span>{item.user?.name || item.userId || ""}</span>
                </div>
                <div className="topupAuditPackage">
                  <strong>{item.title || item.package?.name || l("Gói đã bị xóa", "Deleted package")}</strong>
                  <span>{item.kind === "pro" ? "PRO" : "CREDIT"} · {item.gatewayProvider || item.type || "auto"}</span>
                  {item.kind === "pro" && (
                    <code>
                      {item.isQuotaAddon
                        ? l(`Addon +${Number(item.quotaBoostAmount || 0).toLocaleString(locale)} lượt hôm nay`, `Addon +${Number(item.quotaBoostAmount || 0).toLocaleString(locale)} today`)
                        : l(`${Number(item.durationDays || 0).toLocaleString(locale)} ngày · ${Number(item.dailyDownloadLimit || 0).toLocaleString(locale)} lượt/ngày`, `${Number(item.durationDays || 0).toLocaleString(locale)} days · ${Number(item.dailyDownloadLimit || 0).toLocaleString(locale)} downloads/day`)}
                    </code>
                  )}
                  {item.voucherCode && <code>{l("Voucher", "Voucher")}: {item.voucherCode}</code>}
                </div>
                <span className={`badge ${item.status === "approved" ? "success" : item.status === "pending" ? "pending" : "error"}`}>
                  {item.status === "approved"
                    ? l("Thành công", "Approved")
                    : item.status === "pending"
                      ? l("Chờ thanh toán", "Pending")
                      : l("Đã hủy", "Rejected")}
                </span>
                <div className="topupAuditAmount">
                  <strong>{formatMoney(item.amount)}</strong>
                  {Number(item.discountAmount || 0) > 0 && (
                    <span>{l("Giảm", "Discount")}: {formatMoney(item.discountAmount)}</span>
                  )}
                </div>
                {item.kind === "pro" ? (
                  <strong>{item.isQuotaAddon ? `+${Number(item.quotaBoostAmount || 0).toLocaleString(locale)} ${l("lượt", "downloads")}` : `${Number(item.durationDays || 0).toLocaleString(locale)} ${l("ngày", "days")}`}</strong>
                ) : (
                  <strong>
                    <CoinAmount
                      value={Math.abs(Number(item.credit || 0)).toLocaleString(locale)}
                      prefix={Number(item.credit || 0) > 0 ? "+" : Number(item.credit || 0) < 0 ? "-" : ""}
                    />
                  </strong>
                )}
                <div className="topupAuditPayment">
                  <code>{item.paymentCode || item.gatewayTransactionId || "-"}</code>
                  {item.rejectionReason && <span className="error">{item.rejectionReason}</span>}
                </div>
                <time>{new Date(item.paidAt || item.createdAt).toLocaleString(locale)}</time>
                {item.status === "pending" && (
                  <div className="adminUserActions">
                    <button type="button" className="smallButton" disabled={reviewingTransactionId === (item.id || item.rawId)} onClick={() => reviewTransaction(item, "approve")}>
                      <Check size={14} /> {l("Duyệt", "Approve")}
                    </button>
                    <button type="button" className="smallButton dangerButton" disabled={reviewingTransactionId === (item.id || item.rawId)} onClick={() => reviewTransaction(item, "cancel")}>
                      <X size={14} /> {l("Hủy", "Cancel")}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!topupRecords.length && (
              <p className="muted" style={{ textAlign: "center", padding: 16 }}>
                {l("Không có lịch sử nạp phù hợp.", "No matching top-up history.")}
              </p>
            )}
          </div>
          <Pagination
            page={topupPagination.page}
            totalPages={topupPagination.totalPages}
            total={topupPagination.total}
            onPageChange={setTopupPage}
            language={language}
            itemLabel={l("giao dịch", "transactions")}
          />
        </section>
      )}

      {activeSection === "general" && generalSection === "users" && (
        <section className="panel">
          <h2><Users size={20} /> {l("Quản lý người dùng", "Manage users")}</h2>
          <div className="adminTableToolbar">
            <label className="adminSearchField">
              <Search size={15} />
              <input
                value={userSearch}
                onChange={(event) => {
                  setUserSearch(event.target.value);
                  setUserPage(1);
                }}
                placeholder={l("Tìm theo tên hoặc email", "Search by name or email")}
              />
            </label>
            <select
              value={userFilter}
              onChange={(event) => {
                setUserFilter(event.target.value);
                setUserPage(1);
              }}
              aria-label={l("Lọc người dùng", "Filter users")}
            >
              <option value="all">{l("Tất cả tài khoản", "All accounts")}</option>
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="admin">Admin</option>
              <option value="banned">{l("Đã khóa", "Banned")}</option>
            </select>
            <select
              value={userSort}
              onChange={(event) => {
                setUserSort(event.target.value);
                setUserPage(1);
              }}
              aria-label={l("Sắp xếp người dùng", "Sort users")}
            >
              <option value="created-desc">{l("Mới đăng ký trước", "Newest first")}</option>
              <option value="created-asc">{l("Cũ đăng ký trước", "Oldest first")}</option>
              <option value="credit-desc">{l("Credit cao trước", "Highest credit")}</option>
              <option value="credit-asc">{l("Credit thấp trước", "Lowest credit")}</option>
              <option value="pro-desc">{l("Hạn Pro xa nhất", "Latest Pro expiry")}</option>
              <option value="pro-asc">{l("Hạn Pro gần nhất", "Earliest Pro expiry")}</option>
              <option value="email-asc">{l("Email A-Z", "Email A-Z")}</option>
              <option value="email-desc">{l("Email Z-A", "Email Z-A")}</option>
            </select>
          </div>

          {userDetail && (
            <div className="userDetailPanel">
              <div className="userCreditHistoryHeader">
                <div>
                  <h3>{l("Chi tiết user", "User detail")}</h3>
                  <strong>{userDetail.user?.email}</strong>
                  <span>{userDetail.user?.name || ""} - {userDetail.user?.role || "user"}</span>
                </div>
                <button
                  type="button"
                  className="smallButton"
                  onClick={() => {
                    setUserDetail(null);
                    setUserQuota(null);
                    setUserTimeline([]);
                    setUserDetailMsg("");
                  }}
                >
                  <X size={14} /> {l("Đóng", "Close")}
                </button>
              </div>

              {userDetailMsg && <p className={userDetailMsg.includes("Đã") || userDetailMsg.includes("updated") || userDetailMsg.includes("cleared") ? "success" : "error"}>{userDetailMsg}</p>}
              {userDetailLoading && <p className="muted">{l("Đang tải thông tin user...", "Loading user detail...")}</p>}

              <div className="adminDetailGrid">
                <div className="adminDetailCard">
                  <span>{l("Số dư", "Balance")}</span>
                  <strong><CoinAmount value={Number(userDetail.user?.credit || 0).toLocaleString(locale)} /></strong>
                  <small>{userDetail.user?.isBanned ? l("Đang bị ban getlink", "Banned from getlink") : l("Tài khoản hoạt động", "Active account")}</small>
                </div>
                <div className="adminDetailCard">
                  <span>Pro</span>
                  <strong>{userDetail.user?.isPro ? l("Đang hoạt động", "Active") : l("Chưa kích hoạt", "Inactive")}</strong>
                  <small>{userDetail.user?.proUntil ? new Date(userDetail.user.proUntil).toLocaleString(locale) : l("Chưa có hạn Pro", "No Pro expiry")}</small>
                </div>
                <div className="adminDetailCard">
                  <span>{l("Quota tải hôm nay", "Download quota today")}</span>
                  <strong>
                    {Number(userQuota?.downloads?.used || 0).toLocaleString(locale)}/{Number(userQuota?.downloads?.limit || 0).toLocaleString(locale)}
                  </strong>
                  <small>
                    {l("Còn", "Remaining")} {Number(userQuota?.downloads?.remaining || 0).toLocaleString(locale)}
                    {Number(userQuota?.downloads?.bonusLimit || 0) > 0 ? ` +${Number(userQuota.downloads.bonusLimit).toLocaleString(locale)} addon` : ""}
                  </small>
                </div>
                <div className="adminDetailCard">
                  <span>{l("Tìm ảnh hôm nay", "Image search today")}</span>
                  <strong>
                    {Number(userQuota?.imageSearch?.used || 0).toLocaleString(locale)}/{Number(userQuota?.imageSearch?.limit || 0).toLocaleString(locale)}
                  </strong>
                  <small>{userQuota?.resetAt ? `${l("Reset", "Reset")} ${new Date(userQuota.resetAt).toLocaleString(locale)}` : ""}</small>
                </div>
              </div>

              <form className="adminInlineForm" onSubmit={saveUserProAdjust}>
                <div>
                  <strong>{l("Chỉnh Pro thủ công", "Manual Pro adjustment")}</strong>
                  <span>{l("Dùng khi cần hỗ trợ user hoặc xử lý đơn Pro lỗi webhook.", "Use for support or failed Pro webhook cases.")}</span>
                </div>
                <input
                  type="date"
                  value={proAdjustForm.proUntil}
                  onChange={(e) => setProAdjustForm({ ...proAdjustForm, proUntil: e.target.value })}
                  title={l("Ngày hết hạn Pro", "Pro expiry")}
                />
                <input
                  type="number"
                  min="0"
                  value={proAdjustForm.proDailyDownloadLimit}
                  onChange={(e) => setProAdjustForm({ ...proAdjustForm, proDailyDownloadLimit: e.target.value })}
                  placeholder={l("Lượt tải/ngày", "Downloads/day")}
                />
                <button className="smallButton" type="submit"><Save size={14} /> {l("Lưu Pro", "Save Pro")}</button>
                <button className="smallButton dangerButton" type="button" onClick={clearUserPro}><X size={14} /> {l("Gỡ Pro", "Clear Pro")}</button>
              </form>

              <div className="adminDetailGrid compact">
                {[
                  ["getlinks", l("Getlink", "Getlinks")],
                  ["topups", l("Nạp credit", "Credit top-ups")],
                  ["proOrders", l("Đơn Pro", "Pro orders")],
                  ["modelDownloads", l("Tải model", "Model downloads")],
                  ["sceneDownloads", l("Tải scene", "Scene downloads")]
                ].map(([key, label]) => (
                  <div className="adminDetailCard" key={key}>
                    <span>{label}</span>
                    <strong>{Number(userDetail.stats?.[key] || 0).toLocaleString(locale)}</strong>
                  </div>
                ))}
              </div>

              <div className="adminTimelineFilterGroups" aria-label={l("Lọc timeline user", "Filter user timeline")}>
                {[
                  [l("Tổng quan", "Overview"), [["all", l("Tất cả", "All")]]],
                  [l("Thanh toán", "Payments"), [["credit", "Credit"], ["pro", "Pro"], ["voucher", "Voucher"]]],
                  [l("Hoạt động", "Activity"), [["getlink", "Getlink"], ["model", "Model"], ["scene", "Scene"], ["referral", l("Giới thiệu", "Referral")]]],
                ].map(([groupLabel, filters]) => (
                  <div key={groupLabel}>
                    <span>{groupLabel}</span>
                    <div className="adminSubTabs" role="tablist">
                      {filters.map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          className={userTimelineType === key ? "active" : ""}
                          onClick={() => loadUserDetail(userDetail.user, key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="adminTimelineList">
                {userTimeline.map((event) => (
                  <div className="adminTimelineItem" key={event.id}>
                    <span className={`badge ${timelineStatusClass(event.status)}`}>{timelineTypeLabel(event.type, l)}</span>
                    <div>
                      <strong>{event.title}</strong>
                      <small>
                        {timelineStatusLabel(event.status, l)} · {event.createdAt ? new Date(event.createdAt).toLocaleString(locale) : ""}
                        {event.metadata?.paymentCode ? ` · ${event.metadata.paymentCode}` : ""}
                        {event.metadata?.voucherCode ? ` · Voucher ${event.metadata.voucherCode}` : ""}
                      </small>
                    </div>
                    <strong className={Number(event.amount || 0) > 0 ? "successText" : Number(event.amount || 0) < 0 ? "errorText" : ""}>
                      {adminTimelineAmount(event, locale, l)}
                    </strong>
                  </div>
                ))}
                {!userTimeline.length && <p className="muted">{l("Chưa có lịch sử phù hợp.", "No matching history yet.")}</p>}
              </div>
            </div>
          )}

          <div className="table adminUserTable">
            {users.map((user) => (
              <div className="tableRow" key={user._id}>
                <div className="adminUserIdentity">
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                  <span className={`badge ${user.isPro ? "success" : ""}`}>
                    {user.isPro ? `PRO · ${new Date(user.proUntil).toLocaleDateString(locale)}` : "FREE"}
                  </span>
                  {user.isBanned && (
                    <p className="error" style={{ margin: "4px 0 0", fontSize: 12 }}>
                      {l("Đang bị ban", "Banned")}: {user.banReason || l("Không có lý do", "No reason")}
                    </p>
                  )}
                </div>
                {editUser === user._id ? (
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="number" value={editCredit} onChange={(e) => setEditCredit(e.target.value)} style={{ minHeight: 34, width: 90, padding: "0 8px" }} />
                    <button className="smallButton" onClick={() => saveUserCredit(user._id)}>{l("Lưu", "Save")}</button>
                    <button className="smallButton" onClick={() => setEditUser(null)}>{l("Hủy", "Cancel")}</button>
                  </div>
                ) : (
                  <>
                    <strong onClick={() => { setEditUser(user._id); setEditCredit(user.credit); }} style={{ cursor: "pointer" }}>
                      <CoinAmount value={user.credit} />
                    </strong>
                    <button className="smallButton" onClick={() => addCredit(user._id)}>
                      <Plus size={14} /> <CoinAmount value={1} prefix="+" />
                    </button>
                  </>
                )}
                <div className="adminUserActions">
                  <button className="smallButton" onClick={() => loadUserDetail(user)}>
                    <Users size={14} /> {l("Chi tiết", "Detail")}
                  </button>
                </div>
                {user.role !== "admin" && (
                  <div className="banUserControls">
                    {!user.isBanned && (
                      <input
                        value={banReasonByUser[user._id] || ""}
                        onChange={(event) =>
                          setBanReasonByUser({
                            ...banReasonByUser,
                            [user._id]: event.target.value,
                          })
                        }
                        placeholder={l("Lý do ban", "Ban reason")}
                      />
                    )}
                    <button
                      type="button"
                      className={`smallButton ${user.isBanned ? "" : "dangerButton"}`}
                      onClick={() => toggleBanUser(user)}
                    >
                      {user.isBanned ? <Check size={14} /> : <Ban size={14} />}
                      {user.isBanned ? l("Gỡ ban", "Unban") : l("Ban getlink", "Ban getlink")}
                    </button>
                  </div>
                )}
              </div>
            ))}
            {!users.length && <p className="muted" style={{ textAlign: "center", padding: 24 }}>{l("Chưa có người dùng.", "No users yet.")}</p>}
          </div>
          <Pagination
            page={userPagination.page}
            totalPages={userPagination.totalPages}
            total={userPagination.total}
            onPageChange={setUserPage}
            language={language}
            itemLabel={l("người dùng", "users")}
          />
        </section>
      )}

      {activeSection === "general" && generalSection === "security" && (
        <section className="panel">
          <h2><ShieldAlert size={20} /> {l("Cài đặt bảo mật (2FA)", "Security settings (2FA)")}</h2>

          {user?.isTwoFactorEnabled ? (
            <div className="emptyState" style={{ marginTop: 20 }}>
              <div className="badge success" style={{ marginBottom: 16 }}>{l("Đã kích hoạt 2FA", "2FA enabled")}</div>
              <p>{l("Tài khoản của bạn đã được bảo vệ bằng mã xác thực 2 lớp (Google Authenticator).", "Your account is protected with two-factor authentication (Google Authenticator).")}</p>
            </div>
          ) : (
            <div style={{ marginTop: 20 }}>
              <p className="muted" style={{ marginBottom: 20 }}>
                {l("Kích hoạt Xác minh 2 Bước để bảo vệ tài khoản quản trị. Khi đăng nhập, bạn sẽ cần nhập mã gồm 6 chữ số từ ứng dụng trên điện thoại.", "Enable two-step verification to protect the admin account. When signing in, you will need to enter a 6-digit code from the phone app.")}
              </p>

              {!twoFactorQr ? (
                <button onClick={handleGenerate2FA} disabled={loading}>
                  {loading ? <Loader2 className="spin" size={16} /> : <ShieldAlert size={16} />} {l("Bắt đầu thiết lập 2FA", "Start 2FA setup")}
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 400 }}>
                  <div style={{ background: "#fff", padding: 16, borderRadius: 8, alignSelf: "flex-start" }}>
                    <img src={twoFactorQr} alt="QR Code" style={{ width: 200, height: 200, display: "block" }} />
                  </div>
                  <div className="muted">
                    <p>{l("1. Mở ứng dụng Google Authenticator hoặc Authy.", "1. Open Google Authenticator or Authy.")}</p>
                    <p>{l("2. Quét mã QR bên trên, hoặc nhập tay mã bảo mật:", "2. Scan the QR code above, or manually enter the secret:")} <code>{twoFactorSecret}</code></p>
                    <p>{l("3. Nhập mã 6 chữ số xuất hiện trên ứng dụng vào ô dưới đây để hoàn tất.", "3. Enter the 6-digit code shown in the app below to finish.")}</p>
                  </div>
                  <form onSubmit={handleEnable2FA} style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="123456"
                      maxLength={6}
                      value={twoFactorToken}
                      onChange={(e) => setTwoFactorToken(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                      style={{ fontSize: 18, letterSpacing: 4, width: 150, textAlign: "center" }}
                    />
                    <button disabled={loading || twoFactorToken.length < 6}>
                      {l("Xác nhận bật", "Confirm enable")}
                    </button>
                  </form>
                </div>
              )}
              {twoFactorMsg && <p className={twoFactorMsg.includes("thành công") || twoFactorMsg.includes("successfully") ? "success" : "error"} style={{ marginTop: 16 }}>{twoFactorMsg}</p>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
