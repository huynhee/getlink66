import React, { useEffect, useState } from "react";
import { FileDown, Download, Lock } from "lucide-react";
import { api, buildApiUrl } from "../api.js";
import { translations } from "../i18n.js";

export default function History({ language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [history, setHistory] = useState([]);
  const redownloadText = language === "vi" ? "Tải lại" : "Redownload";

  useEffect(() => {
    api("/api/getlink/history").then((data) => setHistory(data.history || []));
  }, []);

  function remainingLabel(expiresAt) {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(diff) || diff <= 0) return t.redownloadExpired || "Expired";
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const hours = Math.ceil((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    if (language === "vi") {
      return days > 0 ? `Còn ${days} ngày ${hours} giờ` : `Còn ${hours} giờ`;
    }
    return days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
  }

  return (
    <section className="panel">
      <h2>{t.getlinkHistory}</h2>
      <div className="table">
        {history.map((item) => (
          <div className="tableRow" key={item._id}>
            <span>
              <FileDown size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
              {item.productId}
            </span>
            <div className="historyDownloadCell">
              {item.canRedownload ? (
                <a href={item.downloadUrl || buildApiUrl(`/api/getlink/download/${item._id}`)} target="_blank" rel="noreferrer">
                  {redownloadText}
                  <Download size={12} style={{ marginLeft: 6, verticalAlign: "-1px", opacity: 0.6 }} />
                </a>
              ) : (
                <span className="historyExpired">
                  <Lock size={12} />
                  {redownloadText}
                </span>
              )}
              <small className={item.canRedownload ? "historyMeta" : "historyMeta expired"}>
                {item.canRedownload ? `${t.freeRedownload || "Free redownload"} · ${remainingLabel(item.redownloadExpiresAt)}` : (t.redownloadExpired || "Redownload expired")}
              </small>
            </div>
            <time>{new Date(item.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</time>
          </div>
        ))}
        {!history.length && (
          <p className="muted" style={{ textAlign: "center", padding: "32px 0" }}>
            {t.noDownloadHistory}
          </p>
        )}
      </div>
    </section>
  );
}
