import React, { useState } from "react";
import { AlertCircle, ArrowRight, BookOpen, CheckCircle2, ChevronRight, Chrome, ClipboardPaste, Search, ShieldCheck, Sparkles, UserPlus, Wallet } from "lucide-react";
import { API_URL, api } from "../api.js";
import GuideContent from "../components/GuideContent.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import { ModelCard } from "./Models.jsx";
import { translations } from "../i18n.js";
import { membershipFeatureLabel } from "../utils/membershipPresentation.js";

const HOME_TEXT_DEFAULTS = {
  vi: {
    heroEyebrow: "+ api 3d sdk",
    heroText: "MODEL 3D\nSCENES\nGETLINK",
    heroSubtitle: "Thư viện 3D 200,000+ models giá chỉ 66đ/1 model. Dịch vụ getlink trung gian mua trung quốc giá rẻ.",
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
  },
  en: {
    heroEyebrow: "+ api 3d sdk",
    heroText: "AFFORDABLE\n3D LIBRARY\nGETLINK",
    heroSubtitle: "An intermediary getlink service that helps you download 3D models with a faster credit workflow.",
    saleText: "",
    demoTitle: "Start download",
    demoSubmitText: "GET LINK",
    systemStatusLabel: "System status",
    pricePerDownloadLabel: "Download price from",
    pricePerDownloadValue: "10K",
    referralTitleBoth: "Invite friends and both receive 1 Pro day + 28 credits.",
    referralTitleReferrerOnly: "Invite friends to receive 1 Pro day + 28 credits.",
    pricingEyebrow: "Pricing",
    pricingTitle: "Choose the right package",
    pricingNote: "Automatic credit top-up after selecting a package.",
    guideEyebrow: "Guide",
    guideTitle: "Guide articles",
    guideIntro: "Read guides for Getlink, credit top-up, and redownloading purchased files.",
    ctaTitle: "Ready to start?",
    ctaUserText: "Open Getlink to download 3D models and manage your credit.",
    ctaGuestText: "Sign in with Google to start using 3D Getlink and manage your credit.",
    footerTagline: "24/7 support",
  },
};

const HOME_TEXT_FIELDS = Object.keys(HOME_TEXT_DEFAULTS.vi);

function localizedHomeText(settings = {}, language = "vi") {
  return Object.fromEntries(
    HOME_TEXT_FIELDS.map((field) => {
      const localizedField = language === "en" ? `${field}En` : field;
      const value = settings[localizedField];
      return [field, typeof value === "string" ? value : HOME_TEXT_DEFAULTS[language][field]];
    }),
  );
}

function isDailyMembershipPlan(plan) {
  return String(plan?.code || "").toUpperCase() === "DAILY" || Number(plan?.durationDays || 0) <= 1;
}

function normalize3D66Input(value = "", resolveMode = "search") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    if (resolveMode === "search") return "";
    try {
      const parsed = new URL(text);
      const host = parsed.hostname.toLowerCase();
      const is3D66 = host === "3d66.com" || host.endsWith(".3d66.com");
      return is3D66 && parsed.searchParams.get("sof") ? text : "";
    } catch {
      return "";
    }
  }
  if (resolveMode !== "search") return "";
  return /^[A-Z0-9_-]{8,64}$/i.test(text) && /[A-Z]/i.test(text) && /\d{6,}/.test(text)
    ? text.toUpperCase()
    : "";
}

function inputValueWhileTyping(value = "", resolveMode = "search") {
  return resolveMode === "search" ? value.toUpperCase() : value;
}

function inputModeText(resolveMode = "search", language = "vi") {
  const isVi = language === "vi";
  if (resolveMode === "footprint") {
    return {
      placeholder: isVi ? "Nhập link model 3D66" : "Paste the full 3D model 3D66 link",
      invalid: isVi ? "Vui lòng dán link model 3D66." : "Paste a 3D model 3D66 link containing a valid model ID.",
    };
  }
  if (resolveMode === "direct") {
    return {
      placeholder: isVi ? "Nhập link model 3D66" : "Paste the full 3D model 3D66 link",
      invalid: isVi ? "Vui lòng dán link model 3D66." : "Paste a 3D model 3D66 link containing a valid model ID.",
    };
  }
  return {
    placeholder: isVi ? "Nhập mã model" : "Enter a 3D model ID",
    invalid: isVi ? "Vui lòng nhập mã model hợp lệ." : "Enter a valid 3D model ID.",
  };
}

export default function Login({ user = null, adminMode = false, returnTo = "/", language = "vi" }) {
  const t = { ...(translations[language] || translations.vi) };
  const userId = user?._id;
  const [demoLink, setDemoLink] = useState("");
  const [demoError, setDemoError] = useState("");
  const [packages, setPackages] = useState([]);
  const [membershipPlans, setMembershipPlans] = useState([]);
  const [featuredModels, setFeaturedModels] = useState([]);
  const [featuredModelsLoading, setFeaturedModelsLoading] = useState(true);
  const [featuredScenes, setFeaturedScenes] = useState([]);
  const [featuredScenesLoading, setFeaturedScenesLoading] = useState(true);
  const [catalogSearchType, setCatalogSearchType] = useState("model");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [homeTopupMode, setHomeTopupMode] = useState("pro");
  const [systemStatus, setSystemStatus] = useState({ online: true, message: "" });
  const [referral, setReferral] = useState(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [guideArticles, setGuideArticles] = useState([]);
  const [guideActiveSlug, setGuideActiveSlug] = useState("");
  const [guideLoading, setGuideLoading] = useState(true);
  const [guideError, setGuideError] = useState("");
  const [siteSettings, setSiteSettings] = useState({
    referralMode: "both",
    referralRewardCreditEnabled: true,
    referralRewardProEnabled: true,
    heroEyebrow: "+ api 3d sdk",
    heroText: language === "vi" ? "SIÊU RẺ\nTẢI 3D\nGETLINK" : "AFFORDABLE\n3D LIBRARY\nGETLINK",
    heroSubtitle: language === "vi"
      ? "Thư viện 3D 200,000+ models giá chỉ 66đ/1 model. Dịch vụ getlink trung gian mua trung quốc giá rẻ."
      : "An intermediary getlink service that helps you download 3D models with a faster credit workflow.",
    saleText: "",
    demoTitle: language === "vi" ? "Bắt đầu tải ngay" : "Start download",
    demoSubmitText: "GET LINK",
    systemStatusLabel: language === "vi" ? "Trạng thái hệ thống" : "System status",
    pricePerDownloadLabel: language === "vi" ? "Giá tải chỉ từ" : "Download price from",
    pricePerDownloadValue: "10K",
    referralTitleBoth: language === "vi"
      ? "Mời bạn bè, cả hai nhận 1 ngày Pro + 28 credit."
      : "Invite friends and both receive 1 Pro day + 28 credits.",
    referralTitleReferrerOnly: language === "vi"
      ? "Mời bạn bè để nhận 1 ngày Pro + 28 credit."
      : "Invite friends to receive 1 Pro day + 28 credits.",
    pricingEyebrow: language === "vi" ? "Bảng giá" : "Pricing",
    pricingTitle: language === "vi" ? "Chọn gói phù hợp" : "Choose the right package",
    pricingNote: language === "vi"
      ? "Nạp credit tự động, cộng credit ngay sau khi chọn gói."
      : "Automatic credit top-up after selecting a package.",
    guideEyebrow: language === "vi" ? "Hướng dẫn" : "Guide",
    guideTitle: language === "vi" ? "Bài hướng dẫn" : "Guide articles",
    guideIntro: language === "vi"
      ? "Đọc hướng dẫn sử dụng Getlink, nạp credit và tải lại file đã mua."
      : "Read guides for Getlink, credit top-up, and redownloading purchased files.",
    ctaTitle: language === "vi" ? "Sẵn sàng bắt đầu?" : "Ready to start?",
    ctaUserText: language === "vi"
      ? "Vào trang getlink để tải model 3D và quản lý credit của bạn."
      : "Open Getlink to download 3D models and manage your credit.",
    ctaGuestText: language === "vi"
      ? "Đăng nhập Google để bắt đầu getlink 3D và quản lý credit của bạn."
      : "Sign in with Google to start using 3D Getlink and manage your credit.",
    footerTagline: language === "vi" ? "Hỗ trợ 24/7" : "24/7 support",
    threed66ModelResolveMode: "search",
    ...HOME_TEXT_DEFAULTS[language]
  });
  const modelResolveMode = siteSettings.threed66ModelResolveMode || "search";
  const modeText = inputModeText(modelResolveMode, language);
  if (referral?.mode === "referrer_only") {
    t.referralTitle = language === "vi"
      ? "Mời bạn bè để nhận 1 ngày Pro + 28 credit."
      : "Invite friends to receive 1 Pro day + 28 credits.";
  }

  React.useEffect(() => {
    setSiteSettings((current) => ({
      ...current,
      ...localizedHomeText(current, language),
    }));
  }, [language]);

  React.useEffect(() => {
    if (!adminMode) {
      api("/api/settings")
        .then((data) => {
          if (data?.settings) {
            setSiteSettings((current) => ({
              ...current,
              ...data.settings,
              ...localizedHomeText(data.settings, language),
            }));
          }
        })
        .catch(console.error);
      setFeaturedModelsLoading(true);
      setFeaturedScenesLoading(true);
      api("/api/marketplace/recommendations/home?limit=6")
        .then((data) => {
          setFeaturedModels((data.models || []).slice(0, 6));
          setFeaturedScenes((data.scenes || []).slice(0, 6));
        })
        .catch(() => {
          setFeaturedModels([]);
          setFeaturedScenes([]);
        })
        .finally(() => {
          setFeaturedModelsLoading(false);
          setFeaturedScenesLoading(false);
        });
      api("/api/topup/packages")
        .then((data) => setPackages(data.packages || []))
        .catch(console.error);
      api("/api/membership/plans")
        .then((data) => setMembershipPlans(data.plans || []))
        .catch(console.error);
      api("/api/system/3d66-status")
        .then((data) => setSystemStatus({ online: Boolean(data.online), message: data.message || "" }))
        .catch(() => setSystemStatus({ online: false, message: t.systemOfflineMessage }));
      setGuideLoading(true);
      setGuideError("");
      api(`/api/guides?language=${language}`)
        .then((data) => {
          const nextArticles = data.articles || [];
          setGuideArticles(nextArticles);
          setGuideActiveSlug((current) => {
            if (nextArticles.some((item) => item.slug === current)) return current;
            return nextArticles[0]?.slug || "";
          });
        })
        .catch((err) => setGuideError(err.message))
        .finally(() => setGuideLoading(false));
    }
  }, [adminMode, language, t.systemOfflineMessage, userId]);

  React.useEffect(() => {
    if (!userId || adminMode) {
      setReferral(null);
      return;
    }
    api("/api/referral/me")
      .then(setReferral)
      .catch(() => setReferral(null));
  }, [userId, adminMode]);

  const pricingPackages = packages.length
    ? packages
    : [
      {
        name: language === "vi" ? "GÓI STARTER" : "STARTER PACKAGE",
        price: 65000,
        credit: 140,
        salePercent: 0,
        badge: "",
        features: t.defaultPackageFeatures
      }
    ];
  const activeGuideArticle = React.useMemo(
    () => guideArticles.find((item) => item.slug === guideActiveSlug) || guideArticles[0],
    [guideActiveSlug, guideArticles]
  );

  function finalPrice(pkg) {
    if (Number(pkg.salePrice || 0) > 0) return Number(pkg.salePrice || 0);
    return Math.round(Number(pkg.price || 0) * (100 - Number(pkg.salePercent || 0)) / 100);
  }

  function hasSale(pkg) {
    return (
      Number(pkg.salePercent || 0) > 0 ||
      (Number(pkg.salePrice || 0) > 0 &&
        Number(pkg.salePrice || 0) < Number(pkg.price || 0))
    );
  }

  function googleHref(target = returnTo) {
    const params = new URLSearchParams({ returnTo: target });
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) params.set("ref", ref);
    return `${API_URL}/api/auth/google?${params.toString()}`;
  }

  function authAwareHref(target) {
    return user ? target : googleHref(target);
  }

  function topupTarget(mode, id = "") {
    const params = new URLSearchParams({ mode });
    if (mode === "pro" && id) params.set("planId", id);
    if (mode === "credit" && id) params.set("packageId", id);
    return `/topup?${params.toString()}`;
  }

  function getlinkTarget() {
    const modelInput = normalize3D66Input(demoLink, modelResolveMode);
    return modelInput ? `/getlink?url=${encodeURIComponent(modelInput)}` : "/getlink";
  }

  function handleDemoGetlink(event) {
    event.preventDefault();
    if (!systemStatus.online) {
      setDemoError(t.systemOfflineMessage);
      return;
    }
    const modelInput = normalize3D66Input(demoLink, modelResolveMode);
    if (!modelInput) {
      setDemoError(modeText.invalid);
      return;
    }
    setDemoLink(modelInput);
    window.location.href = authAwareHref(getlinkTarget());
  }

  async function pasteDemoLink() {
    setDemoError("");
    try {
      if (!navigator.clipboard?.readText) {
        setDemoError(t.clipboardUnsupported);
        return;
      }

      const pasted = (await navigator.clipboard.readText()).trim();
      if (!pasted) {
        setDemoError(t.clipboardEmpty);
        return;
      }
      const modelInput = normalize3D66Input(pasted, modelResolveMode);
      if (!modelInput) {
        setDemoError(modeText.invalid);
        return;
      }

      setDemoLink(modelInput);
    } catch {
      setDemoError(t.clipboardDenied);
    }
  }

  async function copyReferralLink() {
    if (!referral?.referralUrl) return;
    try {
      await navigator.clipboard.writeText(referral.referralUrl);
      setReferralCopied(true);
      window.setTimeout(() => setReferralCopied(false), 1600);
    } catch {
      setReferralCopied(false);
    }
  }

  function referralTitle() {
    const mode = referral?.mode || siteSettings.referralMode;
    const proDays = Number(referral?.rewardProDays ?? (siteSettings.referralRewardProEnabled === false ? 0 : 1));
    const credits = Number(referral?.rewardCredit ?? (siteSettings.referralRewardCreditEnabled === false ? 0 : 28));
    const rewards = [
      proDays > 0 ? (language === "vi" ? `${proDays} ngày Pro` : `${proDays} Pro day`) : "",
      credits > 0 ? (language === "vi" ? `${credits} credit` : `${credits} credits`) : "",
    ].filter(Boolean).join(" + ");
    if (mode === "referrer_only") {
      return language === "vi"
        ? `Mời bạn bè để nhận ${rewards}.`
        : `Invite friends to receive ${rewards}.`;
    }
    return language === "vi"
      ? `Mời bạn bè, cả hai nhận ${rewards}.`
      : `Invite friends and both receive ${rewards}.`;
  }

  function homepageReferralTitle() {
    if (siteSettings.referralRewardCreditEnabled === false || siteSettings.referralRewardProEnabled === false) {
      return referralTitle();
    }
    if ((referral?.mode || siteSettings.referralMode) === "referrer_only") {
      return siteSettings.referralTitleReferrerOnly || referralTitle();
    }
    return siteSettings.referralTitleBoth || referralTitle();
  }

  function submitCatalogSearch(event) {
    event.preventDefault();
    const query = catalogSearch.trim();
    const target = catalogSearchType === "scene" ? "/scenes" : "/models";
    window.location.assign(query ? `${target}?q=${encodeURIComponent(query)}` : target);
  }

  return (
    <div className="landing">
      {!adminMode && (
        <form className="homeCatalogSearch" onSubmit={submitCatalogSearch} role="search">
          <div className="homeCatalogSearchTypes" role="tablist" aria-label={language === "vi" ? "Loại thư viện" : "Library type"}>
            <button
              type="button"
              className={catalogSearchType === "model" ? "active" : ""}
              onClick={() => setCatalogSearchType("model")}
              role="tab"
              aria-selected={catalogSearchType === "model"}
            >
              3D Models
            </button>
            <button
              type="button"
              className={catalogSearchType === "scene" ? "active" : ""}
              onClick={() => setCatalogSearchType("scene")}
              role="tab"
              aria-selected={catalogSearchType === "scene"}
            >
              3D Scenes
            </button>
          </div>
          <label className="homeCatalogSearchField">
            <span className="srOnly">{language === "vi" ? "Tìm kiếm thư viện 3D" : "Search the 3D library"}</span>
            <input
              type="search"
              value={catalogSearch}
              onChange={(event) => setCatalogSearch(event.target.value)}
              placeholder={catalogSearchType === "scene"
                ? (language === "vi" ? "Tìm kiếm scene 3D..." : "Search 3D scenes...")
                : (language === "vi" ? "Tìm kiếm 200.000+ model, vật liệu..." : "Search 200,000+ models, materials...")}
            />
          </label>
          <button className="homeCatalogSearchSubmit" type="submit" aria-label={language === "vi" ? "Tìm kiếm" : "Search"}>
            <Search size={18} />
          </button>
        </form>
      )}
      {!adminMode && (
        <div className="signalRail">
          <div className="signalTrack">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="signalGroup" key={index} aria-hidden={index === 1}>
                <span>+ LINK 3D READY</span>
                <span>cache:on</span>
                <span>pay:auto</span>
                <span>coin:live</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!adminMode && (
        <section className="heroSection">
          <div className="heroLeft">
            <h3 className="eyebrowSignal" style={{ marginBottom: 16 }}>
              {siteSettings.heroEyebrow || "+ api 3d sdk"}
            </h3>
            {siteSettings.saleText && (
              <div
                style={{
                  marginBottom: 16,
                  display: "inline-block",
                  background: "rgba(255, 0, 255, 0.1)",
                  border: "1px solid var(--neon-magenta)",
                  padding: "4px 12px",
                  color: "var(--neon-magenta)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  fontWeight: "bold"
                }}
              >
                {siteSettings.saleText}
              </div>
            )}
            <h1 className="glitchTitle" data-text={siteSettings.heroText.replace(/^>\s*/, "")} style={{ whiteSpace: "pre-line" }}>
              {siteSettings.heroText.split("\n").map((line, index) => (
                <React.Fragment key={index}>
                  {index === 0 ? (
                    <span className="hl-magenta">{line.replace(/^>\s*/, "")}</span>
                  ) : index === 2 ? (
                    <span className="hl-green heroPriceLine">{line}</span>
                  ) : (
                    line
                  )}
                  {index < 2 && <br />}
                </React.Fragment>
              ))}
            </h1>
            <p>{siteSettings.heroSubtitle}</p>
            <div className="heroActions">
              <a className="primaryButton" href={authAwareHref("/getlink")}>
                <Chrome size={18} /> {user ? t.enterGetlink : t.googleLogin}
              </a>
              <a className="googleButton" href="#pricing">
                {t.viewPricing} <ArrowRight size={16} />
              </a>
            </div>
          </div>

          <div className="heroRight">
            <div
              className="panel getlinkForm"
              style={{
                padding: 32,
                borderColor: "var(--neon-green)",
                boxShadow: "0 0 40px rgba(0, 255, 136, 0.1)"
              }}
            >
              <h2 style={{ fontSize: 20, marginBottom: 24 }}>
                {siteSettings.demoTitle || t.startDownload}
              </h2>
              <form onSubmit={handleDemoGetlink} className="inputWrapper">
                <div className="linkInputWrap terminalInput">
                  <input
                    type="text"
                    inputMode="text"
                    placeholder={modeText.placeholder}
                    value={demoLink}
                    onChange={(event) => {
                      setDemoLink(inputValueWhileTyping(event.target.value, modelResolveMode));
                      setDemoError("");
                    }}
                    required
                  />
                  <button type="button" className="pasteInlineButton" onClick={pasteDemoLink} title={t.pasteTitle}>
                    <ClipboardPaste size={14} />
                    {t.paste}
                  </button>
                </div>
                <button
                  type="submit"
                  className="primaryButton"
                  disabled={!demoLink.trim()}
                  style={{ border: "none" }}
                >
                  {siteSettings.demoSubmitText || "GET LINK"}
                </button>
              </form>
              {demoError && (
                <p className="error" style={{ marginTop: 8 }}>
                  <AlertCircle size={14} /> {demoError}
                </p>
              )}
              <div className="statusBox" style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--border-warm)" }}>
                <div className="statusItem">
                  <span>{siteSettings.systemStatusLabel || t.systemStatus}</span>
                  <strong className={systemStatus.online ? "ready" : "offline"}>
                    {systemStatus.online ? t.online : t.offline}
                  </strong>
                </div>
                <div className="statusItem">
                  <span>{siteSettings.pricePerDownloadLabel || t.pricePerDownload}</span>
                  <strong>{siteSettings.pricePerDownloadValue || "10K"}</strong>
                </div>
              </div>
            </div>
            {siteSettings.referralMode !== "off" && (
              <div className="referralInvite referralGetlinkInvite">
                <div className="referralInviteHeader">
                  <strong><UserPlus size={14} /> {homepageReferralTitle()}</strong>
                  {referral?.referralCode && <span>{referral.referralCode}</span>}
                </div>
                <div className="referralUrlRow">
                  <input
                    value={referral?.referralUrl || ""}
                    placeholder={language === "vi" ? "Đăng nhập để nhận link mời riêng" : "Sign in to get your invite link"}
                    readOnly
                    aria-label={t.referralTitle}
                  />
                  {referral?.referralUrl ? (
                    <button type="button" className="smallButton" onClick={copyReferralLink}>
                      {referralCopied ? t.copied : t.copy}
                    </button>
                  ) : (
                    <a className="smallButton" href={user ? "/invite" : googleHref("/invite")}>
                      {language === "vi" ? "ĐĂNG NHẬP" : "SIGN IN"}
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {!adminMode && (
        <section className="homeModelsSection homeRecommendationsSection" aria-labelledby="home-recommendations-title">
          <div className="homeModelsHeader">
            <div>
              <span className="eyebrowSignal">{language === "vi" ? "Thư viện 3D" : "3D library"}</span>
              <h2 id="home-recommendations-title">{language === "vi" ? "Đề xuất mới" : "New recommendations"}</h2>
              <p>
                {language === "vi"
                  ? "Model và Scene Free/Pro mới nhất, sẵn sàng tải trên web và plugin."
                  : "The latest Free and Pro Models and Scenes, ready for web and plugin downloads."}
              </p>
            </div>
          </div>

          <div className="homeRecommendationGroup">
            <div className="homeRecommendationGroupHeader">
              <h3>Model</h3>
              <a href="/models">
                {language === "vi" ? "Xem tất cả" : "View all"} <ChevronRight size={15} />
              </a>
            </div>
            {featuredModelsLoading ? (
              <div className="homeModelGrid" aria-label={language === "vi" ? "Đang tải model" : "Loading models"}>
                {Array.from({ length: 6 }).map((_, index) => <span className="homeModelSkeleton" key={index} />)}
              </div>
            ) : featuredModels.length ? (
              <div className="homeModelGrid">
                {featuredModels.map((model, index) => (
                  <ModelCard
                    key={model._id}
                    model={model}
                    language={language}
                    behaviorSource="home"
                    position={index + 1}
                  />
                ))}
              </div>
            ) : (
              <div className="homeModelsEmpty">
                <span>{language === "vi" ? "Model đang được cập nhật." : "Models are being updated."}</span>
                <a href="/models">{language === "vi" ? "Mở thư viện" : "Open library"}</a>
              </div>
            )}
          </div>

          <div className="homeRecommendationGroup">
            <div className="homeRecommendationGroupHeader">
              <h3>Scene</h3>
              <a href="/scenes">
                {language === "vi" ? "Xem tất cả" : "View all"} <ChevronRight size={15} />
              </a>
            </div>
            {featuredScenesLoading ? (
              <div className="homeModelGrid homeSceneGrid" aria-label={language === "vi" ? "Đang tải scene" : "Loading scenes"}>
                {Array.from({ length: 6 }).map((_, index) => <span className="homeModelSkeleton" key={index} />)}
              </div>
            ) : featuredScenes.length ? (
              <div className="homeModelGrid homeSceneGrid">
                {featuredScenes.map((scene, index) => (
                  <ModelCard
                    key={scene._id}
                    model={scene}
                    language={language}
                    behaviorSource="home"
                    position={index + 1}
                  />
                ))}
              </div>
            ) : (
              <div className="homeModelsEmpty">
                <span>{language === "vi" ? "Scene đang được cập nhật." : "Scenes are being updated."}</span>
                <a href="/scenes">{language === "vi" ? "Mở thư viện" : "Open library"}</a>
              </div>
            )}
          </div>
        </section>
      )}

      {adminMode && (
        <section className="loginPage adminLoginPage">
          <div className="panel loginPanel has-window-controls">
            <div className="window-controls">
              <span />
              <span />
              <span />
            </div>
            <div className="loginIcon">
              <ShieldCheck size={32} />
            </div>
            <h2 style={{ justifyContent: "center" }}>{t.admin}</h2>
            <p style={{ marginBottom: 24 }}>
              {t.adminRequiredBody}
            </p>
            <a className="primaryButton" href={googleHref("/admin")} style={{ width: "100%" }}>
              <Chrome size={18} /> {t.googleLogin}
            </a>
          </div>
        </section>
      )}

      {!adminMode && (
        <>
          <section id="pricing" style={{ marginTop: 64 }}>
            <div className="sectionTitle">
              <h3>{siteSettings.pricingEyebrow || t.pricing}</h3>
              <h2 className="glitchTitle subtle" data-text={siteSettings.pricingTitle || t.choosePackage}>
                {siteSettings.pricingTitle || t.choosePackage}
              </h2>
              <p className="pricingModeDescription">
                {homeTopupMode === "credit"
                  ? siteSettings.pricingNote
                  : (language === "vi"
                    ? "Bạn đang xem gói Pro dùng để mở quyền và quota tải Model/Scene trong thư viện."
                    : "You are viewing Pro plans that unlock Model/Scene library access and download quota.")}
              </p>
            </div>

            <div
              className="homeTopupChooser landingTopupChooser"
            >
              <div>
                <span className="eyebrowSignal">{language === "vi" ? "Gói nạp" : "Top-up"}</span>
                <h3>{language === "vi" ? "Nạp theo nhu cầu" : "Top up by need"}</h3>
                <p className="homeTopupPurpose">
                  {language === "vi"
                    ? "Credit dùng riêng cho Getlink (28 credit tương đương 1 lượt). Pro mở quyền và quota tải Model/Scene trong thư viện."
                    : "Credit is only for Getlink (28 credits equal one request). Pro unlocks Model/Scene library access and quota."}
                </p>
              </div>
              <div className="homeTopupActions">
                <button
                  type="button"
                  className={`homeTopupAction pro ${homeTopupMode === "pro" ? "active" : ""}`}
                  onClick={() => setHomeTopupMode("pro")}
                  aria-pressed={homeTopupMode === "pro"}
                >
                  <Sparkles size={18} />
                  <span>Pro</span>
                  <small>{language === "vi" ? "Quyền tải Model/Scene Pro" : "Pro Model/Scene access"}</small>
                  <small className="homeTopupActionStatus">
                    {homeTopupMode === "pro" && <CheckCircle2 size={13} />}
                    {homeTopupMode === "pro"
                      ? (language === "vi" ? "Đang chọn" : "Selected")
                      : (language === "vi" ? "Chọn Pro" : "Choose Pro")}
                  </small>
                </button>
                <button
                  type="button"
                  className={`homeTopupAction credit ${homeTopupMode === "credit" ? "active" : ""}`}
                  onClick={() => setHomeTopupMode("credit")}
                  aria-pressed={homeTopupMode === "credit"}
                >
                  <Wallet size={18} />
                  <span>Credit</span>
                  <small>{language === "vi" ? "Số dư chỉ dùng cho Getlink" : "Getlink-only balance"}</small>
                  <small className="homeTopupActionStatus">
                    {homeTopupMode === "credit" && <CheckCircle2 size={13} />}
                    {homeTopupMode === "credit"
                      ? (language === "vi" ? "Đang chọn" : "Selected")
                      : (language === "vi" ? "Chọn Credit" : "Choose Credit")}
                  </small>
                </button>
              </div>
            </div>

            <div className={`homeTopupCurrentMode ${homeTopupMode}`} aria-live="polite">
              <CheckCircle2 size={16} />
              <span>{language === "vi" ? "Đang hiển thị:" : "Showing:"}</span>
              <strong>
                {homeTopupMode === "credit"
                  ? (language === "vi" ? "Gói Credit cho Getlink" : "Credit plans for Getlink")
                  : (language === "vi" ? "Gói Pro cho thư viện Model/Scene" : "Pro plans for the Model/Scene library")}
              </strong>
            </div>

            {homeTopupMode === "credit" ? (
              <div
                className="pricingGrid"
                style={{ "--package-count": Math.min(pricingPackages.length || 1, 5) }}
              >
                {pricingPackages.map((pkg, index) => (
                  <div
                    className="pricingCard"
                    key={pkg._id || pkg.name || index}
                    style={pkg.badge ? { borderColor: "var(--neon-green)", zIndex: 10 } : undefined}
                  >
                    {pkg.badge && (
                      <div
                        style={{
                          position: "absolute",
                          top: -12,
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "var(--neon-green)",
                          color: "#000",
                          padding: "2px 12px",
                          fontSize: 11,
                          fontWeight: "bold",
                          fontFamily: "var(--font-mono)"
                        }}
                      >
                        {pkg.badge}
                      </div>
                    )}
                    <h3>{pkg.name || t.defaultPackageName}</h3>
                    <div className="priceBlock">
                      {hasSale(pkg) && (
                        <div className="priceOriginal">
                          {Number(pkg.price).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}<span>đ</span>
                        </div>
                      )}
                      <div className="price hl-green">
                        {finalPrice(pkg).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}<span style={{ fontSize: 16 }}>đ</span>
                      </div>
                    </div>
                    {hasSale(pkg) && (
                      <div className="credits pricingSaleLine">
                        {language === "vi"
                          ? `SALE ${pkg.salePercent}% từ ${Number(pkg.price).toLocaleString("vi-VN")}đ`
                          : `SALE ${pkg.salePercent}% from ${Number(pkg.price).toLocaleString("en-US")}đ`}
                      </div>
                    )}
                    <div className="credits">{pkg.credit} CREDIT</div>
                    {Number(pkg.maxTopupsPerUser || 0) > 0 && (
                      <div className="credits" style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                        {language === "vi"
                          ? `Mỗi tài khoản nạp tối đa ${pkg.maxTopupsPerUser} lần`
                          : `Max ${pkg.maxTopupsPerUser} times/account`}
                      </div>
                    )}
                    <ul>
                      {((pkg.features && pkg.features.length > 0)
                        ? pkg.features
                        : t.defaultPackageFeatures
                      ).map((feature, featureIndex) => (
                        <li key={featureIndex}>{feature}</li>
                      ))}
                    </ul>
                    <a className={pkg.badge ? "primaryButton" : "googleButton"} href={authAwareHref(topupTarget("credit", pkg._id))}>
                      {user ? t.topupNow : t.buyNow}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="pricingGrid homeProPricingGrid"
                style={{ "--package-count": Math.min(membershipPlans.length || 1, 5) }}
              >
                {membershipPlans.map((plan) => (
                  <div className="pricingCard" key={plan._id || plan.code}>
                    {plan.badge && (
                      <div className="badge success" style={{ width: "fit-content" }}>
                        {plan.badge}
                      </div>
                    )}
                    <h3>{plan.name}</h3>
                    <div className="priceBlock">
                      <div className="price hl-green">
                        {Number(plan.price || 0).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}<span style={{ fontSize: 16 }}>đ</span>
                      </div>
                    </div>
                    <div className="credits">
                      {isDailyMembershipPlan(plan)
                        ? (language === "vi"
                          ? `Thêm ${plan.dailyDownloadLimit}/ngày khi cần`
                          : `Add ${plan.dailyDownloadLimit}/day when needed`)
                        : (language === "vi"
                          ? `${plan.durationDays} ngày - ${plan.dailyDownloadLimit}/ngày`
                          : `${plan.durationDays} days - ${plan.dailyDownloadLimit}/day`)}
                    </div>
                    {Number(plan.maxPurchasesPerUser || 0) > 0 && (
                      <div className="muted">
                        {language === "vi"
                          ? `Tối đa ${plan.maxPurchasesPerUser} lần/tài khoản`
                          : `Max ${plan.maxPurchasesPerUser} purchases/account`}
                      </div>
                    )}
                    <ul>
                      {(plan.features || []).map((feature, featureIndex) => (
                        <li key={featureIndex}>{membershipFeatureLabel(feature, language)}</li>
                      ))}
                    </ul>
                    <a className={plan.code === "GOLD" ? "primaryButton" : "googleButton"} href={authAwareHref(topupTarget("pro", plan._id))}>
                      {user ? t.topupNow : t.buyNow}
                    </a>
                  </div>
                ))}
                {!membershipPlans.length && (
                  <div className="pricingCard">
                    <h3>Pro</h3>
                    <div className="credits">{language === "vi" ? "Đang tải gói Pro..." : "Loading Pro plans..."}</div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="homeGuideSection" id="home-guide">
            <div className="sectionTitle">
              <h3>
                <BookOpen size={14} />
                {siteSettings.guideEyebrow || t.guide}
              </h3>
              <h2 className="glitchTitle subtle" data-text={siteSettings.guideTitle || t.guideList}>
                {siteSettings.guideTitle || t.guideList}
              </h2>
              <p>{siteSettings.guideIntro || t.guideIntro}</p>
            </div>

            <section className="guideLayout homeGuideLayout">
              <aside className="panel guideSidebar homeGuideSidebar">
                <h3>{siteSettings.guideTitle || t.guideList}</h3>
                {guideLoading && <p className="muted">{t.loading}</p>}
                {guideError && <p className="error">{guideError}</p>}
                {!guideLoading && !guideArticles.length && <p className="muted">{t.noGuides}</p>}
                <div className="guideNav">
                  {guideArticles.map((article) => (
                    <button
                      key={article._id}
                      type="button"
                      className={activeGuideArticle?.slug === article.slug ? "active" : ""}
                      onClick={() => setGuideActiveSlug(article.slug)}
                    >
                      <span>{article.title}</span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </aside>

              <article className="panel guideArticle homeGuideArticle">
                {activeGuideArticle ? (
                  <>
                    <h2>{activeGuideArticle.title}</h2>
                    {activeGuideArticle.coverImage && (
                      <figure className="guideImage guideCoverImage">
                        <img src={activeGuideArticle.coverImage} alt={activeGuideArticle.title} loading="lazy" referrerPolicy="no-referrer" />
                      </figure>
                    )}
                    {activeGuideArticle.summary && <p className="guideSummary">{activeGuideArticle.summary}</p>}
                    <div className="guideArticleBody">
                      <GuideContent content={activeGuideArticle.content} />
                    </div>
                    <div className="homeGuideActions">
                      <a className="googleButton" href="/guide">
                        {t.guide} <ArrowRight size={16} />
                      </a>
                    </div>
                  </>
                ) : (
                  <p className="muted">{guideLoading ? t.loading : t.noGuides}</p>
                )}
              </article>
            </section>
          </section>

          <section className="ctaSection">
            <h2 className="glitchTitle" data-text={siteSettings.ctaTitle || t.readyTitle} style={{ marginBottom: 16 }}>
              {siteSettings.ctaTitle || t.readyTitle}
            </h2>
            <p style={{ maxWidth: 500, margin: "0 auto 32px" }}>
              {user
                ? (siteSettings.ctaUserText || t.readyUser)
                : (siteSettings.ctaGuestText || t.readyGuest)}
            </p>
            <a className="primaryButton" href={authAwareHref("/getlink")}>
              <Chrome size={18} /> {user ? t.enterGetlink : t.googleLogin}
            </a>
          </section>

          <SiteFooter language={language} tagline={siteSettings.footerTagline || t.support247} />
        </>
      )}
    </div>
  );
}
