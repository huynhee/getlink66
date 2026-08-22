import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const HOME_TEXT_DEFAULTS = {
  heroText: "MODEL 3D\nSCENES\nGETLINK",
  heroSubtitle: "Thư viện 3D 200,000+ models giá chỉ 66đ/1 model. Dịch vụ getlink trung gian mua trung quốc giá rẻ.",
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

const HOME_TEXT_DEFAULTS_EN = {
  heroTextEn: "3D MODELS\nSCENES\nGETLINK",
  heroSubtitleEn: "A library of 200,000+ 3D models from only 66 VND per model. Affordable intermediary getlink service for purchases from China.",
  heroEyebrowEn: "+ api 3d sdk",
  saleTextEn: "PRO package promotion this month",
  demoTitleEn: "Start downloading now",
  demoSubmitTextEn: "GET LINK",
  systemStatusLabelEn: "System status",
  pricePerDownloadLabelEn: "Download price from",
  pricePerDownloadValueEn: "10K",
  referralTitleBothEn: "Invite friends and both receive 1 Pro day + 28 credits.",
  referralTitleReferrerOnlyEn: "Invite friends to receive 1 Pro day + 28 credits.",
  pricingEyebrowEn: "Pricing",
  pricingTitleEn: "Choose the right package",
  pricingNoteEn: "Automatic credit top-up after selecting a package.",
  guideEyebrowEn: "Guide",
  guideTitleEn: "Guide articles",
  guideIntroEn: "Read guides for Getlink, credit top-up, and redownloading purchased files.",
  ctaTitleEn: "Ready to start?",
  ctaUserTextEn: "Open Getlink to download 3D models and manage your credit.",
  ctaGuestTextEn: "Sign in with Google to start using 3D Getlink and manage your credit.",
  footerTaglineEn: "24/7 support",
};

const siteSettingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "homepage" },
    heroText: {
      type: String,
      default: "SIÊU RẺ\nTẢI 3D\nGETLINK"
    },
    heroSubtitle: {
      type: String,
      default:
        "Thư viện 3D 200,000+ models giá chỉ 66đ/1 model. Dịch vụ getlink trung gian mua trung quốc giá rẻ."
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
    referralRewardCreditEnabled: { type: Boolean, default: true },
    referralRewardProEnabled: { type: Boolean, default: true },
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
    marketplaceModelCreditPrice: { type: Number, default: 5, min: 1, max: 100000 },
    marketplaceSceneCreditPrice: { type: Number, default: 25, min: 1, max: 100000 },
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

siteSettingSchema.add(
  Object.fromEntries(
    Object.entries(HOME_TEXT_DEFAULTS_EN).map(([field, value]) => [
      field,
      { type: String, default: value },
    ]),
  ),
);

export default isMemoryDb() ? createMemoryModel("SiteSetting") : mongoose.model("SiteSetting", siteSettingSchema);
