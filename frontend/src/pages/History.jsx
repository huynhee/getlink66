import React, { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Download, FileDown, Gift, LifeBuoy, Lock } from "lucide-react";
import RedownloadFormatModal from "../components/RedownloadFormatModal.jsx";
import { api, buildApiUrl } from "../api.js";
import { translations } from "../i18n.js";

const FACEBOOK_GROUP_URL = "https://www.facebook.com/groups/960223243551548";

function usableFormatCount(options = []) {
  return (Array.isArray(options) ? options : []).filter((option) => {
    const fileFormat = String(option.fileFormat || option.file_format || String(option.key || "").split("|")[0] || "").trim();
    return fileFormat && fileFormat !== "0";
  }).length;
}

function triggerBrowserDownload(downloadUrl) {
  if (!downloadUrl) return;
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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

function redownloadUsageLabel(item, language) {
  const used = Number(item.redownloadCount || 0);
  const limit = Number(item.redownloadLimit || 5);
  const remaining = Number.isFinite(Number(item.redownloadRemaining))
    ? Number(item.redownloadRemaining)
    : Math.max(0, limit - used);
  return language === "vi" ? `${remaining}/${limit} lượt` : `${remaining}/${limit} times`;
}

function topupTitle(item, t) {
  if (item.type === "manual" && !item.packageId) return t.adminCredit || "Admin cộng credit";
  return `${t.packagePrefix || "Gói"} ${item.packageId?.name || "Credit"}`;
}

function topupStatusLabel(item, t) {
  if (item.status === "approved") return { className: "success", label: t.success || "Thành công" };
  if (item.status === "pending") return { className: "pending", label: t.pending || "Chờ thanh toán" };
  return { className: "error", label: t.canceled || "Đã hủy" };
}

export default function History({ language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [downloadHistory, setDownloadHistory] = useState([]);
  const [topupHistory, setTopupHistory] = useState([]);
  const [referralHistory, setReferralHistory] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [redownloadItem, setRedownloadItem] = useState(null);
  const [redownloadPreparingId, setRedownloadPreparingId] = useState("");
  const redownloadText = language === "vi" ? "Tải lại" : "Redownload";

  useEffect(() => {
    Promise.all([
      api("/api/getlink/history"),
      api("/api/topup/history"),
      api("/api/referral/history"),
    ])
      .then(([downloads, topups, referrals]) => {
        setDownloadHistory(downloads.history || []);
        setTopupHistory(topups.history || []);
        setReferralHistory(referrals.history || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const downloads = downloadHistory.map((item) => ({
      kind: "download",
      id: `download-${item._id}`,
      date: item.createdAt,
      item,
    }));
    const topups = topupHistory.map((item) => ({
      kind: "topup",
      id: `topup-${item._id}`,
      date: item.createdAt,
      item,
    }));
    const referrals = referralHistory.map((item) => ({
      kind: "referral",
      id: `referral-${item._id}`,
      date: item.createdAt,
      item,
    }));
    return [...downloads, ...topups, ...referrals]
      .filter((row) => filter === "all" || row.kind === filter)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [downloadHistory, topupHistory, referralHistory, filter]);

  function redownloadMeta(item) {
    if (item.canRedownload) {
      return `${compactRemainingLabel(item.redownloadExpiresAt, language)} - ${redownloadUsageLabel(item, language)}`;
    }
    return `${language === "vi" ? "hết hạn" : "expired"} - ${redownloadUsageLabel(item, language)}`;
  }

  function handleRedownloadPrepared(historyId, data) {
    setDownloadHistory((items) =>
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
    try {
      const data = await api(`/api/getlink/redownload/${item._id}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (data.requiresFormatSelection) {
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
      triggerBrowserDownload(data.downloadUrl || data.url || item.downloadUrl || buildApiUrl(`/api/getlink/download/${item._id}`));
    } catch (err) {
      alert(err.message || (language === "vi" ? "Khong chuan bi duoc link tai lai." : "Cannot prepare redownload."));
    } finally {
      setRedownloadPreparingId("");
    }
  }

  function renderDownloadRow(item) {
    return (
      <>
        <span className="historyType">
          <FileDown size={14} />
          {item.productId}
        </span>
        <div className="historyDownloadCell">
          {item.canRedownload ? (
            <a
              href={item.downloadUrl || buildApiUrl(`/api/getlink/download/${item._id}`)}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => handleRedownloadClick(event, item)}
            >
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
            {redownloadMeta(item)}
          </small>
        </div>
        <time>{new Date(item.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</time>
      </>
    );
  }

  function renderTopupRow(item) {
    const status = topupStatusLabel(item, t);
    return (
      <>
        <span className="historyType">
          <ArrowRightLeft size={14} />
          {topupTitle(item, t)}
        </span>
        <div className="historyDownloadCell">
          <strong>+{item.credit} credit</strong>
          <small className="historyMeta">
            {Number(item.amount || 0).toLocaleString("vi-VN")}đ
          </small>
        </div>
        <div className="historyStatusTime">
          <span className={`badge ${status.className}`}>{status.label}</span>
          <time>{new Date(item.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</time>
        </div>
      </>
    );
  }

  function renderReferralRow(item) {
    const otherName = item.otherUser?.name || item.otherUser?.email || (language === "vi" ? "bạn bè" : "friend");
    const label = item.role === "referrer"
      ? (language === "vi" ? `Mời ${otherName}` : `Invited ${otherName}`)
      : (language === "vi" ? `Được ${otherName} mời` : `Invited by ${otherName}`);
    return (
      <>
        <span className="historyType">
          <Gift size={14} />
          {language === "vi" ? "Mời bạn bè" : "Referral"}
        </span>
        <div className="historyDownloadCell">
          <strong>+{item.credit} credit</strong>
          <small className="historyMeta">{label}</small>
        </div>
        <div className="historyStatusTime">
          <span className="badge success">{language === "vi" ? "Đã cộng" : "Credited"}</span>
          <time>{new Date(item.createdAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</time>
        </div>
      </>
    );
  }

  return (
    <section className="panel">
      <div className="historyHeader">
        <h2>{language === "vi" ? "Lịch sử" : "History"}</h2>
        <div className="historyHeaderActions">
          <a className="smallButton historySupportButton" href={FACEBOOK_GROUP_URL} target="_blank" rel="noreferrer">
            <LifeBuoy size={14} />
            {language === "vi" ? "Hỗ trợ" : "Support"}
          </a>
        <div className="historyFilterBar" role="tablist" aria-label="History filter">
          {[
            ["all", language === "vi" ? "Tất cả" : "All"],
            ["download", language === "vi" ? "Tải model" : "Downloads"],
            ["topup", language === "vi" ? "Nạp credit" : "Top-ups"],
            ["referral", language === "vi" ? "Mời bạn" : "Referral"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={filter === value ? "active" : ""}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div className="table compactHistoryTable unifiedHistoryTable">
        {rows.map((row) => (
          <div
            className={`tableRow ${row.kind === "topup" || row.kind === "referral" ? "topupHistoryRow" : ""}`}
            key={row.id}
          >
            {row.kind === "download"
              ? renderDownloadRow(row.item)
              : row.kind === "referral"
                ? renderReferralRow(row.item)
                : renderTopupRow(row.item)}
          </div>
        ))}
        {!loading && !rows.length && (
          <p className="muted" style={{ textAlign: "center", padding: "32px 0" }}>
            {language === "vi" ? "Chưa có lịch sử phù hợp." : "No matching history yet."}
          </p>
        )}
        {loading && (
          <p className="muted" style={{ textAlign: "center", padding: "32px 0" }}>
            {t.loading || "Loading..."}
          </p>
        )}
      </div>
      <RedownloadFormatModal
        item={redownloadItem}
        language={language}
        onClose={() => setRedownloadItem(null)}
        onDone={handleRedownloadPrepared}
      />
    </section>
  );
}
