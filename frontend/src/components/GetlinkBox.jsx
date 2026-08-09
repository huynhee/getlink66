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
import { useGetlinkJob } from "../contexts/GetlinkJobContext.jsx";

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

function normalize3D66Input(value = "", resolveMode = "search") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    if (resolveMode === "search") return "";
    try {
      const parsed = new URL(text);
      const host = parsed.hostname.toLowerCase();
      const is3D66 = host === "3d66.com" || host.endsWith(".3d66.com");
      return is3D66 && parsed.searchParams.get("sof") ? text : "";
    } catch {
      return "";
    }
  }
  if (resolveMode !== "search") return "";
  return /^[A-Z0-9_-]{8,64}$/i.test(text) && /[A-Z]/i.test(text) && /\d{6,}/.test(text)
    ? text.toUpperCase()
    : "";
}

function inputValueWhileTyping(value = "", resolveMode = "search") {
  return resolveMode === "search" ? value.toUpperCase() : value;
}

function inputModeText(resolveMode = "search", language = "vi") {
  const isVi = language === "vi";
  if (resolveMode === "footprint") {
    return {
      placeholder: isVi ? "Nhập link model 3D66" : "Paste the full 3D model 3D66 link",
      invalid: isVi ? "Vui lòng dán link model 3D66 có mã hợp lệ." : "Paste a 3D model 3D66 link containing a valid model ID.",
    };
  }
  if (resolveMode === "direct") {
    return {
      placeholder: isVi ? "Dán link model 3D66" : "Paste the full 3D model 3D66 link",
      invalid: isVi ? "Vui lòng dán link model 3D66 có mã hợp lệ." : "Paste a 3D model 3D66 link containing a valid model ID.",
    };
  }
  return {
    placeholder: isVi ? "Nhập mã model" : "Enter a 3D model ID",
    invalid: isVi ? "Vui lòng nhập mã model hợp lệ." : "Enter a valid 3D model ID.",
  };
}

function getlinkJobStageLabel(stage, language = "vi") {
  const labels = {
    queued: ["Đang xếp hàng...", "Queued..."],
    validating: ["Đang kiểm tra yêu cầu...", "Validating request..."],
    resolving_format: ["Đang kiểm tra định dạng file...", "Checking file formats..."],
    resolving_download: ["Đang lấy link tải...", "Resolving download link..."],
    saving: ["Đang lưu lịch sử...", "Saving download history..."],
  };
  return (labels[stage] || labels.queued)[language === "vi" ? 0 : 1];
}

function draftStorageKey(userId) {
  return `3dipl-getlink-draft:${String(userId || "anonymous")}`;
}

export default function GetlinkBox({ userId = "", onCreditChange, initialUrl = "", language = "vi", disabledReason = "" }) {
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
  const [copied, setCopied] = useState(false);
  const [systemStatus, setSystemStatus] = useState({ online: true, message: "" });
  const [modelResolveMode, setModelResolveMode] = useState("search");
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const progressTimerRef = useRef(null);
  const resetTimerRef = useRef(null);
  const formatDialogDismissedRef = useRef("");
  const acknowledgeInFlightRef = useRef(false);
  const completedJobAppliedRef = useRef("");
  const [draftOwner, setDraftOwner] = useState("");
  const {
    job,
    actionLoading: jobActionLoading,
    isActive: jobActive,
    createJob,
    chooseFormat,
    retryJob,
    cancelJob,
    acknowledgeJob,
  } = useGetlinkJob();
  const confirming = jobActionLoading || Boolean(job && ["queued", "processing"].includes(job.status));
  const visibleProgress = jobActive && job?.status !== "awaiting_format" ? Number(job.progress || 0) : progress;
  const visibleProgressLabel = jobActive && job?.status !== "awaiting_format"
    ? getlinkJobStageLabel(job.stage, language)
    : progressLabel;
  const modeText = inputModeText(modelResolveMode, language);
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
    if (!userId) {
      setDraftOwner("");
      return;
    }
    try {
      const stored = JSON.parse(window.localStorage.getItem(draftStorageKey(userId)) || "null");
      if (stored && typeof stored === "object") {
        if (!initialUrl && stored.url) setUrl(String(stored.url));
        setIncludePreviewImage(Boolean(stored.includePreviewImage));
        if (stored.preview && typeof stored.preview === "object") setPreview(stored.preview);
        if (stored.previewUrl) setPreviewUrl(String(stored.previewUrl));
      }
    } catch {
      // A malformed draft is ignored and replaced by the next valid state.
    }
    setDraftOwner(String(userId));
  }, [initialUrl, userId]);

  useEffect(() => {
    if (!userId || draftOwner !== String(userId) || job) return;
    try {
      window.localStorage.setItem(draftStorageKey(userId), JSON.stringify({
        url,
        includePreviewImage,
        preview,
        previewUrl,
      }));
    } catch {
      // Draft persistence is best effort only.
    }
  }, [draftOwner, includePreviewImage, job, preview, previewUrl, url, userId]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "awaiting_format") {
      if (formatDialogDismissedRef.current !== job.id) {
        setPendingFormatSelection(job);
        const defaultFormat = (job.formatOptions || []).find((option) => option.isDefault)
          || job.formatOptions?.[0]
          || job.selectedFormat;
        setSelectedFormatKey(defaultFormat?.key || "");
      }
      setPreview((current) => ({
        ...(current || {}),
        title: job.title || current?.title,
        imageUrl: job.imageUrl || current?.imageUrl,
        productId: job.productId || current?.productId,
        creditCost: Number(job.creditCost || current?.creditCost || 0),
      }));
      return;
    }
    if (job.status === "completed") {
      setPendingFormatSelection(null);
      setResult(job.result?.downloadUrl || "");
      setPreviewImageDownloadUrl(job.result?.previewImageDownloadUrl || "");
      setIncludePreviewImage(Boolean(job.includePreviewImage));
      setPreview((current) => ({
        ...(current || {}),
        title: job.title || current?.title,
        imageUrl: job.imageUrl || current?.imageUrl,
        productId: job.productId || current?.productId,
        creditCost: Number(job.result?.creditUsed || current?.creditCost || 0),
        selectedFormat: job.selectedFormat || current?.selectedFormat || null,
      }));
      setError("");
      if (completedJobAppliedRef.current !== job.id) {
        completedJobAppliedRef.current = job.id;
        onCreditChange(Number(job.result?.credit || 0));
      }
      return;
    }
    if (job.status === "failed") {
      setPendingFormatSelection(null);
      setError(job.error?.message || (language === "vi" ? "Lấy link thất bại." : "Getlink failed."));
      return;
    }
    if (job.status === "canceled") {
      setPendingFormatSelection(null);
      setError("");
    }
  }, [job, language, onCreditChange]);

  useEffect(() => {
    api("/api/system/3d66-status")
      .then((data) => setSystemStatus({ online: Boolean(data.online), message: data.message || "" }))
      .catch(() => setSystemStatus({ online: false, message: t.systemOfflineMessage }));
  }, [t.systemOfflineMessage]);

  useEffect(() => {
    api("/api/settings")
      .then((data) => setModelResolveMode(data?.settings?.threed66ModelResolveMode || "search"))
      .catch(() => setModelResolveMode("search"));
  }, []);

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

  function dismissTerminalJob() {
    if (!job || !["completed", "failed", "canceled"].includes(job.status) || acknowledgeInFlightRef.current) return;
    acknowledgeInFlightRef.current = true;
    acknowledgeJob(job.id)
      .catch(() => { })
      .finally(() => {
        acknowledgeInFlightRef.current = false;
      });
  }

  async function submit(event) {
    event.preventDefault();
    if (jobActive) {
      setError(language === "vi" ? "Một yêu cầu getlink đang được xử lý." : "A getlink request is already processing.");
      return;
    }
    dismissTerminalJob();
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
    const modelInput = normalize3D66Input(url, modelResolveMode);
    if (!modelInput) {
      setError(modeText.invalid);
      errorProgress(language === "vi" ? "Mã model không hợp lệ" : "Invalid model ID");
      return;
    }
    setLoading(true);
    setCopied(false);
    beginProgress(language === "vi" ? "Đang kiểm tra model..." : "Checking model...", 8, 78);
    try {
      const data = await api("/api/getlink/preview", {
        method: "POST",
        body: JSON.stringify({ modelId: modelInput })
      });
      setPreview(data);
      setPreviewUrl(modelInput);
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
    setCopied(false);
    try {
      const modelInput = normalize3D66Input(previewUrl || url, modelResolveMode);
      if (!modelInput) {
        setError(modeText.invalid);
        return;
      }
      if (job?.status === "awaiting_format" && downloadFormatOverride?.key) {
        await chooseFormat(job.id, downloadFormatOverride.key);
        setPendingFormatSelection(null);
        formatDialogDismissedRef.current = "";
        return;
      }
      if (job && ["completed", "failed", "canceled"].includes(job.status)) {
        await acknowledgeJob(job.id);
      }
      const requestStorageKey = `${draftStorageKey(userId)}:request-id`;
      let clientRequestId = "";
      try {
        clientRequestId = window.localStorage.getItem(requestStorageKey) || crypto.randomUUID();
        window.localStorage.setItem(requestStorageKey, clientRequestId);
      } catch {
        clientRequestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
      await createJob({
        modelId: modelInput,
        includePreviewImage,
        downloadFormat: downloadFormatPayload(downloadFormatOverride),
        clientRequestId,
      });
      try {
        window.localStorage.removeItem(draftStorageKey(userId));
        window.localStorage.removeItem(requestStorageKey);
      } catch {
        // The server-side idempotency key still protects the request.
      }
    } catch (err) {
      setError(err.message);
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

  async function retryCurrentJob() {
    try {
      setError("");
      await retryJob(job.id);
    } catch (retryError) {
      setError(retryError.message);
    }
  }

  async function cancelCurrentJob() {
    try {
      setError("");
      await cancelJob(job.id);
      setPendingFormatSelection(null);
      formatDialogDismissedRef.current = "";
    } catch (cancelError) {
      setError(cancelError.message);
    }
  }

  async function pasteLink() {
    setError("");
    dismissTerminalJob();
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
      const modelInput = normalize3D66Input(pasted, modelResolveMode);
      if (!modelInput) {
        setError(modeText.invalid);
        return;
      }

      setUrl(modelInput);
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
          <div className="linkInputWrap terminalInput">
            <input
              id="modelUrl"
              value={url}
              aria-label={t.getlinkInputAria}
              onChange={(event) => {
                dismissTerminalJob();
                setError("");
                setUrl(inputValueWhileTyping(event.target.value, modelResolveMode));
                setPreview(null);
                setSelectedFormatKey("");
                setPendingFormatSelection(null);
                setResult("");
                setPreviewImageDownloadUrl("");
                setProgress(0);
                setProgressLabel("");
                resetFaviconProgress();
              }}
              placeholder={modeText.placeholder}
              disabled={jobActive}
            />
            <button type="button" className="pasteInlineButton" onClick={pasteLink} title={t.pasteTitle} disabled={jobActive}>
              <ClipboardPaste size={14} />
              {t.paste}
            </button>
          </div>
          <button type="submit" disabled={loading || jobActive || !url || Boolean(disabledReason)}>
            {loading ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
            {loading ? t.processing : t.checkLink}
          </button>
        </div>
        <label className="previewImageOption">
          <input
            type="checkbox"
            checked={includePreviewImage}
            onChange={(event) => setIncludePreviewImage(event.target.checked)}
            disabled={jobActive}
          />
          <span>
            <strong>{t.downloadPreviewImageOption}</strong>
          </span>
        </label>
      </form>
      {(loading || confirming || visibleProgress > 0) && (
        <div className="getlinkProgress" aria-live="polite">
          <div>
            <span>{visibleProgressLabel || t.processing}</span>
            <strong>{Math.round(visibleProgress)}%</strong>
          </div>
          <div className="getlinkProgressTrack">
            <i style={{ width: `${Math.max(0, Math.min(100, visibleProgress))}%` }} />
          </div>
        </div>
      )}
      {job?.canCancel && job.status !== "awaiting_format" && (
        <div className="getlinkJobActions">
          <button type="button" className="smallButton" onClick={cancelCurrentJob} disabled={jobActionLoading}>
            <X size={14} />
            {language === "vi" ? "Hủy yêu cầu" : "Cancel request"}
          </button>
        </div>
      )}
      {disabledReason && <p className="error">{disabledReason}</p>}
      {error && !disabledReason && <p className="error">{error}</p>}
      {job?.status === "failed" && (
        <div className="getlinkJobActions">
          <button type="button" onClick={retryCurrentJob} disabled={jobActionLoading}>
            {jobActionLoading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            {language === "vi" ? "Thử lại" : "Retry"}
          </button>
        </div>
      )}
      {preview && (
        <div className="result">
          <span>{t.modelInfo}</span>
          <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", gap: 14, alignItems: "center" }}>
            <div style={{ width: 96, height: 96, borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
              {preview.imageUrl ? (
                <img src={preview.imageUrl} alt={preview.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.55 }}>
                  3D
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
          {!result && job?.status !== "failed" && job?.status !== "canceled" && (
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
                onClick={() => {
                  formatDialogDismissedRef.current = job?.id || "dismissed";
                  setPendingFormatSelection(null);
                }}
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
                onClick={cancelCurrentJob}
                disabled={confirming}
              >
                {language === "vi" ? "Hủy yêu cầu" : "Cancel request"}
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
