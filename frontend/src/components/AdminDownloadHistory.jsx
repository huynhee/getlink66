import React, { useEffect, useState } from "react";
import { Box, FileDown, Search } from "lucide-react";
import { api } from "../api.js";
import { text } from "../i18n.js";
import CoinAmount from "./CoinAmount.jsx";
import Pagination from "./Pagination.jsx";

function statusClass(status) {
  if (["active", "used", "downloaded"].includes(status)) return "success";
  if (status === "expired") return "pending";
  return "error";
}

function visibleSourceUrl(value = "") {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return String(value).split("#")[0];
  }
}

export default function AdminDownloadHistory({
  language = "vi",
  getlinkRecords = [],
  getlinkSearch = "",
  onGetlinkSearchChange,
  getlinkPagination = { page: 1, totalPages: 1, total: 0 },
  onGetlinkPageChange,
}) {
  const l = (vi, en) => text(language, vi, en);
  const locale = language === "vi" ? "vi-VN" : "en-US";
  const [activeTab, setActiveTab] = useState("getlink");
  const [downloads, setDownloads] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [downloadPage, setDownloadPage] = useState(1);
  const [sessionPage, setSessionPage] = useState(1);
  const [downloadPagination, setDownloadPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [sessionPagination, setSessionPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [clientType, setClientType] = useState("all");
  const [assetType, setAssetType] = useState("all");
  const [accessTier, setAccessTier] = useState("all");
  const [paymentMethod, setPaymentMethod] = useState("all");
  const [sessionStatus, setSessionStatus] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (activeTab !== "model") return undefined;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const downloadQuery = new URLSearchParams({
          page: String(downloadPage),
          limit: "20",
          clientType,
          accessTier,
          assetType,
          paymentMethod,
        });
        const sessionQuery = new URLSearchParams({
          page: String(sessionPage),
          limit: "20",
          clientType,
          status: sessionStatus,
          assetType,
          paymentMethod,
        });
        const [downloadData, sessionData] = await Promise.all([
          api(`/api/admin/marketplace/downloads?${downloadQuery.toString()}`),
          api(`/api/admin/marketplace/download-sessions?${sessionQuery.toString()}`),
        ]);
        if (cancelled) return;
        setDownloads(downloadData.downloads || []);
        setSessions(sessionData.sessions || []);
        setDownloadPagination(downloadData.pagination || { page: 1, totalPages: 1, total: 0 });
        setSessionPagination(sessionData.pagination || { page: 1, totalPages: 1, total: 0 });
      } catch (requestError) {
        if (!cancelled) setError(requestError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accessTier, activeTab, assetType, clientType, downloadPage, paymentMethod, sessionPage, sessionStatus]);

  return (
    <section className="panel adminDownloadHistory">
      <h2><FileDown size={20} /> {l("Lịch sử tải", "Download history")}</h2>
      <div className="adminSubTabs" role="tablist" aria-label={l("Loại lịch sử tải", "Download history type")}>
        <button type="button" className={activeTab === "getlink" ? "active" : ""} onClick={() => setActiveTab("getlink")}>
          <FileDown size={15} /> Getlink
        </button>
        <button type="button" className={activeTab === "model" ? "active" : ""} onClick={() => setActiveTab("model")}>
          <Box size={15} /> Model & Scene
        </button>
      </div>

      {activeTab === "getlink" && (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            {l("Các lần user tạo link tải và số credit đã trừ. Tải lại miễn phí không tạo thêm dòng mới.", "User link-generation records and deducted credit. Free redownloads do not add new rows.")}
          </p>
          <div className="adminTableToolbar">
            <label className="adminSearchField">
              <Search size={15} />
              <input
                value={getlinkSearch}
                onChange={(event) => onGetlinkSearchChange?.(event.target.value)}
                placeholder={l("Tìm email, ID model hoặc tên model", "Search email, model ID, or model title")}
              />
            </label>
            <span className="muted">{getlinkPagination.total} {l("dòng", "rows")}</span>
          </div>
          <div className="table getlinkAuditTable" style={{ marginTop: 16 }}>
            {getlinkRecords.map((item) => (
              <div className="tableRow" key={item._id}>
                <div className="getlinkAuditUser">
                  <strong>{item.user?.email || l("Không rõ user", "Unknown user")}</strong>
                  <span>{item.user?.name || item.userId || ""}</span>
                </div>
                <div className="getlinkAuditModel">
                  <strong>{item.productId || "3D66"}</strong>
                  <span>{item.title || l("Không có tên model", "No model title")}</span>
                  <div className="getlinkAuditLinks">
                    {item.sourceUrl && <a href={visibleSourceUrl(item.sourceUrl)} target="_blank" rel="noreferrer">{l("Link user gửi", "User link")}</a>}
                    {item.resolvedSourceUrl && <a href={visibleSourceUrl(item.resolvedSourceUrl)} target="_blank" rel="noreferrer">{l("Link xử lý", "Resolved link")}</a>}
                  </div>
                </div>
                <span className={`badge ${Number(item.modelPrice || 0) !== Number(item.creditDeducted || 0) ? "error" : ""}`}>
                  {l("Giá", "Price")}: <CoinAmount value={Number(item.modelPrice || 0).toLocaleString(locale)} />{!item.priceKnown ? ` (${l("chưa chắc", "unconfirmed")})` : ""}
                </span>
                <strong>{l("Đã trừ", "Deducted")}: <CoinAmount value={Number(item.creditDeducted || 0).toLocaleString(locale)} /></strong>
                <span className="muted">{l("Tải lại", "Redownloads")}: {Number(item.redownloadCount || 0).toLocaleString(locale)}</span>
                <time>{new Date(item.createdAt).toLocaleString(locale)}</time>
              </div>
            ))}
            {!getlinkRecords.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>{l("Không có lịch sử Getlink phù hợp.", "No matching Getlink history.")}</p>}
          </div>
          <Pagination
            page={getlinkPagination.page}
            totalPages={getlinkPagination.totalPages}
            total={getlinkPagination.total}
            onPageChange={onGetlinkPageChange}
            language={language}
            itemLabel={l("lượt Getlink", "Getlinks")}
          />
        </>
      )}

      {activeTab === "model" && (
        <>
          <div className="adminTableToolbar" style={{ marginTop: 14 }}>
            <select value={assetType} onChange={(event) => { setAssetType(event.target.value); setDownloadPage(1); setSessionPage(1); }}>
              <option value="all">{l("Model và Scene", "Models and scenes")}</option>
              <option value="model">Model</option>
              <option value="scene">Scene</option>
            </select>
            <select value={clientType} onChange={(event) => { setClientType(event.target.value); setDownloadPage(1); setSessionPage(1); }}>
              <option value="all">{l("Mọi nguồn tải", "All clients")}</option>
              <option value="web">Web</option>
              <option value="plugin">Plugin</option>
            </select>
            <select value={accessTier} onChange={(event) => { setAccessTier(event.target.value); setDownloadPage(1); }}>
              <option value="all">{l("Mọi loại tài khoản", "All account tiers")}</option>
              <option value="free">Free</option>
              <option value="member">Pro</option>
              <option value="admin">Admin</option>
            </select>
            <select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value); setDownloadPage(1); setSessionPage(1); }}>
              <option value="all">{l("Mọi phương thức", "All payment methods")}</option>
              <option value="free_quota">{l("Lượt Free", "Free quota")}</option>
              <option value="pro_quota">{l("Lượt Pro", "Pro quota")}</option>
              <option value="credit">Credit</option>
            </select>
            <select value={sessionStatus} onChange={(event) => { setSessionStatus(event.target.value); setSessionPage(1); }}>
              <option value="all">{l("Mọi trạng thái phiên", "All session statuses")}</option>
              <option value="active">Active</option>
              <option value="used">Used</option>
              <option value="expired">Expired</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
          {error && <p className="error" style={{ marginTop: 12 }}>{error}</p>}
          {loading && <p className="muted" style={{ marginTop: 12 }}>{l("Đang tải lịch sử tài nguyên...", "Loading asset history...")}</p>}
          <div className="marketAdminAuditGrid" style={{ marginTop: 16 }}>
            <div className="runtimeSettingGroup">
              <h3>{l("Lượt tải model và scene", "Model and scene downloads")}</h3>
              <div className="marketAdminLogList">
                {downloads.map((item) => (
                  <div className="marketAdminLogItem" key={item._id}>
                    <div>
                      <strong>{item.modelId?.title || (item.assetType === "scene" ? "Scene" : "Model")}</strong>
                      <span className="marketAdminLogMeta">{item.userId?.email || item.guestKey || l("Dữ liệu cũ", "Legacy record")} · {item.clientType} · {item.accessTier === "member" ? "Pro" : item.accessTier === "admin" ? "Admin" : "Free"}</span>
                    </div>
                    <span className={`badge ${item.quotaCharged || item.billingStatus === "charged" ? "success" : ""}`}>
                      {item.paymentMethod === "credit"
                        ? (item.billingStatus === "charged"
                          ? `${Number(item.creditCost || 0)} Credit`
                          : l("Credit · tải lại 24 giờ", "Credit · 24h redownload"))
                        : item.quotaCharged
                        ? `${item.assetType === "scene" ? "Scene" : "Model"} · ${Number(item.quotaCost || (item.assetType === "scene" ? 5 : 1))} ${l("lượt", "downloads")}`
                        : l("Miễn phí", "No quota charge")}
                    </span>
                    <time>{new Date(item.createdAt).toLocaleString(locale)}</time>
                  </div>
                ))}
                {!loading && !downloads.length && <p className="muted">{l("Chưa có lượt tải model hoặc scene.", "No model or scene downloads yet.")}</p>}
              </div>
              <Pagination
                page={downloadPagination.page}
                totalPages={downloadPagination.totalPages}
                total={downloadPagination.total}
                onPageChange={setDownloadPage}
                language={language}
                itemLabel={l("lượt tải", "downloads")}
              />
            </div>
            <div className="runtimeSettingGroup">
              <h3>{l("Phiên tải model và scene", "Model and scene sessions")}</h3>
              <div className="marketAdminLogList">
                {sessions.map((item) => (
                  <div className="marketAdminLogItem" key={item._id}>
                    <div>
                      <strong>{item.modelId?.title || l("Phiên tải", "Download session")}</strong>
                      <span className="marketAdminLogMeta">{item.userId?.email || item.guestKey || l("Dữ liệu cũ", "Legacy record")} · {item.clientType} · {item.accessTier === "member" ? "Pro" : item.accessTier === "admin" ? "Admin" : "Free"}</span>
                    </div>
                    <span className={`badge ${statusClass(item.status)}`}>
                      {item.assetType === "scene" ? "Scene" : "Model"} · {item.status} · {item.paymentMethod === "credit" ? "Credit" : item.paymentMethod === "pro_quota" ? "Pro" : "Free"}
                    </span>
                    <time>{new Date(item.createdAt).toLocaleString(locale)}</time>
                  </div>
                ))}
                {!loading && !sessions.length && <p className="muted">{l("Chưa có phiên tải model hoặc scene.", "No model or scene sessions yet.")}</p>}
              </div>
              <Pagination
                page={sessionPagination.page}
                totalPages={sessionPagination.totalPages}
                total={sessionPagination.total}
                onPageChange={setSessionPage}
                language={language}
                itemLabel={l("phiên tải", "download sessions")}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
