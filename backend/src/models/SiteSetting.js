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
    threed66PaytypeValue: { type: String, default: "4" }
  },
  { timestamps: true }
);

export default isMemoryDb() ? createMemoryModel("SiteSetting") : mongoose.model("SiteSetting", siteSettingSchema);
