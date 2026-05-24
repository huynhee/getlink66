import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "homepage" },
    heroText: {
      type: String,
      default: "SIÊU RẺ\nTẢI 3D66\nTỐC ĐỘ"
    },
    heroSubtitle: {
      type: String,
      default:
        "Dịch vụ getlink trung gian giúp bạn tải model từ 3D66 với giá rẻ hơn mua trực tiếp."
    },
    saleText: {
      type: String,
      default: "Khuyến mãi gói PRO trong tháng này"
    },
    pricingNote: {
      type: String,
      default: "Nạp credit tự động, cộng credit ngay sau khi chọn gói."
    },
    referralMode: {
      type: String,
      enum: ["both", "referrer_only", "off"],
      default: "both"
    },
    threed66GetlinkConcurrency: { type: Number, default: 1 },
    threed66PreviewConcurrency: { type: Number, default: 1 },
    threed66RefreshConcurrency: { type: Number, default: 1 },
    threed66PaytypeValue: { type: String, default: "4" },
    threed66RequestIntervalMs: { type: Number, default: 2500 },
    threed66BrowserConcurrency: { type: Number, default: 1 },
    threed66TimeoutMs: { type: Number, default: 30000 },
    threed66CookieMaxFailures: { type: Number, default: 2 },
    threed66CookieCooldownMinutes: { type: Number, default: 30 },
    maxGlobalDownloads: { type: Number, default: 20 },
    maxDownloadsPerUser: { type: Number, default: 2 },
    maxDownloadsPerIp: { type: Number, default: 4 },
    getlinkRedownloadDays: { type: Number, default: 3 },
    getlinkRedownloadLimit: { type: Number, default: 5 }
  },
  { timestamps: true }
);

export default isMemoryDb() ? createMemoryModel("SiteSetting") : mongoose.model("SiteSetting", siteSettingSchema);
