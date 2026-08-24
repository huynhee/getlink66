import React, { useEffect, useState } from "react";
import CoinAmount, { CoinIcon } from "../components/CoinAmount.jsx";
import GetlinkBox from "../components/GetlinkBox.jsx";
import RedownloadFormatModal from "../components/RedownloadFormatModal.jsx";
import { FileDown, Download, LifeBuoy, Lock, ArrowRightLeft } from "lucide-react";
import { api, buildApiUrl } from "../api.js";
import { translations } from "../i18n.js";
import { closeDownloadWindow, openDownloadWindow, triggerBrowserDownload } from "../utils/downloadWindow.js";

const FACEBOOK_GROUP_URL = "https://www.facebook.com/groups/960223243551548";

function usableFormatCount(options = []) {
  return (Array.isArray(options) ? options : []).filter((option) => {
    const fileFormat = String(option.fileFormat || option.file_format || String(option.key || "").split("|")[0] || "").trim();
    return fileFormat && fileFormat !== "0";
  }).length;
}

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
  const [creditHistory, setCreditHistory] = useState([]);
  const [redownloadItem, setRedownloadItem] = useState(null);
  const [redownloadPreparingId, setRedownloadPreparingId] = useState("");
  const initialUrl = new URLSearchParams(window.location.search).get("url") || "";
  const redownloadText = language === "vi" ? "Tải lại" : "Redownload";

  function updateCredit(credit) {
    onUserChange((current) => current ? { ...current, credit } : current);
  }

  function redownloadMeta(item) {
    if (item.canRedownload) {
      return `${compactRemainingLabel(item.redownloadExpiresAt, language)} - ${redownloadUsageLabel(item, language)}`;
    }
    return `${language === "vi" ? "hết hạn" : "expired"} - ${redownloadUsageLabel(item)}`;
  }

  function handleRedownloadPrepared(historyId, data) {
    setGetlinkHistory((items) =>
      items.map((item) =>
        item._id === historyId
          ? {
              ...item,
              downloadUrl: data.downloadUrl || item.downloadUrl,
              previewImageDownloadUrl: data.previewImageDownloadUrl || item.previewImageDownloadUrl,
              downloadFormat: data.selectedFormat || item.downloadFormat,
              formatOptions: data.formatOptions || item.formatOptions,
              redownloadCount: data.redownloadCount ?? item.redownloadCount,
              redownloadRemaining: data.redownloadRemaining ?? item.redownloadRemaining,
              redownloadExpiresAt: data.redownloadExpiresAt || item.redownloadExpiresAt,
            }
          : item,
      ),
    );
  }

  async function handleRedownloadClick(event, item) {
    if (!item.canRedownload) return;
    event.preventDefault();
    if (redownloadPreparingId === item._id) return;

    if (usableFormatCount(item.formatOptions) > 1) {
      setRedownloadItem(item);
      return;
    }

    setRedownloadPreparingId(item._id);
    const downloadWindow = openDownloadWindow();
    try {
      const data = await api(`/api/getlink/redownload/${item._id}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (data.requiresFormatSelection) {
        closeDownloadWindow(downloadWindow);
        setRedownloadItem({
          ...item,
          title: data.title || item.title,
          productId: data.productId || item.productId,
          imageUrl: data.imageUrl || item.imageUrl,
          downloadFormat: data.selectedFormat || item.downloadFormat,
          formatOptions: data.formatOptions || item.formatOptions,
        });
        return;
      }
      handleRedownloadPrepared(item._id, data);
      triggerBrowserDownload(
        data.downloadUrl || data.url || item.downloadUrl || buildApiUrl(`/api/getlink/download/${item._id}`),
        downloadWindow,
      );
    } catch (err) {
      closeDownloadWindow(downloadWindow);
      alert(err.message || (language === "vi" ? "Khong chuan bi duoc link tai lai." : "Cannot prepare redownload."));
    } finally {
      setRedownloadPreparingId("");
    }
  }

  useEffect(() => {
    api("/api/getlink/history").then((data) => setGetlinkHistory(data.history || []));
    api("/api/history/timeline?type=credit&page=1&limit=50")
      .then((data) => setCreditHistory(data.events || []));
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
          <CoinIcon size={22} />
          <strong>{user.credit}</strong>
        </div>
      </section>

      <GetlinkBox
        userId={user._id}
        onCreditChange={updateCredit}
        initialUrl={initialUrl}
        language={language}
        disabledReason={user.isBanned ? (user.banReason || "Tài khoản của bạn đã bị ban getlink.") : ""}
      />

      <div className="dashboardHistoryGrid">
        <section className="panel">
          <div className="historyPanelHeader">
            <h2 style={{ fontSize: 18 }}>
              <FileDown size={18} color="var(--neon-magenta)" />
              {t.getlinkHistory}
            </h2>
            <a className="smallButton historySupportButton" href={FACEBOOK_GROUP_URL} target="_blank" rel="noreferrer">
              <LifeBuoy size={14} />
              {language === "vi" ? "Hỗ trợ" : "Support"}
            </a>
          </div>
          <div className="table compactHistoryTable">
            {getlinkHistory.map((item) => (
              <div className="tableRow" key={item._id}>
                <span style={{ color: "var(--text-primary)" }}>{item.productId}</span>
                <div className="historyDownloadCell">
                  {item.canRedownload ? (
                    <a
                      href={item.downloadUrl || buildApiUrl(`/api/getlink/download/${item._id}`)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12 }}
                      onClick={(event) => handleRedownloadClick(event, item)}
                    >
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
            {creditHistory.map((item) => {
              const amount = Number(item.amount || 0);
              const productId = item.type === "getlink" ? item.metadata?.productId : "";
              return (
                <div className="tableRow" key={item.id}>
                  <span style={{ color: "var(--text-primary)", minWidth: 0 }}>
                    <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</strong>
                    {productId && <small className="historyMeta">ID: {productId}</small>}
                  </span>
                  <strong>
                    {amount ? <CoinAmount value={Math.abs(amount)} prefix={amount > 0 ? "+" : "-"} /> : "-"}
                  </strong>
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
              );
            })}
            {!creditHistory.length && (
              <p className="muted" style={{ textAlign: "center", padding: "32px 0", fontSize: 13 }}>
                {t.noTopupHistory}
              </p>
            )}
          </div>
        </section>
      </div>
      <RedownloadFormatModal
        item={redownloadItem}
        language={language}
        onClose={() => setRedownloadItem(null)}
        onDone={handleRedownloadPrepared}
      />
    </div>
  );
}
