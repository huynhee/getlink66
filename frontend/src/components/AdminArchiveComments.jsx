import React, { useEffect, useState } from "react";
import { ChevronDown, Loader2, Save, Search, ShieldCheck } from "lucide-react";
import { api } from "../api.js";
import "./admin-archive-comments.css";

export default function AdminArchiveComments({ language }) {
  const vi = language === "vi";
  const [settings, setSettings] = useState(null);
  const [token, setToken] = useState("");
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    api("/api/admin/archive-comments").then((data) => { if (active) setSettings(data); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  async function save(event) {
    event.preventDefault();
    setSaving(true); setSaved(false); setError("");
    try {
      setSettings(await api("/api/admin/archive-comments", { method: "PUT", body: JSON.stringify({ enabled: settings.enabled, text: settings.text }) }));
      setSaved(true);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function lookup(event) {
    event.preventDefault();
    setLooking(true); setResult(null); setLookupError("");
    try { setResult(await api("/api/admin/archive-comments/lookup", { method: "POST", body: JSON.stringify({ token }) })); }
    catch (err) { setLookupError(err.message); }
    finally { setLooking(false); }
  }

  return <details className="adminArchiveComments">
    <summary><ShieldCheck size={18} /><strong>{vi ? "Comment và mã truy vết file tải" : "Archive comments and download tracing"}</strong><ChevronDown size={18} /></summary>
    <div className="adminArchiveCommentsBody">
      {error && <p className="error" role="alert">{error}</p>}
      {!settings && !error && <p role="status">{vi ? "Đang tải..." : "Loading..."}</p>}
      {settings && <form className="stack" onSubmit={save}>
        <label className="checkboxInline"><input type="checkbox" checked={settings.enabled} disabled={saving || (!settings.keyConfigured && !settings.enabled)}
          onChange={(event) => { setSettings({ ...settings, enabled: event.target.checked }); setSaved(false); }} />
          {vi ? "Gắn comment cho các lượt tải web mới" : "Add comments to new web download sessions"}</label>
        {!settings.keyConfigured && <p className="error">{vi ? "Chưa cấu hình ARCHIVE_TRACE_SECRET trên backend." : "ARCHIVE_TRACE_SECRET is not configured on the backend."}</p>}
        <label className="stack"><span>{vi ? "Nội dung comment" : "Comment text"}</span>
          <textarea aria-label={vi ? "Nội dung comment" : "Comment text"} rows={4} maxLength={4096} value={settings.text} disabled={saving}
            onChange={(event) => { setSettings({ ...settings, text: event.target.value }); setSaved(false); }} /></label>
        <small>{new TextEncoder().encode(settings.text).length}/4096 bytes</small>
        <p className="muted">{vi ? "ZIP và RAR5 một file, không SFX/header mã hóa/recovery. Mã truy vết được tự thêm; giữ nguyên file Drive. Plugin hiện tại nhận file gốc để giữ đúng SHA-256. Định dạng chưa hỗ trợ sẽ bị chặn trước khi trừ lượt/Credit." : "ZIP and single-volume RAR5 without SFX, encrypted headers or recovery records. A trace is appended automatically; Drive files stay unchanged. Current plugins receive original bytes for SHA-256 verification. Unsupported formats are rejected before quota or Credit is charged."}</p>
        <div><button className="smallButton" type="submit" disabled={saving || new TextEncoder().encode(settings.text).length > 4096}>
          {saving ? <Loader2 size={15} /> : <Save size={15} />}{vi ? "Lưu comment" : "Save comment"}</button></div>
        {saved && <p className="success" role="status">{vi ? "Đã lưu. Phiên tải đang có giữ nguyên comment cũ." : "Saved. Existing sessions keep their original comment."}</p>}
      </form>}
      <form className="stack adminArchiveTraceLookup" onSubmit={lookup}>
        <h3>{vi ? "Tra mã file" : "Look up an archive reference"}</h3>
        <label className="stack"><span>{vi ? "Mã Ref hoặc toàn bộ comment" : "Reference code or complete comment"}</span>
          <textarea aria-label={vi ? "Mã Ref hoặc toàn bộ comment" : "Reference code or complete comment"} value={token} onChange={(event) => { setToken(event.target.value); setResult(null); setLookupError(""); }}
            maxLength={8192} rows={3} spellCheck={false} autoComplete="off" required /></label>
        <div><button type="submit" className="smallButton" disabled={looking || !token.trim()}>
          {looking ? <Loader2 size={15} /> : <Search size={15} />}{vi ? "Tra cứu" : "Look up"}</button></div>
        {lookupError && <p className="error" role="alert">{lookupError}</p>}
        {result && <div className="adminArchiveTraceResult" role="status">
          <dl>
            <dt>{vi ? "Tài khoản" : "Account"}</dt><dd>{result.user?.email || result.trace.userId} · {result.user?.name || ""}</dd>
            <dt>{vi ? "Tài nguyên" : "Asset"}</dt><dd>{result.asset?.title || result.trace.modelId} ({result.trace.assetType})</dd>
            <dt>{vi ? "Phiên tải" : "Download session"}</dt><dd>{result.trace.sessionId}</dd>
            <dt>{vi ? "Tạo mã" : "Issued"}</dt><dd>{new Date(result.trace.issuedAt).toLocaleString(vi ? "vi-VN" : "en-US")}</dd>
            <dt>{vi ? "Lịch sử" : "History"}</dt><dd>{result.download?.status || (vi ? "Đã hết thời gian lưu hoặc chưa ghi nhận" : "No retained download record")}</dd>
          </dl>
          <p className="muted">{vi ? "Mã hợp lệ xác định nguồn phiên tải, không chứng minh ai đã phát tán. Comment có thể bị xóa hoặc sao chép; không tự động khóa tài khoản." : "A valid reference identifies the source session, not who redistributed it. Comments can be removed or copied; no account is banned automatically."}</p>
        </div>}
      </form>
    </div>
  </details>;
}
