import React from "react";
import { ArrowDown, ArrowRight, Check, Download, FolderDown, Layers3, Monitor, ShieldCheck } from "lucide-react";
import SiteFooter from "../components/SiteFooter.jsx";
import "./plugin-download.css";

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
    workflowLabel: "QUY TRÌNH GỌN HƠN",
    workflowTitle: "Từ thư viện đến bản vẽ, không phải đổi công cụ liên tục.",
    workflowBody: "Tìm đúng tài nguyên, xem thông tin và chọn cách tải phù hợp với tài khoản của bạn.",
    features: [
      { title: "Tìm Model & Scene", body: "Duyệt thư viện 3DIPL và lọc tài nguyên theo danh mục, renderer hoặc phong cách." },
      { title: "Tải và quản lý file", body: "Tải tài nguyên về máy. Ứng dụng kiểm tra file và quản lý bản đã tải trong bộ nhớ đệm." },
      { title: "Đưa vào 3ds Max", body: "Merge Model vào scene đang mở; Scene được mở riêng để bạn làm việc tiếp." }
    ],
    stepsLabel: "BẮT ĐẦU",
    stepsTitle: "Sẵn sàng trong ba bước",
    steps: [
      { title: "Tải ứng dụng", body: "Tải bản dành cho Windows và làm theo hướng dẫn trong gói cài đặt." },
      { title: "Đăng nhập an toàn", body: "Mở ứng dụng, đăng nhập trên trình duyệt bằng tài khoản 3DIPL hoặc Google rồi trở về ứng dụng." },
      { title: "Kết nối 3ds Max", body: "Chọn phiên 3ds Max đang chạy, tìm tài nguyên và tải hoặc merge vào dự án." }
    ],
    finalTitle: "Bắt đầu làm việc với thư viện 3DIPL",
    finalBody: "Một tài khoản cho website và ứng dụng. Quyền Pro, Credit và lượt tải được dùng chung.",
    guide: "Mở hướng dẫn",
    note: "Yêu cầu Windows và 3ds Max để dùng chức năng kết nối Max. Bạn vẫn có thể duyệt, tải Model/Scene trên website."
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
    workflowLabel: "A SHORTER WORKFLOW",
    workflowTitle: "From library to project, without switching tools all day.",
    workflowBody: "Find the right asset, inspect its details, and choose the download method that fits your account.",
    features: [
      { title: "Find Models & Scenes", body: "Browse the 3DIPL library and filter assets by category, renderer, or style." },
      { title: "Download and manage files", body: "Download assets locally. The app verifies files and manages previously downloaded copies." },
      { title: "Bring assets into 3ds Max", body: "Merge Models into the open scene; Scenes open separately for further work." }
    ],
    stepsLabel: "GET STARTED",
    stepsTitle: "Ready in three steps",
    steps: [
      { title: "Download the app", body: "Download the Windows release and follow the instructions included in the package." },
      { title: "Sign in securely", body: "Open the app, sign in through your browser with 3DIPL or Google, then return to the app." },
      { title: "Connect 3ds Max", body: "Choose a running 3ds Max instance, find an asset, and download or merge it into your project." }
    ],
    finalTitle: "Get to work with the 3DIPL library",
    finalBody: "One account for the website and app. Pro access, Credit, and download quota stay in sync.",
    guide: "Open guide",
    note: "Windows and 3ds Max are needed for the Max integration. You can still browse and download Models or Scenes on the website."
  }
};

const FEATURE_ICONS = [Layers3, FolderDown, Monitor];

function getDownloadUrl() {
  const url = String(import.meta.env.VITE_3DSMAX_PLUGIN_DOWNLOAD_URL || "").trim();
  return url.startsWith("https://") || (url.startsWith("/") && !url.startsWith("//")) ? url : "";
}

function getDemoGifUrl() {
  const url = String(import.meta.env.VITE_3DSMAX_PLUGIN_DEMO_GIF_URL || "").trim();
  return url.startsWith("https://") || (url.startsWith("/") && !url.startsWith("//")) ? url : "";
}

function DownloadAction({ copy, url, className = "" }) {
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

export default function PluginDownload({ language = "vi" }) {
  const copy = COPY[language] || COPY.vi;
  const downloadUrl = getDownloadUrl();
  const demoGifUrl = getDemoGifUrl();

  return (
    <div className="pluginPage">
      <section className="pluginHero" aria-labelledby="plugin-title">
        <div className="pluginHeroContent">
          <div className="pluginHeroCopy">
            <div className="pluginEyebrow"><span aria-hidden="true" />{copy.eyebrow}</div>
            <h1 id="plugin-title" aria-label={copy.title}>3DIPL <span>Plugin</span></h1>
            <p>{copy.hero}</p>
            <div className="pluginHeroActions">
              <DownloadAction copy={copy} url={downloadUrl} />
              <a className="pluginTextLink" href="#plugin-setup">{copy.setup} <ArrowDown size={17} aria-hidden="true" /></a>
            </div>
            {!downloadUrl && <p className="pluginReleaseNote" role="status">{copy.unavailableNote}</p>}
            <ul className="pluginHeroBadges">
              {copy.badges.map((badge) => <li key={badge}><Check size={15} aria-hidden="true" />{badge}</li>)}
            </ul>
          </div>
          <div className="pluginHeroMedia" aria-hidden={!demoGifUrl}>
            {demoGifUrl ? (
              <img src={demoGifUrl} alt={language === "vi" ? "Giới thiệu plugin 3DIPL" : "3DIPL plugin demonstration"} />
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

      <section className="pluginWorkflow" aria-labelledby="plugin-workflow-title">
        <div className="pluginInner">
          <div className="pluginSectionHeading">
            <div>
              <span className="pluginSectionLabel">{copy.workflowLabel}</span>
              <h2 id="plugin-workflow-title">{copy.workflowTitle}</h2>
              <p>{copy.workflowBody}</p>
            </div>
            <a className="pluginLibraryLink" href="/models">{language === "vi" ? "Khám phá thư viện" : "Explore the library"} <ArrowRight size={17} aria-hidden="true" /></a>
          </div>
          <div className="pluginFeatureGrid">
            {copy.features.map((feature, index) => {
              const Icon = FEATURE_ICONS[index];
              return (
                <div className="pluginFeature" key={feature.title}>
                  <div className="pluginFeatureTop">
                    <Icon size={27} strokeWidth={1.6} aria-hidden="true" />
                    <span>0{index + 1}</span>
                  </div>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pluginSetup" id="plugin-setup" aria-labelledby="plugin-setup-title">
        <div className="pluginInner">
          <span className="pluginSectionLabel">{copy.stepsLabel}</span>
          <h2 id="plugin-setup-title">{copy.stepsTitle}</h2>
          <ol className="pluginSteps">
            {copy.steps.map((step, index) => (
              <li key={step.title}>
                <span className="pluginStepNumber">0{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="pluginEnd" aria-labelledby="plugin-end-title">
        <div className="pluginInner pluginEndInner">
          <div>
            <ShieldCheck size={26} strokeWidth={1.6} aria-hidden="true" />
            <h2 id="plugin-end-title">{copy.finalTitle}</h2>
            <p>{copy.finalBody}</p>
          </div>
          <div className="pluginEndActions">
            <DownloadAction copy={copy} url={downloadUrl} />
            <a className="pluginTextLink" href="/guide">{copy.guide} <ArrowRight size={17} aria-hidden="true" /></a>
          </div>
          <p className="pluginCompatibility">{copy.note}</p>
        </div>
      </section>
      <div className="pluginFooterWrap pluginInner"><SiteFooter language={language} /></div>
    </div>
  );
}
