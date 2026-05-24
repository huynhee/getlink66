import SiteSetting from "../models/SiteSetting.js";
import { limitedString, rejectUnknownKeys, sanitizeHtml } from "../utils/validators.js";

const REFERRAL_MODES = ["both", "referrer_only", "off"];
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
};

const defaultSettings = {
  key: "homepage",
  heroText: "SIEU RE\nTAI 3D66\nTOC DO",
  heroSubtitle:
    "Dich vu getlink trung gian giup ban tai model tu 3D66 voi gia re hon mua truc tiep.",
  saleText: "Khuyen mai goi PRO trong thang nay",
  pricingNote: "Nap credit tu dong, cong credit ngay sau khi chon goi.",
  referralMode: "both",
  threed66GetlinkConcurrency: Number(process.env.THREED66_GETLINK_CONCURRENCY || 1),
  threed66PreviewConcurrency: Number(process.env.THREED66_PREVIEW_CONCURRENCY || 1),
  threed66RefreshConcurrency: Number(process.env.THREED66_REFRESH_CONCURRENCY || 1),
  threed66PaytypeValue: String(process.env.THREED66_PAYTYPE_VALUE || "4"),
  threed66RequestIntervalMs: Number(process.env.THREED66_REQUEST_INTERVAL_MS || 2500),
  threed66BrowserConcurrency: Number(process.env.THREED66_BROWSER_CONCURRENCY || 1),
  threed66TimeoutMs: Number(process.env.THREED66_TIMEOUT_MS || 30000),
  threed66CookieMaxFailures: Number(process.env.THREED66_COOKIE_MAX_FAILURES || 2),
  threed66CookieCooldownMinutes: Math.round(Number(process.env.THREED66_COOKIE_COOLDOWN_MS || 1800000) / 60000),
};

function clampInteger(value, { min, max, fallback }) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizePaytypeValue(value) {
  const text = String(value || "").trim();
  return /^[\w-]{1,20}$/.test(text) ? text : "4";
}

function applyRuntimeSettings(settings = {}) {
  Object.entries(RUNTIME_NUMBER_FIELDS).forEach(([field, config]) => {
    const value = clampInteger(settings[field], config);
    process.env[config.env] = String(config.toEnv ? config.toEnv(value) : value);
  });
  process.env.THREED66_PAYTYPE_VALUE = normalizePaytypeValue(
    settings.threed66PaytypeValue,
  );
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
  const runtimePatch = {};
  Object.entries(RUNTIME_NUMBER_FIELDS).forEach(([field, config]) => {
    const normalized = clampInteger(settings[field], config);
    if (settings[field] !== normalized) runtimePatch[field] = normalized;
  });
  const normalizedPaytypeValue = normalizePaytypeValue(settings.threed66PaytypeValue);
  if (settings.threed66PaytypeValue !== normalizedPaytypeValue) {
    runtimePatch.threed66PaytypeValue = normalizedPaytypeValue;
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
  return settings;
}

export async function initializeSettings() {
  return loadSettings();
}

export async function getSettings(_req, res, next) {
  try {
    const settings = await loadSettings();
    res.json({ settings });
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req, res, next) {
  try {
    const fields = [
      "heroText",
      "heroSubtitle",
      "saleText",
      "pricingNote",
      "referralMode",
      "threed66GetlinkConcurrency",
      "threed66PreviewConcurrency",
      "threed66RefreshConcurrency",
      "threed66PaytypeValue",
      "threed66RequestIntervalMs",
      "threed66BrowserConcurrency",
      "threed66TimeoutMs",
      "threed66CookieMaxFailures",
      "threed66CookieCooldownMinutes",
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
      if (field === "threed66PaytypeValue") {
        update[field] = normalizePaytypeValue(req.body[field]);
        return;
      }
      update[field] = sanitizeHtml(limitedString(req.body[field], 1000));
    });

    await loadSettings();
    const settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: update },
      { new: true },
    );
    applyRuntimeSettings(settings);

    res.json({ settings });
  } catch (error) {
    next(error);
  }
}
