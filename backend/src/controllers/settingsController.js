import SiteSetting from "../models/SiteSetting.js";
import { limitedString, rejectUnknownKeys, sanitizeHtml } from "../utils/validators.js";

const REFERRAL_MODES = ["both", "referrer_only", "off"];

const defaultSettings = {
  key: "homepage",
  heroText: "SIEU RE\nTAI 3D66\nTOC DO",
  heroSubtitle:
    "Dich vu getlink trung gian giup ban tai model tu 3D66 voi gia re hon mua truc tiep.",
  saleText: "Khuyen mai goi PRO trong thang nay",
  pricingNote:
    "Nap credit tu dong, ti le 1:1 nhu 3D66 VD: 50.000 VND = 12.8 te = 128 credit.",
  referralMode: "both",
};

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
  return settings;
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
    const fields = ["heroText", "heroSubtitle", "saleText", "pricingNote", "referralMode"];
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
      update[field] = sanitizeHtml(limitedString(req.body[field], 1000));
    });

    const settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $setOnInsert: defaultSettings, $set: update },
      { upsert: true, new: true },
    );

    res.json({ settings });
  } catch (error) {
    next(error);
  }
}
