import React, { useEffect, useState } from "react";
import { ChevronDown, Loader2, Save, Search, ShieldCheck } from "lucide-react";
import { api } from "../api.js";
import "./admin-archive-comments.css";

const TEXT_FILE_DEFAULTS = { textFileEnabled: false, textFileName: "3dipl.txt", textFileText: "3dipl.org" };

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
    api("/api/admin/archive-comments").then((data) => { if (active) setSettings({ ...TEXT_FILE_DEFAULTS, ...data }); })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  async function save(event) {
    event.preventDefault();
    setSaving(true); setSaved(false); setError("");
    try {
      const data = await api("/api/admin/archive-comments", { method: "PUT", body: JSON.stringify({
        enabled: settings.enabled, text: settings.text, textFileEnabled: settings.textFileEnabled,
        textFileName: settings.textFileName, textFileText: settings.textFileText,
      }) });
      setSettings({ ...TEXT_FILE_DEFAULTS, ...data });
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

  const commentBytes = new TextEncoder().encode(settings?.text ?? "").length;
  const textFileBytes = new TextEncoder().encode(settings?.textFileText ?? "").length;
  const fileBase = settings?.textFileName.replace(/\.txt$/i, "") || "3dipl";

  return <details className="adminArchiveComments">
    <summary><ShieldCheck size={18} /><strong>{vi ? "Comment, TXT + URL và mã truy vết file tải" : "Archive comments, TXT + URL and download tracing"}</strong><ChevronDown size={18} /></summary>
    <div className="adminArchiveCommentsBody">
      {error && <p className="error" role="alert">{error}</p>}
      {!settings && !error && <p role="status">{vi ? "Đang tải..." : "Loading..."}</p>}
      {settings && <form className="stack" onSubmit={save}>
        <p className="muted">{vi ? "Admin / Chung / Lịch sử tải" : "Admin / General / Download history"}</p>
        <label className="checkboxInline"><input type="checkbox" name="archiveCommentEnabled" checked={settings.enabled} disabled={saving || (!settings.keyConfigured && !settings.enabled)}
          onChange={(event) => { setSettings({ ...settings, enabled: event.target.checked }); setSaved(false); }} />
          {vi ? "Gắn comment cho các lượt tải web mới" : "Add comments to new web download sessions"}</label>
        {!settings.keyConfigured && <p className="error">{vi ? "Chưa cấu hình ARCHIVE_TRACE_SECRET trên backend." : "ARCHIVE_TRACE_SECRET is not configured on the backend."}</p>}
        <label className="stack"><span>{vi ? "Nội dung comment" : "Comment text"}</span>
          <textarea aria-label={vi ? "Nội dung comment" : "Comment text"} rows={4} maxLength={4096} value={settings.text} disabled={saving}
            onChange={(event) => { setSettings({ ...settings, text: event.target.value }); setSaved(false); }} /></label>
        <small className={commentBytes > 4096 ? "error" : "muted"}>{commentBytes}/4096 {vi ? "byte UTF-8" : "UTF-8 bytes"}</small>
        <div className="stack adminArchiveExtraSettings">
          <label className="checkboxInline"><input type="checkbox" name="archiveTextFileEnabled" checked={settings.textFileEnabled} disabled={saving}
            onChange={(event) => { setSettings({ ...settings, textFileEnabled: event.target.checked }); setSaved(false); }} />
            {vi ? "Thêm cả file TXT và URL vào archive" : "Add both TXT and URL files to the archive"}</label>
          <p className="muted">{vi ? "Chỉ thêm vào thư mục gốc archive của phiên tải WEB Model/Scene mới khi bật gắn comment ở trên. TXT chứa nội dung bên dưới và cùng mã truy vết mã hóa với comment. URL luôn mở https://3dipl.org/." : "Added at the archive root only for new Model/Scene WEB sessions with comments enabled above. TXT contains the text below and the same encrypted trace as the comment. URL always opens https://3dipl.org/."}</p>
          {!settings.enabled && settings.textFileEnabled && <p className="muted">{vi ? "Gắn comment đang tắt: cài đặt TXT + URL được lưu nhưng chưa thêm file." : "Comments are off: TXT + URL settings are saved, but no files will be added."}</p>}
          <label className="stack"><span>{vi ? "Tên file TXT" : "TXT filename"}</span>
            <input type="text" name="archiveTextFileName" aria-label={vi ? "Tên file TXT" : "TXT filename"} value={settings.textFileName} disabled={saving}
              placeholder="3dipl.txt" maxLength={64} required spellCheck={false} autoComplete="off"
              onChange={(event) => { setSettings({ ...settings, textFileName: event.target.value }); setSaved(false); }} /></label>
          <small className="muted">{vi ? "Mặc định: 3dipl.txt. Tên file .txt an toàn, tối đa 64 ký tự ASCII, không đường dẫn. File .url dùng cùng tên gốc. Khi tải, cả hai được thêm hậu tố ngẫu nhiên riêng cho phiên để không ghi đè file nguồn." : "Default: 3dipl.txt. A safe .txt basename, up to 64 ASCII characters, without a path. The .url uses the same base name. Both receive a per-session random suffix on download to avoid overwriting source files."}</small>
          <label className="stack"><span>{vi ? "Nội dung TXT" : "TXT content"}</span>
            <textarea name="archiveTextFileText" aria-label={vi ? "Nội dung TXT" : "TXT content"} rows={3} maxLength={4096} value={settings.textFileText} disabled={saving}
              placeholder="3dipl.org" onChange={(event) => { setSettings({ ...settings, textFileText: event.target.value }); setSaved(false); }} /></label>
          <small className={textFileBytes > 4096 ? "error" : "muted"}>{textFileBytes}/4096 {vi ? "byte UTF-8. Văn bản thuần; mặc định: 3dipl.org. Mã truy vết được tự thêm." : "UTF-8 bytes. Plain text; default: 3dipl.org. The trace is appended automatically."}</small>
          {settings.textFileEnabled && <div className="adminArchiveExtraPreview">
            <strong>{vi ? "Ví dụ file trong archive" : "Example archive files"}</strong>
            <code>{fileBase}-[random].txt</code>
            <pre data-preview="txt">{`${settings.textFileText.replace(/\r\n?/g, "\n").trim()}\n\nipl1.[${vi ? "mã truy vết mã hóa" : "encrypted session trace"}]`.trimStart()}</pre>
            <code>{fileBase}-[random].url</code>
            <pre data-preview="url">{"[InternetShortcut]\nURL=https://3dipl.org/"}</pre>
          </div>}
        </div>
        <p className="muted">{vi ? "ZIP và RAR4/RAR5 một file, không SFX/header mã hóa/recovery. Mã truy vết được tự thêm; giữ nguyên file Drive. Plugin hiện tại nhận file gốc để giữ đúng SHA-256. Định dạng chưa hỗ trợ sẽ bị chặn trước khi trừ lượt/Credit." : "ZIP and single-volume RAR4/RAR5 without SFX, encrypted headers or recovery records. A trace is appended automatically; Drive files stay unchanged. Current plugins receive original bytes for SHA-256 verification. Unsupported formats are rejected before quota or Credit is charged."}</p>
        <div><button className="smallButton" type="submit" disabled={saving || commentBytes > 4096 || textFileBytes > 4096}>
          {saving ? <Loader2 size={15} /> : <Save size={15} />}{vi ? "Lưu cài đặt" : "Save settings"}</button></div>
        {saved && <p className="success" role="status">{vi ? "Đã lưu. Phiên tải đang có giữ nguyên comment và cài đặt file cũ." : "Saved. Existing sessions keep their original comment and file settings."}</p>}
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
