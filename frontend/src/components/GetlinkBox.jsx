import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { GETLINK_PREVIEW_DRAFT_TTL_MS, restoreGetlinkDraft, getlinkRequestId } from "../utils/getlinkDraft.js";
import { publicGetlinkError } from "../utils/getlinkErrors.js";

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

function formatOptionsIdentity(options) {
  return JSON.stringify(options.map((option) => ({
    key: String(option.key || ""),
    fileFormat: String(option.fileFormat || option.file_format || ""),
    formatVersion: String(option.formatVersion || ""),
    rendererType: String(option.rendererType || ""),
    rendererLabel: String(option.rendererLabel || ""),
    label: formatDisplayName(option),
    size: String(option.size || ""),
  })).sort((first, second) => first.key.localeCompare(second.key)));
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
  if (["collection", "rewritten_footprint", "hybrid"].includes(resolveMode)) {
    return {
      placeholder: isVi ? "Dán link model 3D66" : "Paste the full 3D model 3D66 link",
      invalid: isVi ? "Vui lòng dán link model 3D66 có mã hợp lệ." : "Paste a 3D model 3D66 link containing a valid model ID.",
    };
  }
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

export default function GetlinkBox({ userId = "", initialUrl = "", language = "vi", disabledReason = "" }) {
  const t = translations[language] || translations.vi;
  const [url, setUrl] = useState(initialUrl);
  const [result, setResult] = useState("");
  const [previewImageDownloadUrl, setPreviewImageDownloadUrl] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewCheckedAt, setPreviewCheckedAt] = useState(0);
  const [includePreviewImage, setIncludePreviewImage] = useState(false);
  const [selectedFormatKey, setSelectedFormatKey] = useState("");
  const [pendingFormatSelection, setPendingFormatSelection] = useState(null);
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [systemStatus, setSystemStatus] = useState({ online: true, message: "" });
  const [modelResolveMode, setModelResolveMode] = useState("");
  const [preparationStatus, setPreparationStatus] = useState("");
  const [reviewRequired, setReviewRequired] = useState(false);
  const [changesAccepted, setChangesAccepted] = useState(false);
  const previewRequestRef = useRef(null);
  const previewScopeRef = useRef("");
  const selectedFormatKeyRef = useRef("");
  const checkoutInFlightRef = useRef(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const progressTimerRef = useRef(null);
  const resetTimerRef = useRef(null);
  const formatDialogDismissedRef = useRef("");
  const formatSelectionJobRef = useRef("");
  const dismissedJobRef = useRef("");
  const acknowledgeInFlightRef = useRef(false);
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
  const hybrid = modelResolveMode === "hybrid";
  const canRecheckAwaitingFormat = hybrid && job?.status === "awaiting_format";
  const pendingFormatOptions = Array.isArray(pendingFormatSelection?.formatOptions)
    ? pendingFormatSelection.formatOptions.filter(isUsableFormatOption)
    : [];
  const formatOptions = Array.isArray(preview?.formatOptions)
    ? preview.formatOptions.filter((option) => isUsableFormatOption(option) && (!hybrid || Boolean(option.key)))
    : [];
  const canChooseFormat = formatOptions.length > 0;
  const selectionOptions = pendingFormatSelection ? pendingFormatOptions : formatOptions;
  const selectedFormat =
    selectionOptions.find((option) => option.key === selectedFormatKey) ||
    (!hybrid && (selectionOptions.find((option) => option.isDefault) || selectionOptions[0] || pendingFormatSelection?.selectedFormat)) ||
    null;
  const priceAvailable = preview?.creditCost !== null && preview?.creditCost !== undefined
    && preview.creditCost !== "" && Number.isFinite(Number(preview.creditCost)) && Number(preview.creditCost) >= 0;
  const noFormatChoice = preview?.formatsChecked === true && Array.isArray(preview.formatOptions) && preview.formatOptions.length === 0;
  const hybridCanConfirm = preparationStatus === "ready" && preview?.metadataIncomplete !== true && priceAvailable
    && (Boolean(selectedFormat) || (noFormatChoice && job?.status !== "awaiting_format"))
    && previewUrl === normalize3D66Input(url, modelResolveMode)
    && draftOwner === String(userId) && (!reviewRequired || changesAccepted);

  useLayoutEffect(() => {
    previewScopeRef.current = JSON.stringify([String(userId), modelResolveMode, url.trim()]);
    return () => {
      previewRequestRef.current?.abort();
      previewRequestRef.current = null;
      previewScopeRef.current = "";
    };
  }, [modelResolveMode, url, userId]);

  useLayoutEffect(() => {
    selectedFormatKeyRef.current = selectedFormatKey;
  }, [selectedFormatKey]);

  useEffect(() => {
    previewRequestRef.current?.abort();
    previewRequestRef.current = null;
    setLoading(false);
    setPreparationStatus("");
    setReviewRequired(false);
    setChangesAccepted(false);
    stopProgressTimer();
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setProgress(0);
    setProgressLabel("");
    resetFaviconProgress();
    setPreview(null);
    setPreviewUrl("");
    setPreviewCheckedAt(0);
    setSelectedFormatKey("");
    setResult("");
    setPreviewImageDownloadUrl("");
    setError("");
    setPendingFormatSelection(null);
    setDraftOwner("");
    if (!userId) {
      setUrl(initialUrl);
      return;
    }
    if (!modelResolveMode) return;
    let stored = null;
    try {
      stored = JSON.parse(window.localStorage.getItem(draftStorageKey(userId)) || "null");
    } catch {
      // A malformed draft is ignored and replaced by the next valid state.
    }
    const draft = restoreGetlinkDraft(stored, { initialUrl, resolveMode: modelResolveMode });
    setUrl(draft.url);
    setIncludePreviewImage(draft.includePreviewImage);
    setPreview(draft.preview);
    setPreviewUrl(draft.previewUrl);
    setPreviewCheckedAt(draft.previewCheckedAt);
    setSelectedFormatKey(draft.selectedFormatKey);
    setPreparationStatus(draft.requiresPreparation ? "stale" : "");
    setReviewRequired(draft.requiresPreparation);
    setDraftOwner(String(userId));
  }, [initialUrl, userId, modelResolveMode]);

  useEffect(() => {
    if (!userId || draftOwner !== String(userId) || job) return;
    try {
      window.localStorage.setItem(draftStorageKey(userId), JSON.stringify({
        url,
        includePreviewImage,
        preview,
        previewUrl,
        previewCheckedAt,
        resolveMode: modelResolveMode,
        selectedFormatKey,
      }));
    } catch {
      // Draft persistence is best effort only.
    }
  }, [draftOwner, includePreviewImage, job, modelResolveMode, preview, previewCheckedAt, previewUrl, selectedFormatKey, url, userId]);

  useEffect(() => {
    if (!job || !modelResolveMode) return;
    if (["completed", "failed", "canceled"].includes(job.status) && dismissedJobRef.current === job.id) return;
    if (job.status === "awaiting_format") {
      if (formatDialogDismissedRef.current !== job.id) {
        setPendingFormatSelection(job);
        if (formatSelectionJobRef.current !== job.id) {
          const retainedFormat = (job.formatOptions || []).find((option) => option.key === selectedFormatKeyRef.current);
          const defaultFormat = retainedFormat || (modelResolveMode !== "hybrid" && ((job.formatOptions || []).find((option) => option.isDefault)
            || job.formatOptions?.[0] || job.selectedFormat));
          setSelectedFormatKey(defaultFormat?.key || "");
          formatSelectionJobRef.current = job.id;
        }
      }
      setPreviewImageFailed(false);
      setPreview((current) => ({
        ...(current || {}),
        title: job.title || current?.title,
        imageUrl: job.imageUrl || current?.imageUrl,
        productId: job.productId || current?.productId,
        creditCost: modelResolveMode === "hybrid" ? job.creditCost ?? current?.creditCost : Number(job.creditCost || current?.creditCost || 0),
      }));
      return;
    }
    formatSelectionJobRef.current = "";
    if (job.status === "completed") {
      setPendingFormatSelection(null);
      setResult(job.result?.downloadUrl || "");
      setPreviewImageDownloadUrl(job.result?.previewImageDownloadUrl || "");
      setIncludePreviewImage(Boolean(job.includePreviewImage));
      setPreviewImageFailed(false);
      setPreview((current) => ({
        ...(current || {}),
        title: job.title || current?.title,
        imageUrl: job.imageUrl || current?.imageUrl,
        productId: job.productId || current?.productId,
        creditCost: Number(job.result?.creditUsed || current?.creditCost || 0),
        selectedFormat: job.selectedFormat || current?.selectedFormat || null,
      }));
      setError("");
      return;
    }
    if (job.status === "failed") {
      setPendingFormatSelection(null);
      setError(typeof job.error === "string" ? { message: job.error }
        : job.error || (language === "vi" ? "Lấy link thất bại." : "Getlink failed."));
      return;
    }
    if (job.status === "canceled") {
      setPendingFormatSelection(null);
      setError("");
    }
  }, [job, language, modelResolveMode]);

  useEffect(() => {
    api("/api/system/3d66-status")
      .then((data) => setSystemStatus({ online: Boolean(data.online), message: data.message || "" }))
      .catch(() => setSystemStatus({ online: false, message: t.systemOfflineMessage }));
  }, [t.systemOfflineMessage]);

  useEffect(() => {
    api("/api/settings")
      .then((data) => setModelResolveMode(data?.settings?.threed66ModelResolveMode || "search"))
      .catch(setError);
  }, []);

  useEffect(() => () => {
    previewRequestRef.current?.abort();
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
    dismissedJobRef.current = job.id;
    acknowledgeInFlightRef.current = true;
    acknowledgeJob(job.id)
      .catch(() => { })
      .finally(() => {
        acknowledgeInFlightRef.current = false;
      });
  }

  async function submit(event) {
    event.preventDefault();
    if (jobActive && !canRecheckAwaitingFormat) {
      setError(language === "vi" ? "Một yêu cầu getlink đang được xử lý." : "A getlink request is already processing.");
      return;
    }
    dismissTerminalJob();
    setError("");
    setResult("");
    setPreviewImageDownloadUrl("");
    const retainedPreview = previewUrl === normalize3D66Input(url, modelResolveMode) ? preview : null;
    if (!retainedPreview) {
      setPreview(null);
      setPreviewUrl("");
      setSelectedFormatKey("");
      selectedFormatKeyRef.current = "";
      setPreviewCheckedAt(0);
    }
    setPreparationStatus("");
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
    previewRequestRef.current?.abort();
    const controller = new AbortController();
    previewRequestRef.current = controller;
    const scope = previewScopeRef.current;
    const isCurrent = () => previewRequestRef.current === controller && !controller.signal.aborted
      && previewScopeRef.current === scope;
    setLoading(true);
    setPreparationStatus("checking");
    setCopied(false);
    beginProgress(t.getlinkChecking, 8, 78);
    try {
      let data = await api("/api/getlink/preview", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({ modelId: modelInput, ...(hybrid ? { progressive: true } : {}) })
      });
      if (!isCurrent()) return;
      setPreviewImageFailed(false);
      setPreviewUrl(modelInput);
      setPreviewCheckedAt(Date.now());
      let previous = retainedPreview;
      let earlyFormats = Array.isArray(retainedPreview?.formatOptions) ? retainedPreview.formatOptions.filter(isUsableFormatOption) : [];
      if (hybrid && data.preparationStatus === "pending") {
        const early = { ...previous, ...data, title: data.title || previous?.title, imageUrl: data.imageUrl || previous?.imageUrl,
          formatOptions: data.formatOptions?.length ? data.formatOptions : previous?.formatOptions || [],
          creditCost: data.creditCost };
        setPreview(early);
        const earlyOptions = (data.formatOptions || []).filter(isUsableFormatOption);
        earlyFormats = earlyOptions;
        const earlyKey = selectedFormatKeyRef.current;
        // Keep an explicit selection while preparing, even if early metadata has no formats.
        if (!earlyKey) {
          const initial = earlyOptions.find((option) => option.key === data.selectedFormat?.key)
            || earlyOptions.find((option) => option.isDefault) || earlyOptions[0];
          selectedFormatKeyRef.current = initial?.key || "";
          setSelectedFormatKey(selectedFormatKeyRef.current);
        }
        previous = { ...previous, ...early };
        setPreparationStatus("pending");
        beginProgress(t.getlinkPreparing, 35, 92);
        data = await api("/api/getlink/preview/prepare", {
          method: "POST",
          signal: controller.signal,
          body: JSON.stringify({ modelId: modelInput }),
        });
        if (!isCurrent()) return;
        setPreviewImageFailed(false);
      }
      if (hybrid) {
        const options = Array.isArray(data.formatOptions)
          ? data.formatOptions.filter((option) => isUsableFormatOption(option) && option.key) : [];
        const checkedWithoutChoices = data.formatsChecked === true && Array.isArray(data.formatOptions) && data.formatOptions.length === 0;
        if (data.preparationStatus !== "ready" || data.metadataIncomplete === true || (!options.length && !checkedWithoutChoices) || data.creditCost == null
          || data.creditCost === "" || !Number.isFinite(Number(data.creditCost)) || Number(data.creditCost) < 0) {
          setPreview({ ...previous, ...data, title: data.title || previous?.title, imageUrl: data.imageUrl || previous?.imageUrl,
            formatOptions: previous?.formatOptions || options });
          throw new Error(t.getlinkFormatsUnavailable);
        }
        const currentKey = selectedFormatKeyRef.current;
        const retained = options.find((option) => option.key === currentKey);
        const previousCost = previous?.creditCost ?? retainedPreview?.creditCost;
        const changed = Boolean(currentKey && !retained)
          || (previousCost != null && Number(previousCost) !== Number(data.creditCost))
          || (earlyFormats.length > 0 && formatOptionsIdentity(earlyFormats) !== formatOptionsIdentity(options));
        const nextFormat = retained || (!currentKey && (options.find((option) => option.key === data.selectedFormat?.key)
          || options.find((option) => option.isDefault) || options[0]));
        setPreview({ ...data, title: data.title || previous?.title, imageUrl: data.imageUrl || previous?.imageUrl });
        setSelectedFormatKey(nextFormat?.key || "");
        setReviewRequired((current) => current || changed);
        setChangesAccepted(false);
        setPreparationStatus("ready");
      } else {
        setPreview(data);
        setSelectedFormatKey(data.selectedFormat?.key || "");
      }
      setPreviewCheckedAt(Date.now());
      finishProgress(language === "vi" ? "Đã lấy thông tin model" : "Model info loaded");
    } catch (err) {
      if (!isCurrent()) return;
      setPreparationStatus("error");
      setError(err);
      errorProgress(language === "vi" ? "Kiểm tra thất bại" : "Check failed");
    } finally {
      if (previewRequestRef.current === controller) {
        previewRequestRef.current = null;
        setLoading(false);
      }
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
    if (checkoutInFlightRef.current || confirming || (hybrid && !hybridCanConfirm)) return;
    const scope = previewScopeRef.current;
    if (hybrid && (Date.now() - previewCheckedAt >= GETLINK_PREVIEW_DRAFT_TTL_MS || Date.now() < previewCheckedAt)) {
      setPreparationStatus("stale");
      setError(t.getlinkRecheck);
      return;
    }
    setError("");
    setResult("");
    setPreviewImageDownloadUrl("");
    if (disabledReason) {
      setError(disabledReason);
      return;
    }
    setCopied(false);
    checkoutInFlightRef.current = true;
    try {
      const modelInput = normalize3D66Input(previewUrl || url, modelResolveMode);
      if (!modelInput) {
        setError(modeText.invalid);
        return;
      }
      const formatChoice = downloadFormatOverride || selectedFormat;
      if (job?.status === "awaiting_format") {
        if (!formatChoice?.key || (hybrid && !(job.formatOptions || []).some((option) => option.key === formatChoice.key))) {
          setError(t.getlinkChooseFormat);
          return;
        }
        await chooseFormat(job.id, formatChoice.key);
        setPendingFormatSelection(null);
        formatDialogDismissedRef.current = "";
        return;
      }
      if (job && ["completed", "failed", "canceled"].includes(job.status)) {
        await acknowledgeJob(job.id);
      }
      if (previewScopeRef.current !== scope) return;
      if (hybrid && Date.now() - previewCheckedAt >= GETLINK_PREVIEW_DRAFT_TTL_MS) {
        setPreparationStatus("stale");
        setError(t.getlinkRecheck);
        return;
      }
      const requestStorageKey = `${draftStorageKey(userId)}:request-id`;
      const payload = { modelId: modelInput, includePreviewImage,
        downloadFormat: downloadFormatPayload(downloadFormatOverride || selectedFormat) };
      let clientRequestId = "";
      try {
        clientRequestId = getlinkRequestId(window.localStorage, requestStorageKey, payload, () => crypto.randomUUID());
      } catch {
        clientRequestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
      await createJob({
        ...payload,
        clientRequestId,
      });
      try {
        window.localStorage.removeItem(requestStorageKey);
      } catch {
        // The server-side idempotency key still protects the request.
      }
    } catch (err) {
      if (previewScopeRef.current === scope) setError(err);
    } finally {
      checkoutInFlightRef.current = false;
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
      setError(retryError);
    }
  }

  async function cancelCurrentJob() {
    try {
      setError("");
      await cancelJob(job.id);
      setPendingFormatSelection(null);
      formatDialogDismissedRef.current = "";
    } catch (cancelError) {
      setError(cancelError);
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
      invalidatePreviewRequest();
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

  function invalidatePreviewRequest() {
    previewRequestRef.current?.abort();
    previewRequestRef.current = null;
    setLoading(false);
    setPreviewUrl("");
    setPreviewCheckedAt(0);
    setPreparationStatus("");
    setReviewRequired(false);
    setChangesAccepted(false);
    stopProgressTimer();
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }

  return (
    <section className="panel" data-preparation-status={hybrid ? preparationStatus : undefined}>
      <form className="getlinkForm" onSubmit={submit}>
        <h2>{hybrid ? (language === "vi" ? "Nhập link model" : "Enter a model link") : t.getlinkTitle}</h2>
        <p className="muted getlinkCreditNote">
          {language === "vi"
            ? "Credit tỉ lệ 1:1 với 3d66, giá model là giá của 3d66, trung bình 28 credit/model."
            : "Credit follows 3d66 at a 1:1 rate. Each model costs the same credit amount shown on 3d66, averaging 28 credits/model."}
        </p>
        <div className="inputRow">
          <div className="linkInputWrap terminalInput">
            <input
              id="modelUrl"
              value={url}
              aria-label={t.getlinkInputAria}
              onChange={(event) => {
                invalidatePreviewRequest();
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
          <button type="submit" disabled={!modelResolveMode || loading || (jobActive && !canRecheckAwaitingFormat) || !url || Boolean(disabledReason)}>
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
      {disabledReason && <p className="error">{publicGetlinkError(disabledReason, language).message}</p>}
      {error && !disabledReason && <p className="error">{typeof error === "string" ? error : publicGetlinkError(error, language).message}</p>}
      {job?.status === "failed" && (
        <div className="getlinkJobActions">
          <button type="button" onClick={hybrid ? () => confirmDownload() : retryCurrentJob}
            disabled={jobActionLoading || (hybrid && !hybridCanConfirm)}>
            {jobActionLoading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            {language === "vi" ? "Thử lại" : "Retry"}
          </button>
        </div>
      )}
      {hybrid && job?.status === "awaiting_format" && !pendingFormatSelection && (
        <div className="getlinkJobActions">
          <button type="button" onClick={() => setPendingFormatSelection(job)}>
            <Check size={16} />{language === "vi" ? "Chọn định dạng" : "Choose format"}
          </button>
        </div>
      )}
      {preview && (
        <div className="result">
          <span>{t.modelInfo}</span>
          <div style={{ display: "grid", gridTemplateColumns: "96px minmax(0, 1fr)", gap: 14, alignItems: "center" }}>
            <div style={{ width: 96, height: 96, borderRadius: 8, overflow: "hidden", background: "rgba(255,255,255,0.05)" }}>
              {preview.imageUrl && !previewImageFailed ? (
                <img
                  src={preview.imageUrl}
                  alt={preview.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  onError={() => setPreviewImageFailed(true)}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", opacity: 0.55 }}>
                  3D
                </div>
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <strong style={{ display: "block", overflowWrap: "anywhere" }}>{preview.title || preview.productId}</strong>
              <p className="muted" style={{ margin: "6px 0" }}>{t.productCode}: {preview.productId}</p>
              <p className="muted" style={{ margin: 0 }}>{t.price}: {hybrid && !priceAvailable
                ? t.getlinkPreparing : <CoinAmount value={hybrid ? preview.creditCost : preview.creditCost || 1} />}</p>
            </div>
          </div>
          {canChooseFormat && (
            <div className="formatSelector" aria-label={t.fileFormat}>
              <div className="formatSelectorHeader">
                <span>{t.fileFormat}</span>
                <span>{language === "vi" ? "Dung lượng nén" : "Package size"}</span>
              </div>
              <div className="formatOptionList" role="group" aria-label={t.fileFormat}>
                {formatOptions.map((option) => {
                  const active = option.key === selectedFormat?.key;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className={`formatOption ${active ? "active" : ""}`}
                      aria-pressed={active}
                      disabled={confirming}
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
          {hybrid && (
            <div className="getlinkPreparation" aria-live="polite" role="status">
              <p className="muted">{preparationStatus === "pending" || preparationStatus === "checking" ? t.getlinkPreparing
                : preparationStatus === "ready" ? t.getlinkPrepared
                  : preparationStatus === "error" ? t.getlinkPrepareFailed : t.getlinkRecheck}</p>
              {preparationStatus === "ready" && canChooseFormat && !selectedFormat && <p>{t.getlinkChooseFormat}</p>}
              {preparationStatus === "ready" && reviewRequired && (
                <>
                  <p>{t.getlinkReviewChanged}</p>
                  <label className="previewImageOption">
                    <input type="checkbox" checked={changesAccepted} disabled={confirming}
                      onChange={(event) => setChangesAccepted(event.target.checked)} />
                    <span>{t.getlinkAcceptChanges}</span>
                  </label>
                </>
              )}
              {["error", "stale"].includes(preparationStatus) && (
                <button type="button" className="smallButton" onClick={submit} disabled={loading || (jobActive && !canRecheckAwaitingFormat)}>
                  <Search size={16} />{t.getlinkRetryPreparation}
                </button>
              )}
            </div>
          )}
          {!result && job?.status !== "failed" && job?.status !== "canceled" && (
            <button type="button" onClick={() => confirmDownload()}
              disabled={confirming || loading || Boolean(disabledReason) || (hybrid && !hybridCanConfirm)} style={{ marginTop: 14 }}>
              {confirming ? <Loader2 size={18} className="spin" /> : <ArrowDownToLine size={18} />}
              {confirming
                ? t.processing
                : <>{t.confirmDownload}{(!hybrid || priceAvailable) && <> - <CoinAmount value={hybrid ? preview.creditCost : preview.creditCost || 1} /></>}</>}
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
      {pendingFormatSelection && pendingFormatOptions.length > (hybrid ? 0 : 1) && typeof document !== "undefined" && createPortal((
        <div className="redownloadFormatOverlay" role="dialog" aria-modal="true">
          <div className="redownloadFormatCard">
            <div className="redownloadFormatHeader">
              <div>
                <span>{language === "vi" ? "Chọn định dạng file" : "Choose file format"}</span>
                <strong>{pendingFormatSelection.title || pendingFormatSelection.productId}</strong>
                {hybrid && <p>{t.price}: {priceAvailable ? <CoinAmount value={preview.creditCost} /> : t.getlinkPreparing}</p>}
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
                    aria-pressed={active}
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
              {hybrid && !hybridCanConfirm && (
                <button type="button" onClick={submit} disabled={loading}>
                  <Search size={16} />{t.getlinkRetryPreparation}
                </button>
              )}
              <button
                type="button"
                className="ghostButton"
                onClick={cancelCurrentJob}
                disabled={confirming}
              >
                {language === "vi" ? "Hủy yêu cầu" : "Cancel request"}
              </button>
              <button type="button" onClick={() => confirmDownload(selectedFormat)}
                disabled={confirming || !selectedFormat || (hybrid && !hybridCanConfirm)}>
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
