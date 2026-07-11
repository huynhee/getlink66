import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  CalendarClock,
  Download,
  FileDown,
  Gift,
  LifeBuoy,
  RefreshCw,
  ShieldCheck,
  TicketPercent,
  Users,
  Wallet,
} from "lucide-react";
import CoinAmount from "../components/CoinAmount.jsx";
import RedownloadFormatModal from "../components/RedownloadFormatModal.jsx";
import { api, buildApiUrl } from "../api.js";
import { translations } from "../i18n.js";
import { closeDownloadWindow, openDownloadWindow, triggerBrowserDownload } from "../utils/downloadWindow.js";

const FACEBOOK_GROUP_URL = "https://www.facebook.com/groups/960223243551548";

const FILTERS = [
  ["all", "Tất cả", "All"],
  ["credit", "Credit", "Credit"],
  ["pro", "Pro", "Pro"],
  ["getlink", "Getlink", "Getlink"],
  ["model", "Model", "Model"],
  ["referral", "Giới thiệu", "Referral"],
  ["voucher", "Voucher", "Voucher"],
];

const TYPE_ICON = {
  credit: Wallet,
  pro: ShieldCheck,
  getlink: FileDown,
  model: Box,
  referral: Users,
  voucher: TicketPercent,
};

function formatDate(value, language) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(language === "vi" ? "vi-VN" : "en-US");
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("vi-VN")}đ`;
}

function statusLabel(status = "", language = "vi") {
  const value = String(status || "").toLowerCase();
  const map = {
    approved: ["Thành công", "Approved"],
    completed: ["Hoàn tất", "Completed"],
    downloaded: ["Đã tải", "Downloaded"],
    pending: ["Đang chờ", "Pending"],
    cancelled: ["Đã hủy", "Cancelled"],
    canceled: ["Đã hủy", "Canceled"],
    failed: ["Lỗi", "Failed"],
    expired: ["Hết hạn", "Expired"],
    used: ["Đã dùng", "Used"],
  };
  const pair = map[value] || [status || "-", status || "-"];
  return language === "vi" ? pair[0] : pair[1];
}

function statusClass(status = "") {
  const value = String(status || "").toLowerCase();
  if (["approved", "completed", "downloaded", "used"].includes(value)) return "success";
  if (["pending"].includes(value)) return "pending";
  return "error";
}

function eventAmount(event) {
  const amount = Number(event.amount || 0);
  if (!amount) return null;
  if (event.type === "credit" || event.type === "referral") {
    return <CoinAmount value={Math.abs(amount)} prefix={amount > 0 ? "+" : "-"} />;
  }
  if (event.type === "model") {
    return amount < 0 ? `${Math.abs(amount)} lượt` : "Miễn lượt";
  }
  return amount < 0 ? formatMoney(Math.abs(amount)) : formatMoney(amount);
}

function compactRemainingLabel(expiresAt, language) {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return language === "vi" ? "hết hạn" : "expired";
  const totalMinutes = Math.ceil(diff / (60 * 1000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return language === "vi"
    ? `còn ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} giờ`
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}h left`;
}

function redownloadUsageLabel(metadata = {}, language) {
  const used = Number(metadata.redownloadCount || 0);
  const limit = Number(metadata.redownloadLimit || 5);
  const remaining = Number.isFinite(Number(metadata.redownloadRemaining))
    ? Number(metadata.redownloadRemaining)
    : Math.max(0, limit - used);
  return language === "vi" ? `${remaining}/${limit} lượt` : `${remaining}/${limit} times`;
}

function metadataLines(event, language) {
  const m = event.metadata || {};
  if (event.type === "credit") {
    return [
      m.amountMoney ? `Thanh toán: ${formatMoney(m.amountMoney)}` : "",
      m.voucherCode ? `Voucher: ${m.voucherCode}` : "",
      m.paymentCode ? `Mã: ${m.paymentCode}` : "",
    ].filter(Boolean);
  }
  if (event.type === "pro") {
    return [
      m.planName || m.planCode ? `Gói: ${m.planName || m.planCode}` : "",
      m.activatedUntil ? `Hạn Pro: ${formatDate(m.activatedUntil, language)}` : "",
      m.quotaBoostAmount ? `Thêm lượt: ${m.quotaBoostAmount}` : "",
      m.voucherCode ? `Voucher: ${m.voucherCode}` : "",
    ].filter(Boolean);
  }
  if (event.type === "getlink") {
    return [
      m.productId ? `ID: ${m.productId}` : "",
      m.creditUsed ? `Credit: -${m.creditUsed}` : "",
      m.canRedownload ? `${compactRemainingLabel(m.redownloadExpiresAt, language)} - ${redownloadUsageLabel(m, language)}` : "",
    ].filter(Boolean);
  }
  if (event.type === "model") {
    return [
      m.model?.title || "",
      m.clientType ? `Client: ${m.clientType}` : "",
      m.quotaCharged ? "Có tính lượt" : "Miễn lượt",
    ].filter(Boolean);
  }
  if (event.type === "referral") {
    const other = m.otherUser?.name || m.otherUser?.email || "";
    return [other ? `User: ${other}` : "", m.referralCode ? `Mã: ${m.referralCode}` : ""].filter(Boolean);
  }
  if (event.type === "voucher") {
    return [
      m.voucherCode ? `Mã: ${m.voucherCode}` : "",
      m.targetKind ? `${language === "vi" ? "Loại" : "Type"}: ${m.targetKind === "pro" ? "Pro" : "Credit"}` : "",
      m.discountAmount ? `${language === "vi" ? "Giảm" : "Discount"}: ${formatMoney(m.discountAmount)}` : "",
    ].filter(Boolean);
  }
  return [];
}

export default function History({ language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState("all");
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [redownloadItem, setRedownloadItem] = useState(null);
  const [redownloadPreparingId, setRedownloadPreparingId] = useState("");

  const loadTimeline = useCallback(async (page = 1, nextFilter = "all") => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ type: nextFilter, page: String(page), limit: "20" });
      const data = await api(`/api/history/timeline?${query.toString()}`);
      setEvents(data.events || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTimeline(1, filter);
  }, [filter, loadTimeline]);

  const activeFilterLabel = useMemo(() => {
    const item = FILTERS.find(([key]) => key === filter);
    return item ? (language === "vi" ? item[1] : item[2]) : filter;
  }, [filter, language]);

  function handleRedownloadPrepared(historyId, data) {
    setEvents((items) =>
      items.map((event) =>
        event.metadata?.historyId === historyId
          ? {
              ...event,
              metadata: {
                ...event.metadata,
                downloadUrl: data.downloadUrl || event.metadata.downloadUrl,
                previewImageDownloadUrl: data.previewImageDownloadUrl || event.metadata.previewImageDownloadUrl,
                downloadFormat: data.selectedFormat || event.metadata.downloadFormat,
                formatOptions: data.formatOptions || event.metadata.formatOptions,
                redownloadCount: data.redownloadCount ?? event.metadata.redownloadCount,
                redownloadRemaining: data.redownloadRemaining ?? event.metadata.redownloadRemaining,
                redownloadExpiresAt: data.redownloadExpiresAt || event.metadata.redownloadExpiresAt,
              },
            }
          : event,
      ),
    );
  }

  async function redownload(event, metadata) {
    if (!metadata?.canRedownload || !metadata.historyId) return;
    if (redownloadPreparingId === metadata.historyId) return;
    const modalItem = {
      _id: metadata.historyId,
      title: event.title,
      productId: metadata.productId,
      imageUrl: metadata.imageUrl,
      downloadFormat: metadata.downloadFormat,
      formatOptions: metadata.formatOptions,
      canRedownload: metadata.canRedownload,
      redownloadCount: metadata.redownloadCount,
      redownloadLimit: metadata.redownloadLimit,
      redownloadRemaining: metadata.redownloadRemaining,
      redownloadExpiresAt: metadata.redownloadExpiresAt,
    };

    if ((metadata.formatOptions || []).length > 1) {
      setRedownloadItem(modalItem);
      return;
    }

    setRedownloadPreparingId(metadata.historyId);
    const downloadWindow = openDownloadWindow();
    try {
      const data = await api(`/api/getlink/redownload/${metadata.historyId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (data.requiresFormatSelection) {
        closeDownloadWindow(downloadWindow);
        setRedownloadItem({ ...modalItem, formatOptions: data.formatOptions || metadata.formatOptions });
        return;
      }
      handleRedownloadPrepared(metadata.historyId, data);
      triggerBrowserDownload(
        data.downloadUrl || data.url || metadata.downloadUrl || buildApiUrl(`/api/getlink/download/${metadata.historyId}`),
        downloadWindow,
      );
    } catch (err) {
      closeDownloadWindow(downloadWindow);
      setError(err.message || (language === "vi" ? "Không chuẩn bị được link tải lại." : "Cannot prepare redownload."));
    } finally {
      setRedownloadPreparingId("");
    }
  }

  return (
    <section className="panel historyTimelinePanel">
      <div className="historyHeader">
        <div>
          <h2>{language === "vi" ? "Lịch sử" : "History"}</h2>
          <p className="muted">
            {language === "vi"
              ? `Đang xem: ${activeFilterLabel}`
              : `Viewing: ${activeFilterLabel}`}
          </p>
        </div>
        <div className="historyHeaderActions">
          <a className="smallButton historySupportButton" href={FACEBOOK_GROUP_URL} target="_blank" rel="noreferrer">
            <LifeBuoy size={14} />
            {language === "vi" ? "Hỗ trợ" : "Support"}
          </a>
          <button type="button" className="smallButton" onClick={() => loadTimeline(pagination.page, filter)}>
            <RefreshCw size={14} />
            {language === "vi" ? "Tải lại" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="historyFilterBar" role="tablist" aria-label="History filter">
        {FILTERS.map(([value, vi, en]) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {language === "vi" ? vi : en}
          </button>
        ))}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="timelineHistoryList">
        {events.map((event) => {
          const Icon = TYPE_ICON[event.type] || CalendarClock;
          const amount = eventAmount(event);
          const lines = metadataLines(event, language);
          const metadata = event.metadata || {};
          return (
            <article className={`timelineEventCard ${event.type}`} key={event.id}>
              <div className="timelineEventIcon">
                <Icon size={18} />
              </div>
              <div className="timelineEventMain">
                <div className="timelineEventTitle">
                  <strong>{event.title}</strong>
                  <span className={`badge ${statusClass(event.status)}`}>{statusLabel(event.status, language)}</span>
                </div>
                {lines.length > 0 && (
                  <div className="timelineEventMeta">
                    {lines.map((line) => <span key={line}>{line}</span>)}
                  </div>
                )}
                {event.type === "getlink" && (
                  <button
                    type="button"
                    className="smallButton"
                    disabled={!metadata.canRedownload || redownloadPreparingId === metadata.historyId}
                    onClick={() => redownload(event, metadata)}
                  >
                    <Download size={14} />
                    {redownloadPreparingId === metadata.historyId
                      ? (language === "vi" ? "Đang chuẩn bị..." : "Preparing...")
                      : (language === "vi" ? "Tải lại" : "Redownload")}
                  </button>
                )}
              </div>
              <div className="timelineEventSide">
                {amount && <strong>{amount}</strong>}
                <time>{formatDate(event.createdAt, language)}</time>
              </div>
            </article>
          );
        })}

        {!loading && !events.length && (
          <section className="emptyState">
            <Gift size={28} />
            <p>{language === "vi" ? "Chưa có lịch sử phù hợp." : "No matching history yet."}</p>
          </section>
        )}

        {loading && (
          <p className="muted" style={{ textAlign: "center", padding: "32px 0" }}>
            {t.loading || "Loading..."}
          </p>
        )}
      </div>

      <div className="adminPagination">
        <button className="smallButton" disabled={pagination.page <= 1 || loading} onClick={() => loadTimeline(pagination.page - 1, filter)}>
          {language === "vi" ? "Trước" : "Prev"}
        </button>
        <span>
          {language === "vi" ? "Trang" : "Page"} {pagination.page}/{pagination.totalPages} - {pagination.total}
        </span>
        <button className="smallButton" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => loadTimeline(pagination.page + 1, filter)}>
          {language === "vi" ? "Sau" : "Next"}
        </button>
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
