import React, { useEffect, useRef, useState } from "react";
import { Loader2, ArrowDownToLine, Copy, Check, ClipboardPaste, Search, ImageDown } from "lucide-react";
import { api } from "../api.js";
import { translations } from "../i18n.js";
import {
  completeFaviconProgress,
  failFaviconProgress,
  resetFaviconProgress,
  setFaviconProgress,
} from "../utils/faviconProgress.js";

export default function GetlinkBox({ onCreditChange, initialUrl = "", language = "vi", disabledReason = "" }) {
  const t = translations[language] || translations.vi;
  const [url, setUrl] = useState(initialUrl);
  const [result, setResult] = useState("");
  const [previewImageDownloadUrl, setPreviewImageDownloadUrl] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [includePreviewImage, setIncludePreviewImage] = useState(false);
  const [selectedFormatKey, setSelectedFormatKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [systemStatus, setSystemStatus] = useState({ online: true, message: "" });
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const progressTimerRef = useRef(null);
  const resetTimerRef = useRef(null);
  const cursorText = url || t.getlinkPlaceholder;
  const cursorX = Math.min(cursorText.length * 8.4, 520);
  const formatOptions = Array.isArray(preview?.formatOptions) ? preview.formatOptions : [];
  const selectedFormat =
    formatOptions.find((option) => option.key === selectedFormatKey) ||
    formatOptions.find((option) => option.isDefault) ||
    formatOptions[0] ||
    preview?.selectedFormat ||
    null;

  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  useEffect(() => {
    api("/api/system/3d66-status")
      .then((data) => setSystemStatus({ online: Boolean(data.online), message: data.message || "" }))
      .catch(() => setSystemStatus({ online: false, message: t.systemOfflineMessage }));
  }, [t.systemOfflineMessage]);

  useEffect(() => () => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetFaviconProgress();
  }, []);

  function stopProgressTimer() {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  function clearProgressLater(delay = 1600) {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => {
      setProgress(0);
      setProgressLabel("");
      resetFaviconProgress();
    }, delay);
  }

  function beginProgress(label, start = 8, target = 85) {
    stopProgressTimer();
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    let current = start;
    setProgress(current);
    setProgressLabel(label);
    setFaviconProgress(current);

    progressTimerRef.current = setInterval(() => {
      current = Math.min(target, current + Math.max(1, Math.round((target - current) * 0.18)));
      setProgress(current);
      setFaviconProgress(current);
    }, 550);
  }

  function finishProgress(label) {
    stopProgressTimer();
    setProgress(100);
    setProgressLabel(label);
    completeFaviconProgress();
    clearProgressLater();
  }

  function errorProgress(label) {
    stopProgressTimer();
    setProgress(0);
    setProgressLabel(label);
    failFaviconProgress();
    clearProgressLater(2200);
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

  async function submit(event) {
    event.preventDefault();
    setError("");
    setResult("");
    setPreviewImageDownloadUrl("");
    setPreview(null);
    setPreviewUrl("");
    setSelectedFormatKey("");
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    if (!systemStatus.online) {
      setError(t.systemOfflineMessage);
      return;
    }
    setLoading(true);
    setCopied(false);
    beginProgress(language === "vi" ? "Đang kiểm tra model..." : "Checking model...", 8, 78);
    try {
      const data = await api("/api/getlink/preview", {
        method: "POST",
        body: JSON.stringify({ url })
      });
      setPreview(data);
      const nextFormats = Array.isArray(data.formatOptions) ? data.formatOptions : [];
      const defaultFormat = nextFormats.find((option) => option.isDefault) || nextFormats[0] || data.selectedFormat;
      setSelectedFormatKey(defaultFormat?.key || "");
      setPreviewUrl(url);
      finishProgress(language === "vi" ? "Đã lấy thông tin model" : "Model info loaded");
    } catch (err) {
      setError(err.message);
      errorProgress(language === "vi" ? "Kiểm tra thất bại" : "Check failed");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDownload() {
    setError("");
    setResult("");
    setPreviewImageDownloadUrl("");
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    setConfirming(true);
    setCopied(false);
    beginProgress(language === "vi" ? "Đang lấy link tải..." : "Getting download link...", 12, 92);
    try {
      const data = await api("/api/getlink", {
        method: "POST",
        body: JSON.stringify({
          url: previewUrl || url,
          includePreviewImage,
          downloadFormat: selectedFormat
            ? {
                key: selectedFormat.key,
                fileFormat: selectedFormat.fileFormat,
                formatVersion: selectedFormat.formatVersion,
                rendererType: selectedFormat.rendererType,
                rendererLabel: selectedFormat.rendererLabel,
                label: selectedFormat.label,
                size: selectedFormat.size
              }
            : undefined
        })
      });
      setResult(data.downloadUrl || data.url);
      setPreviewImageDownloadUrl(data.previewImageDownloadUrl || "");
      setPreview({
        ...(preview || {}),
        title: data.title || preview?.title,
        imageUrl: data.imageUrl || preview?.imageUrl,
        productId: data.productId || preview?.productId,
        creditCost: data.creditUsed || preview?.creditCost,
        selectedFormat: data.selectedFormat || selectedFormat,
        formatOptions: preview?.formatOptions || []
      });
      onCreditChange(data.credit);
      if (includePreviewImage && data.previewImageDownloadUrl) {
        window.setTimeout(() => triggerBrowserDownload(data.previewImageDownloadUrl), 250);
      }
      finishProgress(language === "vi" ? "Đã sẵn sàng tải file" : "Download is ready");
    } catch (err) {
      setError(err.message);
      errorProgress(language === "vi" ? "Lấy link thất bại" : "Getlink failed");
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
      setSelectedFormatKey("");
      setResult("");
      setPreviewImageDownloadUrl("");
      setProgress(0);
      setProgressLabel("");
      resetFaviconProgress();
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
                setSelectedFormatKey("");
                setResult("");
                setPreviewImageDownloadUrl("");
                setProgress(0);
                setProgressLabel("");
                resetFaviconProgress();
              }}
              placeholder={t.getlinkPlaceholder}
            />
            <button type="button" className="pasteInlineButton" onClick={pasteLink} title={t.pasteTitle}>
              <ClipboardPaste size={14} />
              {t.paste}
            </button>
          </div>
          <button type="submit" disabled={loading || !url || Boolean(disabledReason)}>
            {loading ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
            {loading ? t.processing : t.checkLink}
          </button>
        </div>
        <label className="previewImageOption">
          <input
            type="checkbox"
            checked={includePreviewImage}
            onChange={(event) => setIncludePreviewImage(event.target.checked)}
          />
          <span>
            <strong>{t.downloadPreviewImageOption}</strong>
          </span>
        </label>
      </form>
      {(loading || confirming || progress > 0) && (
        <div className="getlinkProgress" aria-live="polite">
          <div>
            <span>{progressLabel || t.processing}</span>
            <strong>{Math.round(progress)}%</strong>
          </div>
          <div className="getlinkProgressTrack">
            <i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
        </div>
      )}
      {disabledReason && <p className="error">{disabledReason}</p>}
      {error && !disabledReason && <p className="error">{error}</p>}
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
          {formatOptions.length > 0 && (
            <div className="formatSelector" aria-label={t.fileFormat}>
              <span>{t.fileFormat}</span>
              <div className="formatOptionGrid">
                {formatOptions.map((option) => {
                  const active = option.key === selectedFormat?.key;
                  const versionText = [
                    option.formatVersion ? `${t.formatVersion}: ${option.formatVersion}` : "",
                    option.rendererLabel ? `${t.rendererType}: ${option.rendererLabel}` : ""
                  ].filter(Boolean).join(" / ");
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`formatOption ${active ? "active" : ""}`}
                      onClick={() => setSelectedFormatKey(option.key)}
                    >
                      <strong>{option.label || option.fileFormat || t.fileFormat}</strong>
                      {versionText && <small>{versionText}</small>}
                      {option.size && <em>{option.size}</em>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!result && (
            <button type="button" onClick={confirmDownload} disabled={confirming || Boolean(disabledReason)} style={{ marginTop: 14 }}>
              {confirming ? <Loader2 size={18} className="spin" /> : <ArrowDownToLine size={18} />}
              {confirming ? t.processing : `${t.confirmDownload}${selectedFormat?.label ? ` ${selectedFormat.label}` : ""} - ${preview.creditCost || 1} credit`}
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
          {(includePreviewImage || previewImageDownloadUrl) && (
            <div className="previewImageDownloadRow">
              {previewImageDownloadUrl ? (
                <a href={previewImageDownloadUrl} target="_blank" rel="noreferrer">
                  <ImageDown size={16} />
                  {t.previewImageDownload}
                </a>
              ) : (
                <p className="muted">{t.previewImageUnavailable}</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
