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
      default: "Nạp credit tự động, cộng credit ngay sau khi chọn gói. Tỉ lệ chuyển đổi VD: 50.000 VNĐ = 12.8 tệ = 128 credit"
    }
  },
  { timestamps: true }
);

export default isMemoryDb() ? createMemoryModel("SiteSetting") : mongoose.model("SiteSetting", siteSettingSchema);
