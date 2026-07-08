import React, { useState } from "react";
import { AlertCircle, ArrowRight, BookOpen, ChevronRight, Chrome, ClipboardPaste, ShieldCheck, UserPlus } from "lucide-react";
import { API_URL, api } from "../api.js";
import GuideContent from "../components/GuideContent.jsx";
import { translations } from "../i18n.js";

const HOME_TEXT_DEFAULTS = {
  vi: {
    heroEyebrow: "+ api 3d66 sdk",
    heroText: "SIÊU RẺ\nTẢI 3D66\nTỐC ĐỘ",
    heroSubtitle: "Dịch vụ getlink trung gian giúp bạn tải model từ 3D66 với giá rẻ hơn mua trực tiếp.",
    saleText: "",
    demoTitle: "Bắt đầu tải ngay",
    demoSubmitText: "GET LINK",
    systemStatusLabel: "Trạng thái hệ thống",
    pricePerDownloadLabel: "Giá tải chỉ từ",
    pricePerDownloadValue: "10K",
    referralTitleBoth: "Giới thiệu bạn bè, cả hai +1 lượt tải.",
    referralTitleReferrerOnly: "Giới thiệu bạn bè để +1 lượt tải.",
    pricingEyebrow: "Bảng giá",
    pricingTitle: "Chọn gói phù hợp",
    pricingNote: "Nạp credit tự động, cộng credit ngay sau khi chọn gói.",
    guideEyebrow: "Hướng dẫn",
    guideTitle: "Bài hướng dẫn",
    guideIntro: "Đọc hướng dẫn sử dụng Getlink, nạp credit và tải lại file đã mua.",
    ctaTitle: "Sẵn sàng bắt đầu?",
    ctaUserText: "Vào trang getlink để tải model 3D66 và quản lý credit của bạn.",
    ctaGuestText: "Đăng nhập Google để bắt đầu getlink 3D66 và quản lý credit của bạn.",
    footerTagline: "Hỗ trợ 24/7",
  },
  en: {
    heroEyebrow: "+ api 3d66 sdk",
    heroText: "FAST 3D66\nGETLINK\nSERVICE",
    heroSubtitle: "An intermediary getlink service that helps you download 3D66 models with a faster credit workflow.",
    saleText: "",
    demoTitle: "Start download",
    demoSubmitText: "GET LINK",
    systemStatusLabel: "System status",
    pricePerDownloadLabel: "Download price from",
    pricePerDownloadValue: "10K",
    referralTitleBoth: "Invite friends, both get rewards +1 download.",
    referralTitleReferrerOnly: "Invite friends to get +1 download.",
    pricingEyebrow: "Pricing",
    pricingTitle: "Choose the right package",
    pricingNote: "Automatic credit top-up after selecting a package.",
    guideEyebrow: "Guide",
    guideTitle: "Guide articles",
    guideIntro: "Read guides for Getlink, credit top-up, and redownloading purchased files.",
    ctaTitle: "Ready to start?",
    ctaUserText: "Open Getlink to download 3D66 models and manage your credit.",
    ctaGuestText: "Sign in with Google to start using 3D66 Getlink and manage your credit.",
    footerTagline: "24/7 support",
  },
};

function normalizeModelIdInput(value = "") {
  const text = String(value || "").trim();
  if (!text || /^https?:\/\//i.test(text) || /3d66\.com/i.test(text)) return "";
  return /^[A-Z0-9_-]{8,64}$/i.test(text) && /[A-Z]/i.test(text) && /\d{6,}/.test(text)
    ? text.toUpperCase()
    : "";
}

export default function Login({ user = null, onLogin, adminMode = false, returnTo = "/", language = "vi" }) {
  const t = { ...(translations[language] || translations.vi) };
  const [demoLink, setDemoLink] = useState("");
  const [demoError, setDemoError] = useState("");
  const [packages, setPackages] = useState([]);
  const [systemStatus, setSystemStatus] = useState({ online: true, message: "" });
  const [referral, setReferral] = useState(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [guideArticles, setGuideArticles] = useState([]);
  const [guideActiveSlug, setGuideActiveSlug] = useState("");
  const [guideLoading, setGuideLoading] = useState(true);
  const [guideError, setGuideError] = useState("");
  const [siteSettings, setSiteSettings] = useState({
    heroEyebrow: "+ api 3d66 sdk",
    heroText: language === "vi" ? "SIÊU RẺ\nTẢI 3D66\nTỐC ĐỘ" : "FAST 3D66\nGETLINK\nSERVICE",
    heroSubtitle: language === "vi"
      ? "Dịch vụ getlink trung gian giúp bạn tải model từ 3D66 với giá rẻ hơn mua trực tiếp."
      : "An intermediary getlink service that helps you download 3D66 models with a faster credit workflow.",
    saleText: "",
    demoTitle: language === "vi" ? "Bắt đầu tải ngay" : "Start download",
    demoSubmitText: "GET LINK",
    systemStatusLabel: language === "vi" ? "Trạng thái hệ thống" : "System status",
    pricePerDownloadLabel: language === "vi" ? "Giá tải chỉ từ" : "Download price from",
    pricePerDownloadValue: "10K",
    referralTitleBoth: language === "vi"
      ? "Giới thiệu bạn bè, cả hai +1 lượt tải."
      : "Invite friends, both get rewards +1 download.",
    referralTitleReferrerOnly: language === "vi"
      ? "Giới thiệu bạn bè để +1 lượt tải."
      : "Invite friends to get +1 download.",
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
      ? "Vào trang getlink để tải model 3D66 và quản lý credit của bạn."
      : "Open Getlink to download 3D66 models and manage your credit.",
    ctaGuestText: language === "vi"
      ? "Đăng nhập Google để bắt đầu getlink 3D66 và quản lý credit của bạn."
      : "Sign in with Google to start using 3D66 Getlink and manage your credit.",
    footerTagline: language === "vi" ? "Hỗ trợ 24/7" : "24/7 support",
    ...HOME_TEXT_DEFAULTS[language]
  });
  const demoCursorText = demoLink || t.getlinkPlaceholder;
  const demoCursorX = Math.min(demoCursorText.length * 8.4, 520);
  if (referral?.mode === "referrer_only") {
    t.referralTitle = language === "vi"
      ? "Giới thiệu bạn bè để +1 lượt tải."
      : "Invite friends to get +1 download.";
  }

  React.useEffect(() => {
    if (!adminMode) {
      api("/api/settings")
        .then((data) => {
          if (data?.settings) {
            setSiteSettings((current) => ({ ...current, ...data.settings }));
          }
        })
        .catch(console.error);
      api("/api/topup/packages")
        .then((data) => setPackages(data.packages || []))
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
  }, [adminMode, language, t.systemOfflineMessage]);

  React.useEffect(() => {
    if (!user || adminMode) {
      setReferral(null);
      return;
    }
    api("/api/referral/me")
      .then(setReferral)
      .catch(() => setReferral(null));
  }, [user?._id, adminMode]);

  const pricingPackages = packages.length
    ? packages
    : [
      {
        name: language === "vi" ? "GÓI STARTER" : "STARTER PACKAGE",
        price: 50000,
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
    return user ? target : googleHref("/");
  }

  function getlinkTarget() {
    const modelId = normalizeModelIdInput(demoLink);
    return modelId ? `/getlink?url=${encodeURIComponent(modelId)}` : "/getlink";
  }

  function handleDemoGetlink(event) {
    event.preventDefault();
    if (!systemStatus.online) {
      setDemoError(t.systemOfflineMessage);
      return;
    }
    const modelId = normalizeModelIdInput(demoLink);
    if (!modelId) {
      setDemoError(t.invalid3d66Link);
      return;
    }
    setDemoLink(modelId);
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
      const modelId = normalizeModelIdInput(pasted);
      if (!modelId) {
        setDemoError(t.clipboardInvalid3d66);
        return;
      }

      setDemoLink(modelId);
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
    if ((referral?.mode || siteSettings.referralMode) === "referrer_only") {
      return language === "vi"
        ? "Giới thiệu bạn bè để +1 lượt tải."
        : "Invite friends to get +1 download.";
    }
    return t.referralTitle || (language === "vi"
      ? "Giới thiệu bạn bè, cả hai đều có quà"
      : "Invite friends, both get rewards");
  }

  function homepageReferralTitle() {
    if ((referral?.mode || siteSettings.referralMode) === "referrer_only") {
      return siteSettings.referralTitleReferrerOnly || referralTitle();
    }
    return siteSettings.referralTitleBoth || referralTitle();
  }

  return (
    <div className="landing">
      {!adminMode && (
        <div className="signalRail">
          <div className="signalTrack">
            {Array.from({ length: 4 }).map((_, index) => (
              <div className="signalGroup" key={index} aria-hidden={index === 1}>
                <span>+ LINK 3D66 READY</span>
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
              {siteSettings.heroEyebrow || "+ api 3d66 sdk"}
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
                <div className="linkInputWrap terminalInput" style={{ "--cursor-x": `${demoCursorX}px` }}>
                  <span className="terminalInputMirror" aria-hidden="true">{demoLink || t.getlinkPlaceholder}</span>
                  <input
                    type="text"
                    inputMode="text"
                    placeholder={t.getlinkPlaceholder}
                    value={demoLink}
                    onChange={(event) => {
                      setDemoLink(event.target.value.toUpperCase());
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
              <p style={{ maxWidth: 600, margin: "0 auto" }}>{siteSettings.pricingNote}</p>
            </div>

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
                    <div className="credits saleOnly" data-sale={pkg.salePercent}>
                      {language === "vi"
                        ? `SALE ${pkg.salePercent}% từ ${Number(pkg.price).toLocaleString("vi-VN")}đ`
                        : `SALE ${pkg.salePercent}% from ${Number(pkg.price).toLocaleString("en-US")}đ`}
                    </div>
                  )}
                  <div className="credits">{pkg.credit} CREDIT</div>
                  {Number(pkg.maxTopupsPerUser || 0) > 0 && (
                    <div className="credits" style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                      {language === "vi"
                        ? `Tối đa ${pkg.maxTopupsPerUser} lần/tài khoản`
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
                  <a className={pkg.badge ? "primaryButton" : "googleButton"} href={authAwareHref("/topup")}>
                    {user ? t.topupNow : t.buyNow}
                  </a>
                </div>
              ))}
            </div>
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

          <footer className="landingFooter">
            <div className="footerBrand">
              <strong>3DIPL</strong>
              <span>{siteSettings.footerTagline || t.support247}</span>
            </div>
            <nav>
              <h3>{t.product}</h3>
              <a href="#">{t.features}</a>
              <a href="#pricing">{t.pricing}</a>
              <a href="/guide">{t.docs}</a>
            </nav>
            <nav>
              <h3>{t.support}</h3>
              <a href="https://discord.gg/azu9mX6GhB" target="_blank" rel="noreferrer">Discord</a>
              <a href="https://www.facebook.com/groups/960223243551548" target="_blank" rel="noreferrer">Facebook Group</a>
            </nav>
            <nav>
              <h3>{t.legal}</h3>
              <a href="/privacy">{t.privacy}</a>
              <a href="/terms">{t.terms}</a>
            </nav>
          </footer>
        </>
      )}
    </div>
  );
}
