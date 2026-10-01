import React from "react";
import { ArrowDown, ArrowRight, Check, Download, Layers3 } from "lucide-react";
import "../pages/plugin-download.css";

const COPY = {
  vi: {
    eyebrow: "CÔNG CỤ CHO 3DS MAX",
    title: "3DIPL Plugin",
    hero: "Duyệt thư viện Model và Scene, tải về máy và làm việc trong 3ds Max từ một ứng dụng duy nhất.",
    download: "Tải plugin cho Windows",
    unavailable: "Bản tải chưa sẵn sàng",
    unavailableNote: "Bản cài đang được chuẩn bị. Bạn vẫn có thể xem hướng dẫn và duyệt thư viện trên web.",
    setup: "Xem cách cài đặt",
    badges: ["Dành cho 3ds Max", "Đăng nhập bằng tài khoản 3DIPL", "Model và Scene trong cùng thư viện"],
    demo: "Giới thiệu plugin 3DIPL"
  },
  en: {
    eyebrow: "BUILT FOR 3DS MAX",
    title: "3DIPL Plugin",
    hero: "Browse Models and Scenes, download them to your computer, and work in 3ds Max from one desktop app.",
    download: "Download for Windows",
    unavailable: "Download not available yet",
    unavailableNote: "The installer is being prepared. You can still read the guide and browse the library online.",
    setup: "How to get started",
    badges: ["For 3ds Max", "Sign in with your 3DIPL account", "Models and Scenes in one library"],
    demo: "3DIPL plugin demonstration"
  }
};

function getDownloadUrl() {
  const url = String(import.meta.env.VITE_3DSMAX_PLUGIN_DOWNLOAD_URL || "").trim();
  return url.startsWith("https://") || (url.startsWith("/") && !url.startsWith("//")) ? url : "";
}

function getDemoGifUrl() {
  const url = String(import.meta.env.VITE_3DSMAX_PLUGIN_DEMO_GIF_URL || "").trim();
  return url.startsWith("https://") || (url.startsWith("/") && !url.startsWith("//")) ? url : "";
}

export function PluginDownloadAction({ language = "vi", className = "" }) {
  const copy = COPY[language] || COPY.vi;
  const url = getDownloadUrl();
  if (!url) {
    return (
      <span className={`pluginCta pluginCtaDisabled ${className}`.trim()} aria-disabled="true">
        <Download size={19} aria-hidden="true" /> {copy.unavailable}
      </span>
    );
  }

  return (
    <a className={`pluginCta ${className}`.trim()} href={url}>
      <Download size={19} aria-hidden="true" /> {copy.download}
    </a>
  );
}

export default function PluginHero({ language = "vi", embedded = false }) {
  const copy = COPY[language] || COPY.vi;
  const downloadUrl = getDownloadUrl();
  const demoGifUrl = getDemoGifUrl();
  const Heading = embedded ? "h2" : "h1";
  const titleId = embedded ? "home-plugin-title" : "plugin-title";
  const SetupIcon = embedded ? ArrowRight : ArrowDown;

  return (
    <section className={`pluginHero${embedded ? " homePluginHero" : ""}`} aria-labelledby={titleId}>
      <div className="pluginHeroContent">
        <div className="pluginHeroCopy">
          <div className="pluginEyebrow"><span aria-hidden="true" />{copy.eyebrow}</div>
          <Heading className="pluginHeroTitle" id={titleId} aria-label={copy.title}>3DIPL <span>Plugin</span></Heading>
          <p>{copy.hero}</p>
          <div className="pluginHeroActions">
            <PluginDownloadAction language={language} />
            <a className="pluginTextLink" href={embedded ? "/plugin#plugin-setup" : "#plugin-setup"}>
              {copy.setup} <SetupIcon size={17} aria-hidden="true" />
            </a>
          </div>
          {!downloadUrl && <p className="pluginReleaseNote" role="status">{copy.unavailableNote}</p>}
          <ul className="pluginHeroBadges">
            {copy.badges.map((badge) => <li key={badge}><Check size={15} aria-hidden="true" />{badge}</li>)}
          </ul>
        </div>
        <div className="pluginHeroMedia" aria-hidden={!demoGifUrl}>
          {demoGifUrl ? (
            <img src={demoGifUrl} alt={copy.demo} loading={embedded ? "lazy" : "eager"} decoding="async" />
          ) : (
            <div className="pluginMediaEmpty">
              <div className="pluginMediaToolbar">
                <strong>3DiPL</strong>
                <span className="pluginMediaLights"><i /><i /><i /></span>
              </div>
              <div className="pluginMediaSymbol"><Layers3 size={44} strokeWidth={1.2} /></div>
              <div className="pluginMediaMeta"><span>MODEL / SCENE</span><span>3DS MAX</span></div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
