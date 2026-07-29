import SiteSetting from "../models/SiteSetting.js";
import { decryptSecret, encryptSecret } from "../utils/secretBox.js";
import { limitedString, rejectUnknownKeys, sanitizeHtml } from "../utils/validators.js";

const REFERRAL_MODES = ["both", "referrer_only", "off"];
const THREED66_MODEL_RESOLVE_MODES = ["search", "footprint", "direct"];
const HOME_TEXT_FIELDS = [
  "heroText",
  "heroSubtitle",
  "heroEyebrow",
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
const HOME_TEXT_DEFAULTS = {
  heroText: "SIÊU RẺ\nTẢI 3D\nTỐC ĐỘ",
  heroSubtitle: "Dịch vụ getlink trung gian giúp bạn tải model 3D với giá rẻ hơn mua trực tiếp.",
  heroEyebrow: "+ api 3d sdk",
  saleText: "Khuyến mãi gói PRO trong tháng này",
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
};

function normalizePublicBrandText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)*3d66\.com/gi, "3D")
    .replace(/3d66/gi, "3D");
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return fallback;
}

const RUNTIME_BOOLEAN_FIELDS = {
  threed66BrowserAlways: {
    env: "THREED66_BROWSER_ALWAYS",
    fallback: normalizeBoolean(process.env.THREED66_BROWSER_ALWAYS, false),
  },
  threed66DisableBrowserPageFallback: {
    env: "THREED66_DISABLE_BROWSER_PAGE_FALLBACK",
    fallback: normalizeBoolean(process.env.THREED66_DISABLE_BROWSER_PAGE_FALLBACK, false),
  },
  threed66DisableBrowserDownloadFallback: {
    env: "THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK",
    fallback: normalizeBoolean(process.env.THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK, false),
  },
  threed66DownloadHandleBrowserFallback: {
    env: "THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK",
    fallback: normalizeBoolean(process.env.THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK, false),
  },
  threed66ProxyEnabled: {
    env: "THREED66_PROXY_ENABLED",
    fallback: normalizeBoolean(process.env.THREED66_PROXY_ENABLED, false),
  },
  threed66ProxyForPreview: {
    env: "THREED66_PROXY_FOR_PREVIEW",
    fallback: normalizeBoolean(process.env.THREED66_PROXY_FOR_PREVIEW, false),
  },
  threed66ProxyForApi: {
    env: "THREED66_PROXY_FOR_API",
    fallback: normalizeBoolean(process.env.THREED66_PROXY_FOR_API, false),
  },
  threed66ProxyForDownload: {
    env: "THREED66_PROXY_FOR_DOWNLOAD",
    fallback: normalizeBoolean(process.env.THREED66_PROXY_FOR_DOWNLOAD, false),
  },
  threed66ProxyForBrowser: {
    env: "THREED66_PROXY_FOR_BROWSER",
    fallback: normalizeBoolean(process.env.THREED66_PROXY_FOR_BROWSER, false),
  },
  threed66ProxyFailClosed: {
    env: "THREED66_PROXY_FAIL_CLOSED",
    fallback: normalizeBoolean(process.env.THREED66_PROXY_FAIL_CLOSED, false),
  },
};
const RUNTIME_NUMBER_FIELDS = {
  threed66GetlinkConcurrency: {
    env: "THREED66_GETLINK_CONCURRENCY",
    min: 1,
    max: 10,
    fallback: 1,
  },
  threed66PreviewConcurrency: {
    env: "THREED66_PREVIEW_CONCURRENCY",
    min: 1,
    max: 10,
    fallback: 1,
  },
  threed66RefreshConcurrency: {
    env: "THREED66_REFRESH_CONCURRENCY",
    min: 1,
    max: 10,
    fallback: 1,
  },
  threed66RequestIntervalMs: {
    env: "THREED66_REQUEST_INTERVAL_MS",
    min: 0,
    max: 60000,
    fallback: 2500,
  },
  threed66BrowserConcurrency: {
    env: "THREED66_BROWSER_CONCURRENCY",
    min: 1,
    max: 5,
    fallback: 1,
  },
  threed66TimeoutMs: {
    env: "THREED66_TIMEOUT_MS",
    min: 5000,
    max: 120000,
    fallback: 30000,
  },
  threed66CookieMaxFailures: {
    env: "THREED66_COOKIE_MAX_FAILURES",
    min: 1,
    max: 20,
    fallback: 2,
  },
  threed66CookieCooldownMinutes: {
    env: "THREED66_COOKIE_COOLDOWN_MS",
    min: 1,
    max: 1440,
    fallback: 30,
    toEnv: (minutes) => minutes * 60 * 1000,
  },
  maxGlobalDownloads: {
    env: "MAX_GLOBAL_DOWNLOADS",
    min: 1,
    max: 200,
    fallback: 20,
  },
  maxDownloadsPerUser: {
    env: "MAX_DOWNLOADS_PER_USER",
    min: 1,
    max: 50,
    fallback: 2,
  },
  maxDownloadsPerIp: {
    env: "MAX_DOWNLOADS_PER_IP",
    min: 1,
    max: 100,
    fallback: 4,
  },
  getlinkRedownloadDays: {
    env: "GETLINK_REDOWNLOAD_DAYS",
    min: 1,
    max: 30,
    fallback: 3,
  },
  getlinkRedownloadLimit: {
    env: "GETLINK_REDOWNLOAD_LIMIT",
    min: 1,
    max: 100,
    fallback: 5,
  },
};

const RETENTION_NUMBER_FIELDS = {
  getlinkDetailRetentionDaysAfterExpiry: { fallback: 1, minActive: 1 },
  getlinkHistoryRetentionDaysAfterExpiry: { fallback: 365, minActive: 30 },
  marketplaceDownloadHistoryRetentionDays: { fallback: 365, minActive: 30 },
  marketplaceReportHistoryRetentionDays: { fallback: 365, minActive: 30 },
  auditLogHistoryRetentionDays: { fallback: 365, minActive: 30 },
};

const defaultSettings = {
  key: "homepage",
  heroText: "SIEU RE\nTAI 3D\nTOC DO",
  heroSubtitle:
    "Dich vu getlink trung gian giup ban tai model 3D voi gia re hon mua truc tiep.",
  heroEyebrow: "+ api 3d sdk",
  saleText: "Khuyen mai goi PRO trong thang nay",
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
  referralMode: "both",
  threed66GetlinkConcurrency: Number(process.env.THREED66_GETLINK_CONCURRENCY || 1),
  threed66PreviewConcurrency: Number(process.env.THREED66_PREVIEW_CONCURRENCY || 1),
  threed66RefreshConcurrency: Number(process.env.THREED66_REFRESH_CONCURRENCY || 1),
  threed66PaytypeValue: String(process.env.THREED66_PAYTYPE_VALUE || "4"),
  threed66ModelResolveMode: THREED66_MODEL_RESOLVE_MODES.includes(
    String(process.env.THREED66_MODEL_RESOLVE_MODE || "").trim().toLowerCase(),
  )
    ? String(process.env.THREED66_MODEL_RESOLVE_MODE).trim().toLowerCase()
    : "search",
  threed66RequestIntervalMs: Number(process.env.THREED66_REQUEST_INTERVAL_MS || 2500),
  threed66BrowserConcurrency: Number(process.env.THREED66_BROWSER_CONCURRENCY || 1),
  threed66BrowserAlways: RUNTIME_BOOLEAN_FIELDS.threed66BrowserAlways.fallback,
  threed66DisableBrowserPageFallback: RUNTIME_BOOLEAN_FIELDS.threed66DisableBrowserPageFallback.fallback,
  threed66DisableBrowserDownloadFallback: RUNTIME_BOOLEAN_FIELDS.threed66DisableBrowserDownloadFallback.fallback,
  threed66DownloadHandleBrowserFallback: RUNTIME_BOOLEAN_FIELDS.threed66DownloadHandleBrowserFallback.fallback,
  threed66ProxyEnabled: RUNTIME_BOOLEAN_FIELDS.threed66ProxyEnabled.fallback,
  threed66ProxyUrl: process.env.THREED66_PROXY_URL ? encryptSecret(process.env.THREED66_PROXY_URL) : "",
  threed66ProxyForPreview: RUNTIME_BOOLEAN_FIELDS.threed66ProxyForPreview.fallback,
  threed66ProxyForApi: RUNTIME_BOOLEAN_FIELDS.threed66ProxyForApi.fallback,
  threed66ProxyForDownload: RUNTIME_BOOLEAN_FIELDS.threed66ProxyForDownload.fallback,
  threed66ProxyForBrowser: RUNTIME_BOOLEAN_FIELDS.threed66ProxyForBrowser.fallback,
  threed66ProxyFailClosed: RUNTIME_BOOLEAN_FIELDS.threed66ProxyFailClosed.fallback,
  threed66TimeoutMs: Number(process.env.THREED66_TIMEOUT_MS || 30000),
  threed66CookieMaxFailures: Number(process.env.THREED66_COOKIE_MAX_FAILURES || 2),
  threed66CookieCooldownMinutes: Math.round(Number(process.env.THREED66_COOKIE_COOLDOWN_MS || 1800000) / 60000),
  maxGlobalDownloads: Number(process.env.MAX_GLOBAL_DOWNLOADS || 20),
  maxDownloadsPerUser: Number(process.env.MAX_DOWNLOADS_PER_USER || 2),
  maxDownloadsPerIp: Number(process.env.MAX_DOWNLOADS_PER_IP || 4),
  getlinkRedownloadDays: Number(process.env.GETLINK_REDOWNLOAD_DAYS || 3),
  getlinkRedownloadLimit: Number(process.env.GETLINK_REDOWNLOAD_LIMIT || 5),
  getlinkDetailRetentionDaysAfterExpiry: 1,
  getlinkHistoryRetentionDaysAfterExpiry: 365,
  marketplaceDownloadHistoryRetentionDays: 365,
  marketplaceReportHistoryRetentionDays: 365,
  auditLogHistoryRetentionDays: 365,
};

Object.assign(defaultSettings, HOME_TEXT_DEFAULTS);

let settingsCache = null;

function settingsSnapshot(settings = {}) {
  const plain = settings?.toObject ? settings.toObject() : { ...settings };
  return {
    ...defaultSettings,
    ...plain,
  };
}

function rawSettingValue(settings = {}, field = "") {
  const raw = settings?.toObject ? settings.toObject({ defaults: false }) : settings;
  return Object.prototype.hasOwnProperty.call(raw || {}, field) ? raw[field] : undefined;
}

function decryptProxyUrl(value = "") {
  try {
    return decryptSecret(value || "");
  } catch {
    return "";
  }
}

function proxyUrlConfigured(settings = {}) {
  const stored = rawSettingValue(settings, "threed66ProxyUrl");
  if (stored !== undefined) return Boolean(decryptProxyUrl(stored));
  return Boolean(String(process.env.THREED66_PROXY_URL || "").trim());
}

function isVerifiedAdminRequest(req) {
  const adminEmails = new Set(
    String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const email = String(req?.user?.email || "").toLowerCase();
  return Boolean(
    req?.user?.role === "admin" &&
      adminEmails.has(email) &&
      (!req.user.isTwoFactorEnabled || req.jwtPayload?.is2FAVerified),
  );
}

function publicSettings(settings = {}, { includeRuntime = false } = {}) {
  const snapshot = settingsSnapshot(settings);
  HOME_TEXT_FIELDS.forEach((field) => {
    snapshot[field] = normalizePublicBrandText(snapshot[field]);
  });
  if (!includeRuntime) {
    return Object.fromEntries(
      [
        ...HOME_TEXT_FIELDS,
        "referralMode",
        "threed66ModelResolveMode",
      ].map((field) => [field, snapshot[field]]),
    );
  }
  delete snapshot.threed66ProxyUrl;
  delete snapshot._id;
  delete snapshot.__v;
  snapshot.threed66ProxyUrlConfigured = proxyUrlConfigured(settings);
  snapshot.threed66ProxyUrl = "";
  snapshot.threed66ProxyUrlClear = false;
  return snapshot;
}

function cacheSettings(settings) {
  settingsCache = settingsSnapshot(settings);
  return settings;
}

function fallbackSettings() {
  return settingsCache || settingsSnapshot(defaultSettings);
}

function isTransientSettingsStoreError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes("ssl routines") ||
    message.includes("tlsv1 alert internal error") ||
    message.includes("server selection timed out") ||
    message.includes("replicasetnoprimary") ||
    message.includes("econnreset") ||
    message.includes("etimedout") ||
    message.includes("connection closed")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSettingsWithRetry({ allowFallback = false } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await loadSettings();
    } catch (error) {
      lastError = error;
      if (!isTransientSettingsStoreError(error) || attempt === 1) break;
      await sleep(250);
    }
  }

  if (allowFallback) {
    const fallback = fallbackSettings();
    applyRuntimeSettings(fallback);
    console.warn(
      `Settings store unavailable. Serving cached settings: ${lastError?.message || lastError}`,
    );
    return fallback;
  }

  throw lastError;
}

function clampInteger(value, { min, max, fallback }) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeRetentionDays(value, config) {
  const number = Number(value);
  if (!Number.isInteger(number)) return config.fallback;
  if (number === 0) return 0;
  return Math.min(3650, Math.max(config.minActive, number));
}

function normalizePaytypeValue(value) {
  const text = String(value || "").trim();
  return /^[\w-]{1,20}$/.test(text) ? text : "4";
}

function normalizeModelResolveMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return THREED66_MODEL_RESOLVE_MODES.includes(mode) ? mode : "search";
}

function normalizeProxyUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    const error = new Error("Proxy URL không hợp lệ.");
    error.status = 400;
    throw error;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const error = new Error("Proxy URL phải dùng http:// hoặc https://.");
    error.status = 400;
    throw error;
  }
  return parsed.toString();
}

function applyRuntimeSettings(settings = {}) {
  Object.entries(RUNTIME_NUMBER_FIELDS).forEach(([field, config]) => {
    const value = clampInteger(settings[field], config);
    process.env[config.env] = String(config.toEnv ? config.toEnv(value) : value);
  });
  Object.entries(RUNTIME_BOOLEAN_FIELDS).forEach(([field, config]) => {
    process.env[config.env] = String(normalizeBoolean(settings[field], config.fallback));
  });
  process.env.THREED66_PAYTYPE_VALUE = normalizePaytypeValue(
    settings.threed66PaytypeValue,
  );
  process.env.THREED66_MODEL_RESOLVE_MODE = normalizeModelResolveMode(
    settings.threed66ModelResolveMode,
  );
  const storedProxyUrl = rawSettingValue(settings, "threed66ProxyUrl");
  if (storedProxyUrl !== undefined && String(storedProxyUrl || "").trim()) {
    process.env.THREED66_PROXY_URL = decryptProxyUrl(storedProxyUrl);
  }
}

async function loadSettings() {
  let settings = await SiteSetting.findOne({ key: "homepage" });
  if (!settings) {
    settings = await SiteSetting.create(defaultSettings);
  } else if (
    settings.heroText === "SIÃŠU Ráºº\nTáº¢I 3D66\nCHá»ˆ 8K VND" ||
    settings.heroText === "> SIÃŠU Ráºº\nTáº¢I MODEL\nCHá»ˆ 8K VND" ||
    settings.heroText === "> SIÃŠU Ráºº\nTáº¢I MODEL\nTá»C Äá»˜" ||
    settings.heroText === "SIÃŠU Ráºº\nTáº¢I 3D66\nTá»C Ä"
  ) {
    settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: { heroText: defaultSettings.heroText } },
      { new: true },
    );
  }
  if (!REFERRAL_MODES.includes(settings.referralMode)) {
    settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: { referralMode: defaultSettings.referralMode } },
      { new: true },
    );
  }
  const legacyReferralTitlePatch = {};
  if (
    settings.referralTitleBoth === "Giới thiệu bạn bè, cả hai +1 lượt tải." ||
    settings.referralTitleBoth === "Invite friends, both get rewards +1 download." ||
    settings.referralTitleBoth === "Mời bạn bè, cả hai nhận 1 ngày Pro miễn phí." ||
    settings.referralTitleBoth === "Invite friends and both receive 1 free Pro day."
  ) {
    legacyReferralTitlePatch.referralTitleBoth = defaultSettings.referralTitleBoth;
  }
  if (
    settings.referralTitleReferrerOnly === "Giới thiệu bạn bè để +1 lượt tải." ||
    settings.referralTitleReferrerOnly === "Invite friends to get +1 download." ||
    settings.referralTitleReferrerOnly === "Mời bạn bè để nhận 1 ngày Pro miễn phí." ||
    settings.referralTitleReferrerOnly === "Invite friends to receive 1 free Pro day."
  ) {
    legacyReferralTitlePatch.referralTitleReferrerOnly = defaultSettings.referralTitleReferrerOnly;
  }
  if (Object.keys(legacyReferralTitlePatch).length) {
    settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: legacyReferralTitlePatch },
      { new: true },
    );
  }
  const publicTextPatch = {};
  HOME_TEXT_FIELDS.forEach((field) => {
    const normalized = normalizePublicBrandText(settings[field]);
    if (normalized !== settings[field]) publicTextPatch[field] = normalized;
  });
  if (Object.keys(publicTextPatch).length) {
    settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: publicTextPatch },
      { new: true },
    );
  }
  const runtimePatch = {};
  Object.entries(RUNTIME_NUMBER_FIELDS).forEach(([field, config]) => {
    const normalized = clampInteger(settings[field], config);
    if (settings[field] !== normalized) runtimePatch[field] = normalized;
  });
  Object.entries(RETENTION_NUMBER_FIELDS).forEach(([field, config]) => {
    const normalized = normalizeRetentionDays(settings[field], config);
    if (settings[field] !== normalized) runtimePatch[field] = normalized;
  });
  const normalizedPaytypeValue = normalizePaytypeValue(settings.threed66PaytypeValue);
  if (settings.threed66PaytypeValue !== normalizedPaytypeValue) {
    runtimePatch.threed66PaytypeValue = normalizedPaytypeValue;
  }
  const rawSettings = settings.toObject ? settings.toObject({ defaults: false }) : settings;
  const modelModeIsSchemaDefault =
    typeof settings.$isDefault === "function" &&
    settings.$isDefault("threed66ModelResolveMode");
  const hasStoredModelMode =
    rawSettings.threed66ModelResolveMode !== undefined && !modelModeIsSchemaDefault;
  const normalizedModelResolveMode = normalizeModelResolveMode(
    hasStoredModelMode
      ? settings.threed66ModelResolveMode
      : defaultSettings.threed66ModelResolveMode,
  );
  if (
    !hasStoredModelMode ||
    settings.threed66ModelResolveMode !== normalizedModelResolveMode
  ) {
    runtimePatch.threed66ModelResolveMode = normalizedModelResolveMode;
  }
  Object.entries(RUNTIME_BOOLEAN_FIELDS).forEach(([field, config]) => {
    const isSchemaDefault =
      typeof settings.$isDefault === "function" && settings.$isDefault(field);
    const hasStoredValue = rawSettings[field] !== undefined && !isSchemaDefault;
    const normalized = normalizeBoolean(
      hasStoredValue ? settings[field] : undefined,
      config.fallback,
    );
    if (!hasStoredValue || settings[field] !== normalized) {
      runtimePatch[field] = normalized;
    }
  });
  if (
    settings.threed66ProxyFailClosed === true &&
    normalizeBoolean(settings.threed66ProxyEnabled, RUNTIME_BOOLEAN_FIELDS.threed66ProxyEnabled.fallback) === false
  ) {
    runtimePatch.threed66ProxyFailClosed = false;
  }
  if (Object.keys(runtimePatch).length) {
    settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: runtimePatch },
      { new: true },
    );
  }
  applyRuntimeSettings(settings);
  const pricingNote = settings.pricingNote || "";
  let nextPricingNote = pricingNote
    .replace(/nhu 3D66/gi, "nhu web")
    .replace(/nh\u01b0 3D66/gi, "nh\u01b0 web");
  if (nextPricingNote === "Nap credit tu dong, cong credit ngay sau khi chon goi.") {
    nextPricingNote = defaultSettings.pricingNote;
  }
  if (/50[.,]000\s*VN[DĐ]/i.test(nextPricingNote) && /128\s*credit/i.test(nextPricingNote)) {
    nextPricingNote = defaultSettings.pricingNote;
  }
  if (nextPricingNote !== pricingNote) {
    settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: { pricingNote: nextPricingNote } },
      { new: true },
    );
  }
  return cacheSettings(settings);
}

export async function initializeSettings() {
  return loadSettingsWithRetry({ allowFallback: true });
}

export async function getSettings(req, res, next) {
  try {
    const settings = await loadSettingsWithRetry({ allowFallback: true });
    res.json({
      settings: publicSettings(settings, {
        includeRuntime: isVerifiedAdminRequest(req),
      }),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req, res, next) {
  try {
    const fields = [
      ...HOME_TEXT_FIELDS,
      "referralMode",
      "threed66GetlinkConcurrency",
      "threed66PreviewConcurrency",
      "threed66RefreshConcurrency",
      "threed66PaytypeValue",
      "threed66ModelResolveMode",
      "threed66RequestIntervalMs",
      "threed66BrowserConcurrency",
      "threed66BrowserAlways",
      "threed66DisableBrowserPageFallback",
      "threed66DisableBrowserDownloadFallback",
      "threed66DownloadHandleBrowserFallback",
      "threed66ProxyEnabled",
      "threed66ProxyUrl",
      "threed66ProxyUrlClear",
      "threed66ProxyForPreview",
      "threed66ProxyForApi",
      "threed66ProxyForDownload",
      "threed66ProxyForBrowser",
      "threed66ProxyFailClosed",
      "threed66TimeoutMs",
      "threed66CookieMaxFailures",
      "threed66CookieCooldownMinutes",
      "maxGlobalDownloads",
      "maxDownloadsPerUser",
      "maxDownloadsPerIp",
      "getlinkRedownloadDays",
      "getlinkRedownloadLimit",
      "getlinkDetailRetentionDaysAfterExpiry",
      "getlinkHistoryRetentionDaysAfterExpiry",
      "marketplaceDownloadHistoryRetentionDays",
      "marketplaceReportHistoryRetentionDays",
      "auditLogHistoryRetentionDays",
    ];
    const unknownKey = rejectUnknownKeys(req.body, fields);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid settings request" });
    }

    const update = {};
    fields.forEach((field) => {
      if (req.body[field] === undefined) return;
      if (field === "referralMode") {
        if (REFERRAL_MODES.includes(req.body[field])) update[field] = req.body[field];
        return;
      }
      if (RUNTIME_NUMBER_FIELDS[field]) {
        update[field] = clampInteger(req.body[field], RUNTIME_NUMBER_FIELDS[field]);
        return;
      }
      if (RETENTION_NUMBER_FIELDS[field]) {
        update[field] = normalizeRetentionDays(req.body[field], RETENTION_NUMBER_FIELDS[field]);
        return;
      }
      if (field === "threed66PaytypeValue") {
        update[field] = normalizePaytypeValue(req.body[field]);
        return;
      }
      if (field === "threed66ModelResolveMode") {
        update[field] = normalizeModelResolveMode(req.body[field]);
        return;
      }
      if (field === "threed66ProxyUrl") {
        const normalized = normalizeProxyUrl(req.body[field]);
        if (normalized) update[field] = encryptSecret(normalized);
        return;
      }
      if (field === "threed66ProxyUrlClear") {
        if (normalizeBoolean(req.body[field], false)) update.threed66ProxyUrl = "";
        return;
      }
      if (RUNTIME_BOOLEAN_FIELDS[field]) {
        update[field] = normalizeBoolean(req.body[field], RUNTIME_BOOLEAN_FIELDS[field].fallback);
        return;
      }
      const sanitized = sanitizeHtml(limitedString(req.body[field], 1000));
      update[field] = HOME_TEXT_FIELDS.includes(field)
        ? normalizePublicBrandText(sanitized)
        : sanitized;
    });

    await loadSettingsWithRetry();
    const settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: update },
      { new: true },
    );
    applyRuntimeSettings(settings);
    if (update.threed66ProxyUrl === "") {
      process.env.THREED66_PROXY_URL = "";
    }
    cacheSettings(settings);

    res.json({ settings: publicSettings(settings, { includeRuntime: true }) });
  } catch (error) {
    next(error);
  }
}
