import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Eye, FileJson, Loader2, Package, Pause, Plus, RefreshCw, Rocket, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { api, apiBinary, invalidateApiCache } from "../api.js";
import { text } from "../i18n.js";
import "./admin-plugin-releases.css";

const RELEASES_PATH = "/api/admin/plugin/releases";
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const UPLOAD_EXPIRED = "PLUGIN_RELEASE_UPLOAD_EXPIRED";
const EMPTY_DATA = { releases: [], channels: [], enabled: false, source: "", publicChannel: "" };

function releasePath(id) {
  return `${RELEASES_PATH}/${encodeURIComponent(id)}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}

function errorDetails(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return JSON.stringify(error, null, 2);
}

function isUploadExpired(release) {
  return Boolean(release?.uploadExpiredAt) || release?.error === UPLOAD_EXPIRED;
}

function releaseStatus(status, l) {
  return {
    draft: l("Bản nháp", "Draft"),
    verifying: l("Đang kiểm tra", "Verifying"),
    verified: l("Đã xác minh", "Verified"),
    published: l("Đã phát hành", "Published"),
    withdrawn: l("Đã thu hồi", "Withdrawn"),
    deleting: l("Đang xóa", "Deleting"),
    expired: l("Đã hết hạn", "Expired"),
  }[status] || status;
}

function IconButton({ label, children, className = "", ...props }) {
  return <button type="button" className={`pluginAdminIcon ${className}`} title={label} aria-label={label} {...props}>{children}</button>;
}

function ReleaseConfirmation({ confirmation, busy, language, onCancel, onConfirm }) {
  const dialog = useRef(null);
  const l = (vi, en) => text(language, vi, en);
  const publishing = confirmation.action === "publish";
  useEffect(() => { dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} className="pluginAdminConfirmation" aria-labelledby="plugin-confirm-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel(); }}>
      <form onSubmit={(event) => { event.preventDefault(); onConfirm(); }}>
        <header>
          <h3 id="plugin-confirm-title"><AlertTriangle size={20} /> {publishing ? l("Xác nhận phát hành", "Confirm publication") : confirmation.action === "withdraw" ? l("Xác nhận thu hồi", "Confirm withdrawal") : l("Xóa bản nháp?", "Delete draft?")}</h3>
          <IconButton label={l("Đóng", "Close")} onClick={onCancel} disabled={busy}><X size={18} /></IconButton>
        </header>
        <p><strong>{confirmation.release.channel} · v{confirmation.release.version}</strong></p>
        <p>{publishing
          ? l("Bản này sẽ thay thế bản tải công khai hiện tại của kênh. Các file đã phát hành được giữ nguyên.", "This release will replace the channel's current public download. Published files remain unchanged.")
          : confirmation.action === "withdraw"
            ? l("Bản tải này sẽ không còn công khai trên kênh. Các file đã phát hành được giữ nguyên.", "This download will no longer be public on the channel. Published files remain unchanged.")
            : confirmation.recreate
              ? l("Bản nháp đã hết hạn sẽ bị xóa. Bản nháp mới cần tải lại toàn bộ file.", "The expired draft will be deleted. The new draft requires a fresh upload of all files.")
              : l("Bản nháp và các phần file đã tải lên sẽ bị xóa.", "The draft and its uploaded file chunks will be deleted.")}</p>
        {confirmation.action !== "delete" && <p className="muted">{l("Phiên bản kênh", "Channel revision")}: {confirmation.expectedRevision}</p>}
        <footer>
          <button type="button" className="smallButton" onClick={onCancel} disabled={busy}><X size={16} /> {l("Hủy", "Cancel")}</button>
          <button type="submit" className={publishing ? "smallButton" : "smallButton dangerButton"} disabled={busy}>
            {busy ? <Loader2 className="spin" size={16} /> : publishing ? <Rocket size={16} /> : confirmation.action === "delete" ? <Trash2 size={16} /> : <X size={16} />}
            {publishing ? l("Phát hành", "Publish") : confirmation.action === "withdraw" ? l("Thu hồi", "Withdraw") : confirmation.recreate ? l("Xóa và tạo lại bản nháp", "Delete and recreate draft") : l("Xóa bản nháp", "Delete draft")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

export default function AdminPluginReleases({ language = "vi" }) {
  const l = (vi, en) => text(language, vi, en);
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [manifest, setManifest] = useState(null);
  const [newFiles, setNewFiles] = useState([]);
  const [localFiles, setLocalFiles] = useState({});
  const [progress, setProgress] = useState({});
  const [expiredUploads, setExpiredUploads] = useState({});
  const [confirmation, setConfirmation] = useState(null);
  const operation = useRef("");
  const uploadController = useRef(null);
  const manifestRead = useRef(0);
  const listRead = useRef(0);
  const selected = data.releases.find((release) => release._id === selectedId);
  const selectedUploadExpired = isUploadExpired(selected) || Boolean(expiredUploads[selectedId]);

  useEffect(() => {
    if (!selectedUploadExpired) return;
    setProgress((current) => {
      const entries = Object.entries(current).filter(([key]) => !key.startsWith(`${selectedId}:`));
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
    setMessage("");
  }, [selectedId, selectedUploadExpired]);

  const load = useCallback(async (foreground = false) => {
    const read = ++listRead.current;
    if (foreground) setLoading(true);
    try {
      const result = await api(RELEASES_PATH);
      if (read !== listRead.current) return;
      setData({ ...EMPTY_DATA, ...result, releases: result.releases || [], channels: result.channels || [] });
    } catch (err) {
      if (read === listRead.current) setError(err.message);
    } finally {
      if (read === listRead.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(true);
    const timer = window.setInterval(() => load(), 5000);
    return () => {
      window.clearInterval(timer);
      listRead.current += 1;
      manifestRead.current += 1;
      uploadController.current?.abort();
    };
  }, [load]);

  function begin(action) {
    if (operation.current) return false;
    operation.current = action;
    setBusy(action);
    setError("");
    setMessage("");
    return true;
  }

  function end() {
    operation.current = "";
    setBusy("");
  }

  function handleUploadError(err, id) {
    if (err.code === UPLOAD_EXPIRED || err.status === 410) {
      setExpiredUploads((current) => ({ ...current, [id]: true }));
      setMessage("");
      setError("");
    } else setError(err.message);
  }

  async function readManifest(event) {
    const file = event.target.files?.[0];
    const read = ++manifestRead.current;
    setManifest(null);
    setError("");
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error(l("Manifest vượt quá 1 MiB.", "Manifest exceeds 1 MiB."));
      const parsed = JSON.parse(await file.text());
      if (!parsed || Array.isArray(parsed) || ![2, 3].includes(parsed.manifestVersion) || !parsed.signature || !parsed.version || !parsed.channel) {
        throw new Error(l("Cần manifest V2 hoặc V3 đã ký.", "A signed V2 or V3 manifest is required."));
      }
      if (read === manifestRead.current) setManifest(parsed);
    } catch (err) {
      if (read === manifestRead.current) setError(err instanceof SyntaxError ? l("Manifest không phải JSON hợp lệ.", "Manifest is not valid JSON.") : err.message);
    }
  }

  async function createRelease(event) {
    event.preventDefault();
    if (!manifest || data.source !== "database" || !begin("create")) return;
    try {
      const zipCount = newFiles.filter((file) => /\.zip$/i.test(file.name)).length;
      const mzpCount = newFiles.filter((file) => /\.mzp$/i.test(file.name)).length;
      const expectedMzps = manifest.manifestVersion === 3 ? 2 : 1;
      if (zipCount !== 1 || mzpCount !== expectedMzps || newFiles.length !== 1 + expectedMzps || new Set(newFiles.map((file) => file.name)).size !== newFiles.length || newFiles.some((file) => !file.size)) {
        throw new Error(l("Chọn 1 Desktop ZIP và 2 MZP cho V3, hoặc 1 ZIP và 1 MZP cho V2. Tên file không được trùng.", "Select 1 Desktop ZIP and 2 MZPs for V3, or 1 ZIP and 1 MZP for V2. File names must be unique."));
      }
      const result = await api(RELEASES_PATH, { method: "POST", body: JSON.stringify({ manifest, files: newFiles.map((file) => ({ name: file.name, bytes: file.size })) }) });
      setData((current) => ({ ...current, releases: [result.release, ...current.releases.filter((release) => release._id !== result.release._id)] }));
      setLocalFiles((current) => ({ ...current, [result.release._id]: Object.fromEntries(newFiles.map((file) => [file.name, file])) }));
      setSelectedId(result.release._id);
      setCreateOpen(false);
      setManifest(null);
      setNewFiles([]);
      setMessage(l("Đã tạo bản nháp.", "Draft created."));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      end();
    }
  }

  function attachFiles(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    setError("");
    if (!selected || selected.status !== "draft" || selectedUploadExpired) return;
    const mismatch = files.find((file) => !selected.files.some((expected) => expected.name === file.name && expected.bytes === file.size));
    if (mismatch) {
      setError(`${mismatch.name}: ${l("Tên hoặc kích thước không khớp bản nháp.", "Name or size does not match the draft.")}`);
      return;
    }
    setLocalFiles((current) => ({ ...current, [selected._id]: { ...current[selected._id], ...Object.fromEntries(files.map((file) => [file.name, file])) } }));
  }

  async function uploadFiles() {
    if (!selected || selected.status !== "draft" || selectedUploadExpired || data.source !== "database" || !begin("upload")) return;
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      for (const expected of selected.files) {
        if (expected.complete) continue;
        const path = `${releasePath(selected._id)}/files/${encodeURIComponent(expected.name)}`;
        const state = await api(`${path}/upload`, { signal: controller.signal });
        const chunkBytes = state.chunkBytes;
        if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0 || chunkBytes > MAX_CHUNK_BYTES || state.totalChunks !== Math.ceil(expected.bytes / chunkBytes)) {
          throw new Error(l("Thông tin chia file từ máy chủ không hợp lệ.", "Invalid server chunk configuration."));
        }
        const received = new Set((state.receivedChunks || []).filter((index) => Number.isInteger(index) && index >= 0 && index < state.totalChunks));
        const acknowledgedBytes = () => [...received].reduce((total, index) => total + Math.min(chunkBytes, expected.bytes - index * chunkBytes), 0);
        const key = `${selected._id}:${expected.name}`;
        const updateProgress = () => setProgress((current) => ({ ...current, [key]: acknowledgedBytes() }));
        updateProgress();
        if (received.size === state.totalChunks) continue;
        const file = localFiles[selected._id]?.[expected.name];
        if (!file || file.size !== expected.bytes) throw new Error(`${expected.name}: ${l("Chọn lại file gốc để tiếp tục tải lên.", "Reselect the original file to resume uploading.")}`);
        for (let index = 0; index < state.totalChunks; index += 1) {
          if (received.has(index)) continue;
          controller.signal.throwIfAborted();
          await apiBinary(`${path}/chunks/${index}`, file.slice(index * chunkBytes, Math.min((index + 1) * chunkBytes, file.size)), {
            method: "PUT", headers: { "Content-Type": "application/octet-stream" }, signal: controller.signal,
          });
          received.add(index);
          updateProgress();
        }
      }
      setMessage(l("Đã tải lên tất cả file. Sẵn sàng xác minh.", "All files uploaded. Ready to verify."));
    } catch (err) {
      if (controller.signal.aborted) setMessage(l("Đã tạm dừng. Các phần đã nhận được giữ lại.", "Paused. Received chunks have been retained."));
      else handleUploadError(err, selected._id);
    } finally {
      uploadController.current = null;
      await load();
      end();
    }
  }

  async function verifyRelease() {
    if (!selected || !["draft", "verifying"].includes(selected.status) || selectedUploadExpired || data.source !== "database" || !begin("verify")) return;
    try {
      const result = await api(`${releasePath(selected._id)}/verify`, { method: "POST" });
      setData((current) => ({ ...current, releases: current.releases.map((release) => release._id === result.release._id ? result.release : release) }));
      setMessage(l("Đã gửi yêu cầu xác minh.", "Verification requested."));
    } catch (err) {
      handleUploadError(err, selected._id);
    } finally {
      await load();
      end();
    }
  }

  function requestConfirmation(action) {
    if (!selected || busy || data.source !== "database" || (action === "publish" && !data.enabled)) return;
    const channel = data.channels.find((item) => item._id === selected.channel);
    if (action !== "delete" && !Number.isSafeInteger(channel?.revision)) {
      setError(l("Chưa có phiên bản kênh. Hãy làm mới danh sách.", "Channel revision is unavailable. Refresh the list."));
      return;
    }
    setConfirmation({ action, release: selected, expectedRevision: channel?.revision, recreate: action === "delete" && selectedUploadExpired });
  }

  async function confirmAction() {
    if (!confirmation || data.source !== "database" || !begin(confirmation.action)) return;
    const { action, release, expectedRevision, recreate } = confirmation;
    try {
      await api(`${releasePath(release._id)}${action === "delete" ? "" : `/${action}`}`, {
        method: action === "delete" ? "DELETE" : "POST",
        ...(action === "delete" ? {} : { body: JSON.stringify({ expectedRevision }) }),
      });
      if (action === "delete") {
        setData((current) => ({ ...current, releases: current.releases.filter((item) => item._id !== release._id) }));
        setSelectedId("");
        if (recreate) {
          manifestRead.current += 1;
          setManifest(release.manifest);
          setNewFiles(Object.values(localFiles[release._id] || {}));
          setCreateOpen(true);
        }
        setLocalFiles((current) => { const next = { ...current }; delete next[release._id]; return next; });
        setExpiredUploads((current) => { const next = { ...current }; delete next[release._id]; return next; });
        setProgress((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${release._id}:`))));
      }
      invalidateApiCache("/api/plugin/downloads");
      setMessage(action === "publish" ? l("Đã phát hành.", "Release published.") : action === "withdraw" ? l("Đã thu hồi.", "Release withdrawn.") : l("Đã xóa bản nháp.", "Draft deleted."));
    } catch (err) {
      setError(err.status === 409 ? `${l("Bản phát hành hoặc kênh đã thay đổi. Kiểm tra danh sách rồi xác nhận lại.", "The release or channel has changed. Review the refreshed list and confirm again.")} ${err.message}` : err.message);
    } finally {
      setConfirmation(null);
      await load();
      end();
    }
  }

  const writable = data.source === "database" && !busy && !loading;
  const activeChannel = selected && data.channels.find((channel) => channel._id === selected.channel);
  const allComplete = selected?.files?.length > 0 && selected.files.every((file) => file.complete);
  const allUploaded = !selectedUploadExpired && selected?.files?.length > 0 && selected.files.every((file) => file.complete || progress[`${selected._id}:${file.name}`] === file.bytes);
  const date = (value) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString(language === "en" ? "en-US" : "vi-VN") : "-";

  return (
    <section className="adminPluginReleases" aria-labelledby="admin-plugin-releases-title">
      <header className="pluginAdminHeader">
        <div>
          <h2 id="admin-plugin-releases-title"><Package size={20} /> {l("Bản phát hành plugin", "Plugin releases")}</h2>
          <p className="muted">{l("Nguồn", "Source")}: {data.source || "-"} · {l("Kênh công khai", "Public channel")}: {data.publicChannel || "-"}</p>
        </div>
        <div className="pluginAdminActions">
          <IconButton label={l("Làm mới danh sách", "Refresh releases")} onClick={() => { setError(""); load(true); }} disabled={loading || Boolean(busy)}><RefreshCw className={loading ? "spin" : ""} size={18} /></IconButton>
          <IconButton label={l("Tạo bản nháp", "New draft")} onClick={() => { setCreateOpen(true); setSelectedId(""); setError(""); setMessage(""); }} disabled={!writable || createOpen}><Plus size={18} /></IconButton>
        </div>
      </header>
      {!loading && !data.enabled && <p className="pluginAdminNotice" role="status"><AlertTriangle size={17} /> {data.source === "database"
        ? l("Kênh cập nhật đang tắt. Có thể chuẩn bị và xác minh bản nháp, chưa thể phát hành.", "The update feed is disabled. Drafts can be prepared and verified, but not published.")
        : l("Nguồn phát hành đang dùng cấu hình env. Chuyển sang database để quản lý bản nháp tại đây.", "The release source uses environment configuration. Switch to database to manage drafts here.")}</p>}
      {error && <p className="pluginAdminError" role="alert"><AlertTriangle size={17} /> <span>{error}</span></p>}
      {message && !selectedUploadExpired && <p className="pluginAdminNotice" role="status"><Check size={17} /> {message}</p>}

      {createOpen && (
        <form className="pluginAdminDraft" onSubmit={createRelease}>
          <header><h3><FileJson size={18} /> {l("Bản nháp mới", "New draft")}</h3><IconButton label={l("Đóng bản nháp mới", "Close new draft")} disabled={Boolean(busy)} onClick={() => { manifestRead.current += 1; setCreateOpen(false); setManifest(null); setNewFiles([]); }}><X size={18} /></IconButton></header>
          <div className="pluginAdminInputs">
            <label>{l("Manifest đã ký (release.json / V2)", "Signed manifest (release.json / V2)")}<input type="file" accept=".json,application/json" onChange={readManifest} disabled={!writable} /></label>
            <label>{l("Desktop ZIP + các MZP", "Desktop ZIP + MZPs")}<input type="file" accept=".zip,.mzp" multiple onChange={(event) => setNewFiles(Array.from(event.target.files || []))} disabled={!writable} /></label>
          </div>
          {newFiles.length > 0 && <ul className="pluginAdminLocalFiles">{newFiles.map((file, index) => <li key={`${file.name}:${index}`}>{file.name} <span>{formatBytes(file.size)}</span></li>)}</ul>}
          {manifest && <details className="pluginAdminManifest" open><summary>{l("Manifest đã ký", "Signed manifest")} · {manifest.channel} · v{manifest.version} · V{manifest.manifestVersion}</summary><pre>{JSON.stringify(manifest, null, 2)}</pre></details>}
          <button type="submit" className="smallButton" disabled={!writable || !manifest || !newFiles.length}>{busy === "create" ? <Loader2 className="spin" size={16} /> : <Plus size={16} />} {l("Tạo bản nháp", "Create draft")}</button>
        </form>
      )}

      <div className="pluginAdminTableScroll" aria-busy={loading}>
        <table className="pluginAdminTable">
          <thead><tr><th>{l("Phiên bản", "Version")}</th><th>{l("Kênh", "Channel")}</th><th>{l("Trạng thái", "Status")}</th><th>{l("File", "Files")}</th><th>{l("Phát hành", "Published")}</th><th><span className="pluginAdminSrOnly">{l("Chi tiết", "Details")}</span></th></tr></thead>
          <tbody>
            {data.releases.map((release) => {
              const channel = data.channels.find((item) => item._id === release.channel);
              return (
                <tr key={release._id} className={release._id === selectedId ? "selected" : ""}>
                  <td><strong>v{release.version}</strong></td>
                  <td>{release.channel}<small>{l("Phiên bản kênh", "Revision")}: {channel?.revision ?? "-"}</small></td>
                  <td><span className={`pluginAdminStatus status-${release.status}`}>{releaseStatus(isUploadExpired(release) || expiredUploads[release._id] ? "expired" : release.status, l)}</span>{channel?.activeReleaseId === release._id && <small className="pluginAdminActive">{l("Đang công khai", "Live")}</small>}</td>
                  <td>{(release.files || []).filter((file) => file.complete).length}/{release.files?.length || 0}</td>
                  <td>{date(release.publishedAt)}</td>
                  <td><IconButton label={`${l("Chi tiết", "Details")} v${release.version} · ${release.channel}`} aria-pressed={selectedId === release._id} disabled={Boolean(busy)} onClick={() => { setSelectedId(release._id); setCreateOpen(false); manifestRead.current += 1; setManifest(null); setNewFiles([]); setError(""); setMessage(""); }}><Eye size={18} /></IconButton></td>
                </tr>
              );
            })}
            {!data.releases.length && <tr><td colSpan={6} className="pluginAdminEmpty">{loading ? l("Đang tải…", "Loading…") : l("Chưa có bản phát hành.", "No releases yet.")}</td></tr>}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="pluginAdminDetail">
          <header>
            <h3>{selected.channel} · v{selected.version} <span className={`pluginAdminStatus status-${selected.status}`}>{releaseStatus(selectedUploadExpired ? "expired" : selected.status, l)}</span></h3>
            <div className="pluginAdminActions">
              {selected.status === "draft" && !selectedUploadExpired && <>
                {busy === "upload" ? <IconButton label={l("Tạm dừng tải lên", "Pause upload")} onClick={() => uploadController.current?.abort()}><Pause size={18} /></IconButton> : <IconButton label={l("Tải lên / tiếp tục / thử lại", "Upload / resume / retry")} disabled={!writable || allComplete} onClick={uploadFiles}><Upload size={18} /></IconButton>}
                <IconButton label={l("Xác minh bản phát hành", "Verify release")} disabled={!writable || !allUploaded} onClick={verifyRelease}><ShieldCheck size={18} /></IconButton>
                <IconButton label={l("Xóa bản nháp", "Delete draft")} className="dangerButton" disabled={!writable} onClick={() => requestConfirmation("delete")}><Trash2 size={18} /></IconButton>
              </>}
              {selected.status === "verifying" && <IconButton label={l("Thử lại xác minh bị gián đoạn", "Retry interrupted verification")} disabled={!writable || selectedUploadExpired} onClick={verifyRelease}><ShieldCheck size={18} /></IconButton>}
              {selected.status === "deleting" && <IconButton label={l("Thử lại xóa bản nháp", "Retry draft deletion")} className="dangerButton" disabled={!writable} onClick={() => requestConfirmation("delete")}><Trash2 size={18} /></IconButton>}
              {["verified", "withdrawn", "published"].includes(selected.status) && activeChannel?.activeReleaseId !== selected._id && <IconButton label={l("Phát hành", "Publish release")} disabled={!writable || !data.enabled} onClick={() => requestConfirmation("publish")}><Rocket size={18} /></IconButton>}
              {selected.status === "published" && activeChannel?.activeReleaseId === selected._id && <IconButton label={l("Thu hồi bản phát hành", "Withdraw release")} className="dangerButton" disabled={!writable} onClick={() => requestConfirmation("withdraw")}><X size={18} /></IconButton>}
            </div>
          </header>
          {busy && <p className="pluginAdminNotice" role="status"><Loader2 className="spin" size={16} /> {busy === "upload" ? l("Đang tải lên…", "Uploading…") : l("Đang xử lý…", "Processing…")}</p>}
          {selectedUploadExpired && <>
            <p className="pluginAdminError" role="alert"><AlertTriangle size={17} /> <span>{l("Phiên tải lên đã hết hạn. Cần xóa và tạo lại bản nháp.", "Upload expired. Delete and recreate the draft to upload again.")}</span></p>
            <button type="button" className="smallButton dangerButton" disabled={!writable || !["draft", "deleting"].includes(selected.status)} onClick={() => requestConfirmation("delete")}><Trash2 size={16} /> {l("Xóa và tạo lại bản nháp", "Delete and recreate draft")}</button>
          </>}
          {selected.error && !selectedUploadExpired && <pre className="pluginAdminErrorDetail" role="alert">{errorDetails(selected.error)}</pre>}
          <dl className="pluginAdminMetadata"><div><dt>{l("Xác minh", "Verified")}</dt><dd>{date(selected.verifiedAt)}</dd></div><div><dt>{l("Phát hành", "Published")}</dt><dd>{date(selected.publishedAt)}</dd></div><div><dt>{l("Phiên bản kênh", "Channel revision")}</dt><dd>{activeChannel?.revision ?? "-"}</dd></div></dl>
          {selected.status === "draft" && !selectedUploadExpired && <label className="pluginAdminAttach">{l("File gốc để tải lên / tiếp tục", "Original files for upload / resume")}<input key={selected._id} type="file" multiple accept=".zip,.mzp" onChange={attachFiles} disabled={!writable} /></label>}
          <ul className="pluginAdminFileList">
            {(selected.files || []).map((file) => {
              const bytes = selectedUploadExpired ? 0 : file.complete ? file.bytes : Math.min(file.bytes, progress[`${selected._id}:${file.name}`] || 0);
              const percent = file.bytes > 0 ? Math.round(bytes / file.bytes * 100) : 0;
              return (
                <li key={file.name}>
                  <div className="pluginAdminFileHeading"><strong>{file.name}</strong><span>{file.complete ? <Check size={16} /> : null} {formatBytes(bytes)} / {formatBytes(file.bytes)} · {percent}%</span></div>
                  <small>{file.role}{file.maxFamily ? ` · 3ds Max ${file.maxFamily}` : ""} · {selectedUploadExpired ? l("Đã hết hạn", "Expired") : file.complete ? l("Đã nhận", "Received") : localFiles[selected._id]?.[file.name] ? l("Đã chọn file gốc", "Original file selected") : l("Chưa chọn file gốc", "Original file not selected")}</small>
                  <progress max={file.bytes || 1} value={bytes} aria-label={`${file.name}: ${percent}%`} />
                  {file.sha256 && <code>SHA-256: {file.sha256}</code>}
                </li>
              );
            })}
          </ul>
          <details className="pluginAdminManifest"><summary><FileJson size={16} /> {l("Manifest đã ký (chỉ đọc)", "Signed manifest (read-only)")}</summary><pre>{JSON.stringify(selected.manifest, null, 2)}</pre></details>
        </div>
      )}
      {confirmation && <ReleaseConfirmation confirmation={confirmation} busy={Boolean(busy)} language={language} onCancel={() => setConfirmation(null)} onConfirm={confirmAction} />}
    </section>
  );
}
