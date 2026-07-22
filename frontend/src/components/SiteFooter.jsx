import React from "react";

const FOOTER_COPY = {
  vi: {
    tagline: "Thư viện model 3D, getlink và quyền tải Pro trong một tài khoản.",
    product: "Sản phẩm",
    account: "Tài khoản",
    support: "Hỗ trợ",
    legal: "Pháp lý",
    models: "Thư viện model",
    topup: "Gói nạp",
    guide: "Hướng dẫn",
    history: "Lịch sử",
    invite: "Giới thiệu",
    membership: "Quyền lợi Pro",
    privacy: "Chính sách bảo mật",
    terms: "Điều khoản sử dụng",
  },
  en: {
    tagline: "3D models, getlink and Pro downloads in one account.",
    product: "Product",
    account: "Account",
    support: "Support",
    legal: "Legal",
    models: "Model library",
    topup: "Top-up plans",
    guide: "Guides",
    history: "History",
    invite: "Invite friends",
    membership: "Pro benefits",
    privacy: "Privacy policy",
    terms: "Terms of use",
  },
};

export default function SiteFooter({ language = "vi", tagline = "", className = "" }) {
  const copy = FOOTER_COPY[language] || FOOTER_COPY.vi;
  return (
    <footer className={`landingFooter siteFooter ${className}`.trim()}>
      <div className="footerBrand">
        <strong>3DIPL</strong>
        <span>{tagline || copy.tagline}</span>
      </div>
      <nav>
        <h3>{copy.product}</h3>
        <a href="/models">{copy.models}</a>
        <a href="/scenes">{language === "vi" ? "Thư viện scene" : "Scene library"}</a>
        <a href="/getlink">Getlink</a>
        <a href="/topup">{copy.topup}</a>
        <a href="/guide">{copy.guide}</a>
      </nav>
      <nav>
        <h3>{copy.account}</h3>
        <a href="/history">{copy.history}</a>
        <a href="/invite">{copy.invite}</a>
        <a href="/membership">{copy.membership}</a>
      </nav>
      <nav>
        <h3>{copy.support}</h3>
        <a href="https://discord.gg/azu9mX6GhB" target="_blank" rel="noreferrer">Discord</a>
        <a href="https://www.facebook.com/groups/960223243551548" target="_blank" rel="noreferrer">Facebook Group</a>
      </nav>
      <nav>
        <h3>{copy.legal}</h3>
        <a href="/privacy">{copy.privacy}</a>
        <a href="/terms">{copy.terms}</a>
      </nav>
    </footer>
  );
}
