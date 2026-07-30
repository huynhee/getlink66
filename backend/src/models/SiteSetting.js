import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

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

const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "homepage" },
    heroText: {
      type: String,
      default: "SIÊU RẺ\nTẢI 3D\nTỐC ĐỘ"
    },
    heroSubtitle: {
      type: String,
      default:
        "Dịch vụ getlink trung gian giúp bạn tải model 3D với giá rẻ hơn mua trực tiếp."
    },
    heroEyebrow: { type: String, default: "+ api 3d sdk" },
    saleText: {
      type: String,
      default: "Khuyến mãi gói PRO trong tháng này"
    },
    demoTitle: { type: String, default: "Bắt đầu tải ngay" },
    demoSubmitText: { type: String, default: "GET LINK" },
    systemStatusLabel: { type: String, default: "Trạng thái hệ thống" },
    pricePerDownloadLabel: { type: String, default: "Giá tải chỉ từ" },
    pricePerDownloadValue: { type: String, default: "10K" },
    referralTitleBoth: {
      type: String,
      default: "Mời bạn bè, cả hai nhận 1 ngày Pro + 28 credit."
    },
    referralTitleReferrerOnly: {
      type: String,
      default: "Mời bạn bè để nhận 1 ngày Pro + 28 credit."
    },
    pricingEyebrow: { type: String, default: "Bảng giá" },
    pricingTitle: { type: String, default: "Chọn gói phù hợp" },
    pricingNote: {
      type: String,
      default: "Nạp credit tự động, cộng credit ngay sau khi chọn gói."
    },
    guideEyebrow: { type: String, default: "Hướng dẫn" },
    guideTitle: { type: String, default: "Bài hướng dẫn" },
    guideIntro: {
      type: String,
      default: "Đọc hướng dẫn sử dụng Getlink, nạp credit và tải lại file đã mua."
    },
    ctaTitle: { type: String, default: "Sẵn sàng bắt đầu?" },
    ctaUserText: {
      type: String,
      default: "Vào trang getlink để tải model 3D và quản lý credit của bạn."
    },
    ctaGuestText: {
      type: String,
      default: "Đăng nhập Google để bắt đầu getlink 3D và quản lý credit của bạn."
    },
    footerTagline: { type: String, default: "Hỗ trợ 24/7" },
    referralMode: {
      type: String,
      enum: ["both", "referrer_only", "off"],
      default: "both"
    },
    threed66GetlinkConcurrency: { type: Number, default: 1 },
    threed66PreviewConcurrency: { type: Number, default: 1 },
    threed66RefreshConcurrency: { type: Number, default: 1 },
    threed66PaytypeValue: { type: String, default: "4" },
    threed66ModelResolveMode: {
      type: String,
      enum: ["search", "footprint", "direct"],
      default: "search"
    },
    threed66RequestIntervalMs: { type: Number, default: 2500 },
    threed66BrowserConcurrency: { type: Number, default: 1 },
    threed66BrowserAlways: { type: Boolean },
    threed66DisableBrowserPageFallback: { type: Boolean },
    threed66DisableBrowserDownloadFallback: { type: Boolean },
    threed66DownloadHandleBrowserFallback: { type: Boolean },
    threed66ProxyEnabled: { type: Boolean, default: false },
    threed66ProxyUrl: { type: String, default: "" },
    threed66ProxyForPreview: { type: Boolean, default: false },
    threed66ProxyForApi: { type: Boolean, default: false },
    threed66ProxyForDownload: { type: Boolean, default: false },
    threed66ProxyForBrowser: { type: Boolean, default: false },
    threed66ProxyFailClosed: { type: Boolean, default: false },
    threed66TimeoutMs: { type: Number, default: 30000 },
    threed66BrowserNavRetries: { type: Number, default: 3 },
    threed66BrowserRetryDelayMs: { type: Number, default: 1500 },
    threed66CookieMaxFailures: { type: Number, default: 2 },
    threed66CookieCooldownMinutes: { type: Number, default: 30 },
    maxGlobalDownloads: { type: Number, default: 20 },
    maxDownloadsPerUser: { type: Number, default: 2 },
    maxDownloadsPerIp: { type: Number, default: 4 },
    getlinkRedownloadDays: { type: Number, default: 3 },
    getlinkRedownloadLimit: { type: Number, default: 5 },
    getlinkDetailRetentionDaysAfterExpiry: { type: Number, default: 1, min: 0, max: 3650 },
    getlinkHistoryRetentionDaysAfterExpiry: { type: Number, default: 365, min: 0, max: 3650 },
    marketplaceDownloadHistoryRetentionDays: { type: Number, default: 365, min: 0, max: 3650 },
    marketplaceReportHistoryRetentionDays: { type: Number, default: 365, min: 0, max: 3650 },
    auditLogHistoryRetentionDays: { type: Number, default: 365, min: 0, max: 3650 }
  },
  { timestamps: true }
);

Object.entries(HOME_TEXT_DEFAULTS).forEach(([field, value]) => {
  siteSettingSchema.path(field)?.default(value);
});

export default isMemoryDb() ? createMemoryModel("SiteSetting") : mongoose.model("SiteSetting", siteSettingSchema);
