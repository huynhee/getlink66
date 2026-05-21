import React, { useState } from "react";
import { AlertCircle, ArrowRight, Chrome, ClipboardPaste, DownloadCloud, ShieldCheck } from "lucide-react";
import { API_URL, api } from "../api.js";
import { translations } from "../i18n.js";

export default function Login({ user = null, onLogin, adminMode = false, returnTo = "/", language = "vi" }) {
  const t = { ...(translations[language] || translations.vi) };
  const [demoLink, setDemoLink] = useState("");
  const [demoError, setDemoError] = useState("");
  const [packages, setPackages] = useState([]);
  const [systemStatus, setSystemStatus] = useState({ online: true, message: "" });
  const [referral, setReferral] = useState(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [siteSettings, setSiteSettings] = useState({
    heroText: language === "vi" ? "SIÊU RẺ\nTẢI 3D66\nTỐC ĐỘ" : "FAST 3D66\nGETLINK\nSERVICE",
    heroSubtitle: language === "vi"
      ? "Dịch vụ getlink trung gian giúp bạn tải model từ 3D66 với giá rẻ hơn mua trực tiếp."
      : "An intermediary getlink service that helps you download 3D66 models with a faster credit workflow.",
    saleText: "",
    pricingNote: language === "vi"
      ? "Nạp credit tự động, cộng credit ngay sau khi chọn gói."
      : "Automatic credit top-up after selecting a package."
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
          if (data?.settings) setSiteSettings(data.settings);
        })
        .catch(console.error);
      api("/api/topup/packages")
        .then((data) => setPackages(data.packages || []))
        .catch(console.error);
      api("/api/system/3d66-status")
        .then((data) => setSystemStatus({ online: Boolean(data.online), message: data.message || "" }))
        .catch(() => setSystemStatus({ online: false, message: t.systemOfflineMessage }));
    }
  }, [adminMode, t.systemOfflineMessage]);

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
    const trimmed = demoLink.trim();
    return trimmed ? `/getlink?url=${encodeURIComponent(trimmed)}` : "/getlink";
  }

  function handleDemoGetlink(event) {
    event.preventDefault();
    if (!systemStatus.online) {
      setDemoError(t.systemOfflineMessage);
      return;
    }
    if (!demoLink.includes("3d66.com")) {
      setDemoError(t.invalid3d66Link);
      return;
    }
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
      if (!pasted.includes("3d66.com")) {
        setDemoError(t.clipboardInvalid3d66);
        return;
      }

      setDemoLink(pasted);
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
    if (referral?.mode === "referrer_only") {
      return language === "vi"
        ? "Giới thiệu bạn bè để +1 lượt tải."
        : "Invite friends to get +1 download.";
    }
    return t.referralTitle || (language === "vi"
      ? "Giới thiệu bạn bè, cả hai đều có quà"
      : "Invite friends, both get rewards");
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
                <span>credit:live</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {!adminMode && (
        <section className="heroSection">
          <div className="heroLeft">
            <h3 className="eyebrowSignal" style={{ marginBottom: 16 }}>+ api 3d66 sdk</h3>
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
            {user && referral?.referralUrl && (
              <div className="referralInvite">
                <div>
                  <strong>{t.referralTitle || "Giới thiệu bạn, cả hai nhận một lượt tải"}</strong>
                  <span>{referral.referralCode}</span>
                </div>
                <button type="button" className="smallButton" onClick={copyReferralLink}>
                  {referralCopied ? t.copied : t.copy}
                </button>
              </div>
            )}
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
                {t.startDownload}
              </h2>
              <form onSubmit={handleDemoGetlink} className="inputWrapper">
                <div className="linkInputWrap terminalInput" style={{ "--cursor-x": `${demoCursorX}px` }}>
                  <span className="terminalInputMirror" aria-hidden="true">{demoLink || t.getlinkPlaceholder}</span>
                  <input
                    type="url"
                    placeholder={t.getlinkPlaceholder}
                    value={demoLink}
                    onChange={(event) => {
                      setDemoLink(event.target.value);
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
                  GET LINK
                </button>
              </form>
              {demoError && (
                <p className="error" style={{ marginTop: 8 }}>
                  <AlertCircle size={14} /> {demoError}
                </p>
              )}
              <div className="statusBox" style={{ marginTop: 24, paddingTop: 24, borderTop: "1px solid var(--border-warm)" }}>
                <div className="statusItem">
                  <span>{t.systemStatus}</span>
                  <strong className={systemStatus.online ? "ready" : "offline"}>
                    {systemStatus.online ? t.online : t.offline}
                  </strong>
                </div>
                <div className="statusItem">
                  <span>{t.pricePerDownload}</span>
                  <strong>10K</strong>
                </div>
              </div>
            </div>
            {user && referral?.referralUrl && (
              <div className="referralInvite">
                <div className="referralInviteHeader">
                  <strong>{t.referralTitle || "Giới thiệu bạn bè, cả hai +1 lượt tải"}</strong>
                  <span>{referral.referralCode}</span>
                </div>
                <div className="referralUrlRow">
                  <input value={referral.referralUrl} readOnly aria-label={t.referralTitle} />
                  <button type="button" className="smallButton" onClick={copyReferralLink}>
                    {referralCopied ? t.copied : t.copy}
                  </button>
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
              <h3>{t.pricing}</h3>
              <h2 className="glitchTitle subtle" data-text={t.choosePackage}>
                {t.choosePackage}
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

          <section className="ctaSection">
            <h2 className="glitchTitle" data-text={t.readyTitle} style={{ marginBottom: 16 }}>
              {t.readyTitle}
            </h2>
            <p style={{ maxWidth: 500, margin: "0 auto 32px" }}>
              {user
                ? t.readyUser
                : t.readyGuest}
            </p>
            <a className="primaryButton" href={authAwareHref("/getlink")}>
              <Chrome size={18} /> {user ? t.enterGetlink : t.googleLogin}
            </a>
          </section>

          <footer className="landingFooter">
            <div className="footerBrand">
              <strong>3DIPL</strong>
              <span>{t.support247}</span>
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
