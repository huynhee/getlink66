import SiteSetting from "../models/SiteSetting.js";
import { limitedString, rejectUnknownKeys, sanitizeHtml } from "../utils/validators.js";

const defaultSettings = {
  key: "homepage",
  heroText: "SIÊU RẺ\nTẢI 3D66\nCHỈ 8K VND",
  heroSubtitle:
    "Dịch vụ getlink trung gian giúp bạn tải model từ 3D66 với giá rẻ hơn mua trực tiếp.",
  saleText: "Khuyến mãi gói PRO trong tháng này",
  pricingNote: "Nạp credit tự động, tỉ lệ chuyển đổi VD: 50.000 VNĐ = 12.8 tệ = 128 credit."
};

async function loadSettings() {
  let settings = await SiteSetting.findOne({ key: "homepage" });
  if (!settings) {
    settings = await SiteSetting.create(defaultSettings);
  } else if (
    settings.heroText === "> SIÊU RẺ\nTẢI MODEL\nCHỈ 8K VND" ||
    settings.heroText === "SIÊU NHANH\nTẢI 3D66\nCHỈ 8K VND"
  ) {
    settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: { heroText: defaultSettings.heroText } },
      { new: true }
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
    const fields = ["heroText", "heroSubtitle", "saleText", "pricingNote"];
    const unknownKey = rejectUnknownKeys(req.body, fields);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid settings request" });
    }

    const update = {};
    fields.forEach((field) => {
      if (req.body[field] !== undefined) update[field] = sanitizeHtml(limitedString(req.body[field], 1000));
    });

    const settings = await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $setOnInsert: defaultSettings, $set: update },
      { upsert: true, new: true }
    );

    res.json({ settings });
  } catch (error) {
    next(error);
  }
}
