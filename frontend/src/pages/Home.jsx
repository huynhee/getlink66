import React, { useEffect, useState } from "react";
import GetlinkBox from "../components/GetlinkBox.jsx";
import { Coins, FileDown, Download, Lock, ArrowRightLeft } from "lucide-react";
import { api, buildApiUrl } from "../api.js";
import { translations } from "../i18n.js";

function compactRemainingLabel(expiresAt, language) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return language === "vi" ? "hết hạn" : "expired";
  const totalMinutes = Math.ceil(diff / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const formatted = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return language === "vi" ? `còn ${formatted} giờ` : `${formatted}h left`;
}

function redownloadUsageLabel(item, language = "vi") {
  const used = Number(item.redownloadCount || 0);
  const limit = Number(item.redownloadLimit || 5);
  const remaining = Number.isFinite(Number(item.redownloadRemaining))
    ? Number(item.redownloadRemaining)
    : Math.max(0, limit - used);
  return language === "vi" ? `${remaining}/${limit} lượt` : `${remaining}/${limit} times`;
}

export default function Home({ user, onUserChange, language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [getlinkHistory, setGetlinkHistory] = useState([]);
  const [topupHistory, setTopupHistory] = useState([]);
  const initialUrl = new URLSearchParams(window.location.search).get("url") || "";
  const redownloadText = language === "vi" ? "Tải lại" : "Redownload";

  function updateCredit(credit) {
    onUserChange({ ...user, credit });
  }

  function topupTitle(item) {
    if (item.type === "manual" && !item.packageId) return t.adminCredit;
    return `${t.packagePrefix} ${item.packageId?.name || "Credit"}`;
  }

  function redownloadMeta(item) {
    if (item.canRedownload) {
      return `${compactRemainingLabel(item.redownloadExpiresAt, language)} - ${redownloadUsageLabel(item, language)}`;
    }
    return `${language === "vi" ? "hết hạn" : "expired"} - ${redownloadUsageLabel(item)}`;
  }

  useEffect(() => {
    api("/api/getlink/history").then((data) => setGetlinkHistory(data.history || []));
    api("/api/topup/history").then((data) => setTopupHistory(data.history || []));
  }, [user.credit]);

  return (
    <div className="dashboard">
      <section className="accountCard">
        <div className="userBlock">
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} />
          ) : (
            <div className="avatarFallback">{user.name?.[0] || "U"}</div>
          )}
          <div>
            <h2>{user.name}</h2>
            <p>{user.email}</p>
          </div>
        </div>
        <div className="creditBadge">
          <Coins size={22} color="var(--neon-green)" />
          <strong>{user.credit}</strong>
          <span>credit</span>
        </div>
      </section>

      <a
        className="downloadGuideBanner"
        href="https://www.youtube.com/watch?v=0KfSasds-2I"
        target="_blank"
        rel="noreferrer"
      >
        hướng dẫn tải tốc độ bàn thờ - bấm vào đây để xem
      </a>

      <GetlinkBox onCreditChange={updateCredit} initialUrl={initialUrl} language={language} />

      <div className="dashboardHistoryGrid">
        <section className="panel">
          <h2 style={{ fontSize: 18 }}>
            <FileDown size={18} color="var(--neon-magenta)" />
            {t.getlinkHistory}
          </h2>
          <div className="table compactHistoryTable">
            {getlinkHistory.map((item) => (
              <div className="tableRow" key={item._id}>
                <span style={{ color: "var(--text-primary)" }}>{item.productId}</span>
                <div className="historyDownloadCell">
                  {item.canRedownload ? (
                    <a href={item.downloadUrl || buildApiUrl(`/api/getlink/download/${item._id}`)} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                      {redownloadText}
                      <Download size={10} style={{ marginLeft: 4, verticalAlign: "-1px" }} />
                    </a>
                  ) : (
                    <span className="historyExpired" style={{ fontSize: 12 }}>
                      <Lock size={10} />
                      {redownloadText}
                    </span>
                  )}
                  <small className={item.canRedownload ? "historyMeta" : "historyMeta expired"}>
                    {redownloadMeta(item)}
                  </small>
                </div>
                <time>{new Date(item.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</time>
              </div>
            ))}
            {!getlinkHistory.length && (
              <p className="muted" style={{ textAlign: "center", padding: "32px 0", fontSize: 13 }}>
                {t.noDownloadHistory}
              </p>
            )}
          </div>
        </section>

        <section className="panel">
          <h2 style={{ fontSize: 18 }}>
            <ArrowRightLeft size={18} color="var(--neon-cyan)" />
            {t.topupHistory}
          </h2>
          <div className="table compactHistoryTable">
            {topupHistory.map((item) => (
              <div className="tableRow" key={item._id}>
                <span style={{ color: "var(--text-primary)" }}>{topupTitle(item)}</span>
                <strong>+{item.credit} credit</strong>
                <span>
                  {item.status === "approved" ? (
                    <span className="badge success">{t.success}</span>
                  ) : item.status === "pending" ? (
                    <span className="badge pending">{t.pending}</span>
                  ) : (
                    <span className="badge error">{t.canceled}</span>
                  )}
                </span>
                <time>{new Date(item.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</time>
              </div>
            ))}
            {!topupHistory.length && (
              <p className="muted" style={{ textAlign: "center", padding: "32px 0", fontSize: 13 }}>
                {t.noTopupHistory}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
