import React, { useEffect, useState } from "react";
import { Loader2, ArrowDownToLine, Copy, Check, ClipboardPaste, Search } from "lucide-react";
import { api } from "../api.js";
import { translations } from "../i18n.js";

export default function GetlinkBox({ onCreditChange, initialUrl = "", language = "vi" }) {
  const t = translations[language] || translations.vi;
  const [url, setUrl] = useState(initialUrl);
  const [result, setResult] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [systemStatus, setSystemStatus] = useState({ online: true, message: "" });
  const cursorText = url || t.getlinkPlaceholder;
  const cursorX = Math.min(cursorText.length * 8.4, 520);

  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  useEffect(() => {
    api("/api/system/3d66-status")
      .then((data) => setSystemStatus({ online: Boolean(data.online), message: data.message || "" }))
      .catch(() => setSystemStatus({ online: false, message: t.systemOfflineMessage }));
  }, [t.systemOfflineMessage]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setResult("");
    setPreview(null);
    setPreviewUrl("");
    if (!systemStatus.online) {
      setError(t.systemOfflineMessage);
      return;
    }
    setLoading(true);
    setCopied(false);
    try {
      const data = await api("/api/getlink/preview", {
        method: "POST",
        body: JSON.stringify({ url })
      });
      setPreview(data);
      setPreviewUrl(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmDownload() {
    setError("");
    setResult("");
    setConfirming(true);
    setCopied(false);
    try {
      const data = await api("/api/getlink", {
        method: "POST",
        body: JSON.stringify({ url: previewUrl || url })
      });
      setResult(data.downloadUrl || data.url);
      setPreview({
        ...(preview || {}),
        title: data.title || preview?.title,
        imageUrl: data.imageUrl || preview?.imageUrl,
        productId: data.productId || preview?.productId,
        creditCost: data.creditUsed || preview?.creditCost
      });
      onCreditChange(data.credit);
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirming(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* fallback: do nothing */
    }
  }

  async function pasteLink() {
    setError("");
    try {
      if (!navigator.clipboard?.readText) {
        setError(t.clipboardUnsupported);
        return;
      }

      const pasted = (await navigator.clipboard.readText()).trim();
      if (!pasted) {
        setError(t.clipboardEmpty);
        return;
      }
      if (!pasted.includes("3d66.com")) {
        setError(t.clipboardInvalid3d66);
        return;
      }

      setUrl(pasted);
      setPreview(null);
      setResult("");
    } catch {
      setError(t.clipboardDenied);
    }
  }

  return (
    <section className="panel">
      <form className="getlinkForm" onSubmit={submit}>
        <h2>{t.getlinkTitle}</h2>
        <div className="inputRow">
          <div className="linkInputWrap terminalInput" style={{ "--cursor-x": `${cursorX}px` }}>
            <span className="terminalInputMirror" aria-hidden="true">{url || t.getlinkPlaceholder}</span>
            <input
              id="modelUrl"
              value={url}
              aria-label={t.getlinkInputAria}
              onChange={(event) => {
                setUrl(event.target.value);
                setPreview(null);
                setResult("");
              }}
              placeholder={t.getlinkPlaceholder}
            />
            <button type="button" className="pasteInlineButton" onClick={pasteLink} title={t.pasteTitle}>
              <ClipboardPaste size={14} />
              {t.paste}
            </button>
          </div>
          <button type="submit" disabled={loading || !url}>
            {loading ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
            {loading ? t.processing : t.checkLink}
          </button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {preview && (
        <div className="result">
          <span>{t.modelInfo}</span>
          <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", gap: 14, alignItems: "center" }}>
            <div style={{ width: 96, height: 96, borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
              {preview.imageUrl ? (
                <img src={preview.imageUrl} alt={preview.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.55 }}>
                  3D66
                </div>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: "block", overflowWrap: "anywhere" }}>{preview.title || preview.productId}</strong>
              <p className="muted" style={{ margin: "6px 0" }}>{t.productCode}: {preview.productId}</p>
              <p className="muted" style={{ margin: 0 }}>{t.price}: {preview.creditCost || 1} credit</p>
            </div>
          </div>
          {!result && (
            <button type="button" onClick={confirmDownload} disabled={confirming} style={{ marginTop: 14 }}>
              {confirming ? <Loader2 size={18} className="spin" /> : <ArrowDownToLine size={18} />}
              {confirming ? t.processing : `${t.confirmDownload} - ${preview.creditCost || 1} credit`}
            </button>
          )}
        </div>
      )}
      {result && (
        <div className="result">
          <span>{t.serverDownloadLink}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <a href={result} target="_blank" rel="noreferrer" style={{ flex: 1, minWidth: 0 }}>
              {t.downloadFile}
            </a>
            <button
              type="button"
              className="smallButton"
              onClick={copyLink}
              style={{ flexShrink: 0 }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? t.copied : t.copy}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
