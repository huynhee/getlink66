import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, ArrowDownToLine, Copy, Check, ClipboardPaste, Search, ImageDown, X } from "lucide-react";
import CoinAmount from "./CoinAmount.jsx";
import { api } from "../api.js";
import { translations } from "../i18n.js";
import {
  completeFaviconProgress,
  failFaviconProgress,
  resetFaviconProgress,
  setFaviconProgress,
} from "../utils/faviconProgress.js";

function isUsableFormatOption(option = {}) {
  const fileFormat = String(option.fileFormat || option.file_format || String(option.key || "").split("|")[0] || "").trim();
  return Boolean(fileFormat && fileFormat !== "0");
}

function formatDisplayName(option = {}, fallback = "Định dạng file") {
  const fileFormat = String(option.fileFormat || option.file_format || String(option.key || "").split("|")[0] || "").trim();
  const mapped = {
    1: "3Dmax（.max）",
    3: "OBJ（.obj）",
    14: "FBX（.fbx）"
  }[fileFormat];
  return option.label || option.name || mapped || fileFormat || fallback;
}

export default function GetlinkBox({ onCreditChange, initialUrl = "", language = "vi", disabledReason = "" }) {
  const t = translations[language] || translations.vi;
  const [url, setUrl] = useState(initialUrl);
  const [result, setResult] = useState("");
  const [previewImageDownloadUrl, setPreviewImageDownloadUrl] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [includePreviewImage, setIncludePreviewImage] = useState(false);
  const [selectedFormatKey, setSelectedFormatKey] = useState("");
  const [pendingFormatSelection, setPendingFormatSelection] = useState(null);
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
  const pendingFormatOptions = Array.isArray(pendingFormatSelection?.formatOptions)
    ? pendingFormatSelection.formatOptions.filter(isUsableFormatOption)
    : [];
  const formatOptions = [];
  const canChooseFormat = false;
  const selectedFormat =
    pendingFormatOptions.find((option) => option.key === selectedFormatKey) ||
    pendingFormatOptions.find((option) => option.isDefault) ||
    pendingFormatOptions[0] ||
    pendingFormatSelection?.selectedFormat ||
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
    setPendingFormatSelection(null);
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
      setPreviewUrl(url);
      finishProgress(language === "vi" ? "Đã lấy thông tin model" : "Model info loaded");
    } catch (err) {
      setError(err.message);
      errorProgress(language === "vi" ? "Kiểm tra thất bại" : "Check failed");
    } finally {
      setLoading(false);
    }
  }

  function downloadFormatPayload(format) {
    if (!format) return undefined;
    return {
      key: format.key,
      fileFormat: format.fileFormat,
      formatVersion: format.formatVersion,
      rendererType: format.rendererType,
      rendererLabel: format.rendererLabel,
      label: format.label,
      size: format.size
    };
  }

  async function confirmDownload(downloadFormatOverride = null) {
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
          downloadFormat: downloadFormatPayload(downloadFormatOverride)
        })
      });
      if (data.requiresFormatSelection) {
        const nextFormats = Array.isArray(data.formatOptions) ? data.formatOptions.filter(isUsableFormatOption) : [];
        const defaultFormat = nextFormats.find((option) => option.isDefault) || nextFormats[0] || data.selectedFormat;
        setPendingFormatSelection(data);
        setSelectedFormatKey(defaultFormat?.key || "");
        setPreview({
          ...(preview || {}),
          title: data.title || preview?.title,
          imageUrl: data.imageUrl || preview?.imageUrl,
          productId: data.productId || preview?.productId,
          creditCost: data.creditCost || preview?.creditCost
        });
        finishProgress(language === "vi" ? "Chọn định dạng file" : "Choose file format");
        return;
      }
      setPendingFormatSelection(null);
      setResult(data.downloadUrl || data.url);
      setPreviewImageDownloadUrl(data.previewImageDownloadUrl || "");
      setPreview({
        ...(preview || {}),
        title: data.title || preview?.title,
        imageUrl: data.imageUrl || preview?.imageUrl,
        productId: data.productId || preview?.productId,
        creditCost: data.creditUsed || preview?.creditCost,
        selectedFormat: data.selectedFormat || downloadFormatOverride || null
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
      setPendingFormatSelection(null);
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
                setPendingFormatSelection(null);
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
              <p className="muted" style={{ margin: 0 }}>{t.price}: <CoinAmount value={preview.creditCost || 1} /></p>
            </div>
          </div>
          {canChooseFormat && (
            <div className="formatSelector" aria-label={t.fileFormat}>
              <div className="formatSelectorHeader">
                <span>{t.fileFormat}</span>
                <span>{language === "vi" ? "Dung lượng nén" : "Package size"}</span>
              </div>
              <div className="formatOptionList">
                {formatOptions.map((option) => {
                  const active = option.key === selectedFormat?.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`formatOption ${active ? "active" : ""}`}
                      onClick={() => setSelectedFormatKey(option.key)}
                    >
                      <span className="formatOptionCheck">{active && <Check size={12} />}</span>
                      <span className="formatOptionInfo">
                        <strong>{formatDisplayName(option, t.fileFormat)}</strong>
                        <span className="formatOptionMeta">
                          {option.formatVersion && <small>{t.formatVersion}: {option.formatVersion}</small>}
                          {option.rendererLabel && <small>{t.rendererType}: {option.rendererLabel}</small>}
                        </span>
                      </span>
                      {option.size && <em className="formatOptionSize">{option.size}</em>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {!result && (
            <button type="button" onClick={() => confirmDownload()} disabled={confirming || Boolean(disabledReason)} style={{ marginTop: 14 }}>
              {confirming ? <Loader2 size={18} className="spin" /> : <ArrowDownToLine size={18} />}
              {confirming
                ? t.processing
                : <>{t.confirmDownload} - <CoinAmount value={preview.creditCost || 1} /></>}
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
      {pendingFormatSelection && pendingFormatOptions.length > 1 && typeof document !== "undefined" && createPortal((
        <div className="redownloadFormatOverlay" role="dialog" aria-modal="true">
          <div className="redownloadFormatCard">
            <div className="redownloadFormatHeader">
              <div>
                <span>{language === "vi" ? "Chọn định dạng file" : "Choose file format"}</span>
                <strong>{pendingFormatSelection.title || pendingFormatSelection.productId}</strong>
              </div>
              <button
                type="button"
                className="iconButton"
                onClick={() => setPendingFormatSelection(null)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="formatSelectorHeader">
              <span>{t.fileFormat}</span>
              <span>{language === "vi" ? "Dung lượng nén" : "Package size"}</span>
            </div>
            <div className="formatOptionList">
              {pendingFormatOptions.map((option) => {
                const active = option.key === selectedFormat?.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    className={`formatOption ${active ? "active" : ""}`}
                    onClick={() => setSelectedFormatKey(option.key)}
                  >
                    <span className="formatOptionCheck">{active && <Check size={12} />}</span>
                    <span className="formatOptionInfo">
                      <strong>{formatDisplayName(option, t.fileFormat)}</strong>
                      <span className="formatOptionMeta">
                        {option.formatVersion && <small>{t.formatVersion}: {option.formatVersion}</small>}
                        {option.rendererLabel && <small>{t.rendererType}: {option.rendererLabel}</small>}
                      </span>
                    </span>
                    {option.size && <em className="formatOptionSize">{option.size}</em>}
                  </button>
                );
              })}
            </div>

            <div className="redownloadFormatActions">
              <button
                type="button"
                className="ghostButton"
                onClick={() => setPendingFormatSelection(null)}
                disabled={confirming}
              >
                {language === "vi" ? "Hủy" : "Cancel"}
              </button>
              <button type="button" onClick={() => confirmDownload(selectedFormat)} disabled={confirming || !selectedFormat}>
                {confirming ? <Loader2 size={16} className="spin" /> : <ArrowDownToLine size={16} />}
                {language === "vi" ? "Xác nhận tải" : "Confirm download"}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </section>
  );
}
