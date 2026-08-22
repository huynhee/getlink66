import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ClipboardPaste, Download, Filter, Flag, HardDrive, Image as ImageIcon, ImagePlus, Loader2, LogIn, Package, Search, ShieldCheck, Sparkles, Upload, X } from "lucide-react";
import { api, apiCached, buildApiUrl, prefetchApi } from "../api.js";
import Pagination from "../components/Pagination.jsx";
import SiteFooter from "../components/SiteFooter.jsx";

const EMPTY_FILTERS = {
  style: [],
  render: [],
  form: [],
  color: [],
  material: [],
  platform: [],
};
const IMAGE_SEARCH_ENABLED = String(import.meta.env.VITE_MARKETPLACE_IMAGE_SEARCH_ENABLED || "false").toLowerCase() === "true";

function marketplaceRecentSearches(assetType) {
  if (typeof window === "undefined") return [];
  try {
    const values = JSON.parse(window.localStorage.getItem(`3dipl.marketplace.recent.${assetType}`) || "[]");
    return Array.isArray(values) ? values.filter((value) => typeof value === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function rememberMarketplaceSearch(assetType, value) {
  if (typeof window === "undefined") return;
  const query = String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (query.length < 2) return;
  const values = [query, ...marketplaceRecentSearches(assetType).filter((item) => item.toLowerCase() !== query.toLowerCase())].slice(0, 8);
  window.localStorage.setItem(`3dipl.marketplace.recent.${assetType}`, JSON.stringify(values));
}

const MARKETPLACE_REPORT_REASONS = [
  ["download_failed", "Không tải được", "Download failed"],
  ["archive_corrupt", "File nén bị lỗi", "Corrupt archive"],
  ["wrong_asset", "Sai model hoặc scene", "Wrong asset"],
  ["missing_files", "Thiếu file hoặc tài nguyên", "Missing files or assets"],
  ["preview_incorrect", "Ảnh preview không đúng", "Incorrect preview"],
  ["metadata_incorrect", "Thông tin không chính xác", "Incorrect information"],
  ["duplicate", "Tài nguyên bị trùng", "Duplicate asset"],
  ["other", "Lỗi khác", "Other issue"],
];

let turnstileScriptPromise = null;

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.turnstile) {
        reject(new Error("Turnstile did not initialize."));
        return;
      }
      resolve(window.turnstile);
    };
    script.onerror = () => {
      turnstileScriptPromise = null;
      reject(new Error("Cannot load Turnstile."));
    };
    document.head.appendChild(script);
  });
  return turnstileScriptPromise;
}

const FILTER_TITLES_EN = {
  style: "Style",
  render: "Render",
  form: "Form",
  color: "Color",
  material: "Material",
  platform: "Platform",
};

const FILTER_TITLES_VI = {
  style: "Phong cách",
  render: "Render",
  form: "Hình dạng",
  color: "Màu sắc",
  material: "Vật liệu",
  platform: "Nền tảng",
};

function cover(model = {}) {
  const image = model.coverImage || model.previewImages?.[0];
  const url = image?.cachedUrl || image?.url || "";
  return url.startsWith("/") ? buildApiUrl(url) : url;
}

function previewImageSrc(image = {}) {
  const url = image.cachedUrl || image.url || "";
  return url.startsWith("/") ? buildApiUrl(url) : url;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return "-";
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function catalogSegment(assetType = "model") {
  return assetType === "scene" ? "scenes" : "models";
}

function catalogNoun(assetType = "model", language = "vi", plural = false) {
  if (assetType === "scene") return plural && language === "en" ? "scenes" : "scene";
  if (language === "vi") return "model";
  return plural ? "models" : "model";
}

function modelPath(model = {}) {
  const slugOrId = model.slug || model._id || "";
  return `/${catalogSegment(model.assetType)}/${encodeURIComponent(slugOrId)}`;
}

function detailSlugFromPath(path = "", assetType = "model") {
  const match = String(path).match(new RegExp(`^/${catalogSegment(assetType)}/([^/?#]+)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function categoryFromPath(path = "", assetType = "model") {
  try {
    return new URL(String(path || `/${catalogSegment(assetType)}`), window.location.origin).searchParams.get("category") || "";
  } catch {
    return "";
  }
}

function searchFromPath(path = "", assetType = "model") {
  try {
    return new URL(String(path || `/${catalogSegment(assetType)}`), window.location.origin).searchParams.get("q") || "";
  } catch {
    return "";
  }
}

function navigateTo(path, onNavigate, event) {
  if (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
  }
  if (onNavigate) onNavigate(path);
  else window.location.assign(path);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function accessBadgeClass(accessType) {
  if (accessType === "free") return "success";
  return "pending";
}

function accessLabel(accessType) {
  return accessType === "free" ? "free" : "pro";
}

function statusBadgeClass(fileStatus) {
  if (fileStatus === "ready") return "success";
  if (fileStatus === "failed") return "error";
  return "pending";
}

function labelForCategory(category, language = "vi") {
  if (language === "vi") return category?.title || category?.titleEn || "";
  return category?.titleEn || category?.title || "";
}

function findCategoryBySlug(categories = [], slug = "") {
  for (const item of categories) {
    if (item.slug === slug) return item;
    const child = findCategoryBySlug(item.children || [], slug);
    if (child) return child;
  }
  return null;
}

function parentSlugForCategory(categories = [], slug = "") {
  for (const item of categories) {
    if (item.slug === slug) return item.slug;
    if ((item.children || []).some((child) => child.slug === slug)) return item.slug;
    const nested = parentSlugForCategory(item.children || [], slug);
    if (nested) return nested;
  }
  return "";
}

function labelForFacet(filterOptions = {}, facet, value, language = "vi") {
  const option = filterOptions[facet]?.find((item) => item.value === value);
  if (language === "vi") return option?.labelVi || option?.labelEn || option?.label || value;
  return option?.labelEn || option?.label || value;
}

function modelCategoryLabel(model = {}, language = "vi") {
  return labelForCategory(model.category, language) || labelForCategory(model.parentCategory, language) || "";
}

function textFor(language, vi, en) {
  return language === "vi" ? vi : en;
}

function CategoryButton({ category, selected, isOpen, onOpen, onSelect, language = "vi" }) {
  const children = category.children || [];
  const hasChildren = children.length > 0;
  const childSelected = children.some((child) => selected === child.slug);
  const parentSelected = selected === category.slug;

  return (
    <div className={`marketCategoryGroup ${isOpen ? "open" : ""} ${childSelected ? "hasChildSelected" : ""}`}>
      <div className={`marketCategoryRow parent ${parentSelected ? "active" : ""}`}>
        <label
          className="marketCategorySelector"
          title={textFor(language, `Chọn toàn bộ ${labelForCategory(category, language)}`, `Select all ${labelForCategory(category, language)}`)}
        >
          <input
            type="checkbox"
            checked={parentSelected}
            onChange={() => onSelect(parentSelected ? "" : category.slug)}
            aria-label={textFor(language, `Chọn toàn bộ ${labelForCategory(category, language)}`, `Select all ${labelForCategory(category, language)}`)}
          />
          <span className={`marketCategoryCheck ${parentSelected ? "checked" : ""}`} aria-hidden="true" />
        </label>
        <button
          type="button"
          className="marketCategoryToggle"
          aria-expanded={hasChildren ? isOpen : undefined}
          onClick={() => hasChildren ? onOpen(isOpen ? "" : category.slug) : onSelect(parentSelected ? "" : category.slug)}
        >
          <span>{labelForCategory(category, language)}</span>
          {hasChildren && <ChevronRight className="marketCategoryArrow" size={15} aria-hidden="true" />}
        </button>
      </div>
      {hasChildren && isOpen && (
        <div className="marketSubcategoryList">
          {children.map((child) => (
            <button
              type="button"
              key={child._id || child.slug}
              className={`marketCategoryRow child ${parentSelected || selected === child.slug ? "active" : ""}`}
              onClick={() => onSelect(selected === child.slug ? "" : child.slug)}
            >
              <span className={`marketCategoryCheck ${parentSelected || selected === child.slug ? "checked" : ""}`} aria-hidden="true" />
              <span>{labelForCategory(child, language)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function toggleListValue(items, value) {
  return items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
}

function ShapeIcon({ value }) {
  const shape = value === "l-shape" ? "angle" : value === "organic" ? "bioform" : value;
  return (
    <svg className="marketShapeIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {shape === "round" && <circle cx="12" cy="12" r="8" />}
      {shape === "oval" && <ellipse cx="12" cy="12" rx="8.6" ry="4.6" />}
      {shape === "square" && <rect x="6" y="6" width="12" height="12" />}
      {shape === "rectangle" && <rect x="4.5" y="8" width="15" height="8" />}
      {shape === "triangle" && <polygon points="12 4.5 21 19 3 19" />}
      {shape === "diamond" && <polygon points="12 4 20 12 12 20 4 12" />}
      {shape === "pentagon" && <polygon points="12 4 20 10.5 17 20 7 20 4 10.5" />}
      {shape === "star" && <polygon points="12 3.5 14.6 8.8 20.5 9.6 16.25 13.75 17.25 19.6 12 16.85 6.75 19.6 7.75 13.75 3.5 9.6 9.4 8.8" />}
      {shape === "angle" && <polyline points="6 5 6 18 18 18" />}
      {shape === "bioform" && <path d="M8.4 7.6c1.4-3.1 5-3 6.1-.2 3.4-.4 5.2 3.5 2.8 5.7 1.4 3.6-2.4 6.2-5.4 4.1-2.7 2.4-6.5.5-5.8-3.1-3.3-1.5-2.2-5.8 1.3-5.7.3-.3.6-.6 1-.8Z" />}
    </svg>
  );
}

function FacetIcon({ iconKey = "" }) {
  if (!iconKey) return null;
  const labels = {
    vray: "V",
    corona: "",
    standard: "S",
    "3dsmax": "3",
    autocad: "A",
    sketchup: "S",
    "fbx-obj": "F",
  };
  return (
    <span className={`marketFacetBrandIcon ${iconKey}`} aria-hidden="true">
      {labels[iconKey] ?? iconKey.slice(0, 1).toUpperCase()}
    </span>
  );
}

function FacetSection({ id, title, options = [], values = [], onToggle, onClear, language = "vi" }) {
  const [expanded, setExpanded] = useState(true);
  if (!options.length) return null;
  const isColor = id === "color";
  const isShape = id === "form";
  const isCompact = ["render", "form", "platform"].includes(id);
  const selectedCount = values.length;
  return (
    <div className={`marketFacetSection ${id} ${selectedCount ? "hasSelection" : ""}`}>
      <div className="marketFacetHeader">
        <button
          type="button"
          className="marketFilterCollapse"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <h3>{title}</h3>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {selectedCount > 0 && (
          <button
            type="button"
            className="marketFacetClear"
            onClick={() => onClear(id)}
            aria-label={textFor(language, `Xóa ${title}`, `Clear ${title}`)}
            title={textFor(language, `Xóa ${title}`, `Clear ${title}`)}
          >
            <span>{selectedCount}</span>
            <X size={12} />
          </button>
        )}
      </div>
      {expanded && <div className={isColor ? "marketColorFacetGrid" : isCompact ? "marketFacetOptions compact" : "marketFacetOptions"}>
        {options.map((option) => {
          const checked = values.includes(option.value);
          const label = labelForFacet({ [id]: options }, id, option.value, language);
          return (
            <button
              type="button"
              key={option.value}
              className={`marketFacetOption ${checked ? "active" : ""} ${isColor ? "color" : ""} ${isShape ? "shape" : ""}`}
              onClick={() => onToggle(id, option.value)}
              aria-label={label}
              title={label}
            >
              {isColor ? (
                <span className="marketColorSwatch" style={{ backgroundColor: option.hex }} aria-hidden="true" />
              ) : isShape ? (
                <ShapeIcon value={option.value} />
              ) : (
                option.iconKey
                  ? <FacetIcon iconKey={option.iconKey} />
                  : <span className={`marketCategoryCheck ${checked ? "checked" : ""}`} aria-hidden="true" />
              )}
              {!isColor && !isShape && <span>{label}</span>}
            </button>
          );
        })}
      </div>}
    </div>
  );
}

export function ModelCard({
  model,
  onNavigate,
  language = "vi",
  quickPreview = false,
  queryId = "",
  position = 0,
  behaviorSource = "other",
}) {
  const image = cover(model);
  const firstPreviewImage = previewImageSrc(model.previewImages?.[0]);
  const hasDistinctPreview = Boolean(firstPreviewImage && firstPreviewImage !== image);
  const href = modelPath(model);
  const detailApiPath = `/api/marketplace/${catalogSegment(model.assetType)}/${encodeURIComponent(model.slug)}?includeRecommendations=false`;
  const sizeLabel = model.sizeText || formatBytes(model.fileSize);
  const rendererLabel = model.renderer || model.renderers?.[0] || "-";
  const downloadCount = Number(model.downloadCount || 0).toLocaleString(language === "vi" ? "vi-VN" : "en-US");
  const cardRef = useRef(null);
  const previewRef = useRef(null);
  const openTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const impressionKeyRef = useRef("");
  const previewId = useId();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImageStage, setPreviewImageStage] = useState("primary");
  const [previewPosition, setPreviewPosition] = useState({
    top: -9999,
    left: -9999,
    placement: "right",
    ready: false,
  });
  const categoryTrail = [model.parentCategory, model.category]
    .map((category) => labelForCategory(category, language))
    .filter((label, index, labels) => label && labels.indexOf(label) === index);
  const categoryLabel = categoryTrail.join(" / ") || textFor(
    language,
    model.assetType === "scene" ? "Thư viện scene" : "Thư viện model",
    model.assetType === "scene" ? "Scene library" : "Model library",
  );
  const quickPreviewImage = previewImageStage === "missing"
    ? ""
    : previewImageStage === "fallback"
      ? image
      : firstPreviewImage || image;
  const prioritizeCover = position > 0 && position <= 6;

  const warmDetail = useCallback(() => {
    prefetchApi(detailApiPath);
  }, [detailApiPath]);

  const updatePreviewPosition = useCallback(() => {
    if (!cardRef.current || !previewRef.current) return;
    const anchor = cardRef.current.getBoundingClientRect();
    const popup = previewRef.current.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const edge = 12;
    const gap = 12;
    const leftSpace = anchor.left - edge - gap;
    const rightSpace = viewportWidth - anchor.right - edge - gap;
    const topSpace = anchor.top - edge - gap;
    const bottomSpace = viewportHeight - anchor.bottom - edge - gap;
    let placement;
    let top;
    let left;

    if (leftSpace >= popup.width || rightSpace >= popup.width) {
      placement = rightSpace >= leftSpace ? "right" : "left";
      left = placement === "right"
        ? anchor.right + gap
        : anchor.left - popup.width - gap;
      top = anchor.top + (anchor.height - popup.height) / 2;
    } else {
      placement = bottomSpace >= topSpace ? "bottom" : "top";
      top = placement === "bottom"
        ? anchor.bottom + gap
        : anchor.top - popup.height - gap;
      left = anchor.left + (anchor.width - popup.width) / 2;
    }

    left = Math.min(Math.max(edge, left), Math.max(edge, viewportWidth - popup.width - edge));
    top = Math.min(Math.max(edge, top), Math.max(edge, viewportHeight - popup.height - edge));
    setPreviewPosition({ top, left, placement, ready: true });
  }, []);

  const showPreview = useCallback(() => {
    warmDetail();
    if (!quickPreview) return;
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    window.clearTimeout(closeTimerRef.current);
    if (previewOpen || openTimerRef.current) return;
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      setPreviewOpen(true);
    }, 650);
  }, [previewOpen, quickPreview, warmDetail]);

  const hidePreview = useCallback(() => {
    window.clearTimeout(openTimerRef.current);
    openTimerRef.current = null;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      setPreviewOpen(false);
      setPreviewPosition((current) => ({ ...current, ready: false }));
    }, 90);
  }, []);

  useEffect(() => {
    setPreviewImageStage("primary");
  }, [firstPreviewImage, image, model._id]);

  useEffect(() => {
    if (!previewOpen) return undefined;
    const frame = window.requestAnimationFrame(updatePreviewPosition);
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(updatePreviewPosition)
      : null;
    if (cardRef.current) observer?.observe(cardRef.current);
    if (previewRef.current) observer?.observe(previewRef.current);
    window.addEventListener("resize", updatePreviewPosition);
    window.addEventListener("scroll", updatePreviewPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", updatePreviewPosition);
      window.removeEventListener("scroll", updatePreviewPosition, true);
    };
  }, [previewOpen, updatePreviewPosition]);

  useEffect(() => () => {
    window.clearTimeout(openTimerRef.current);
    window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    const card = cardRef.current;
    if (!card || typeof IntersectionObserver !== "function") return undefined;
    const impressionKey = [model._id, queryId || "browse", behaviorSource, position].join(":");
    if (impressionKeyRef.current === impressionKey) return undefined;
    let visibleTimer = null;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.5);
      window.clearTimeout(visibleTimer);
      visibleTimer = null;
      if (!visible || impressionKeyRef.current === impressionKey) return;
      visibleTimer = window.setTimeout(() => {
        impressionKeyRef.current = impressionKey;
        observer.disconnect();
        api("/api/marketplace/behavior", {
          method: "POST",
          body: JSON.stringify({
            modelId: model._id,
            assetType: model.assetType,
            eventType: "impression",
            queryId,
            position,
            source: behaviorSource,
          }),
        }).catch(() => {});
      }, 600);
    }, { threshold: [0.5] });
    observer.observe(card);
    return () => {
      window.clearTimeout(visibleTimer);
      observer.disconnect();
    };
  }, [behaviorSource, model._id, model.assetType, position, queryId]);

  return (
    <>
      <a
        ref={cardRef}
        className="marketModelCard"
        href={href}
        aria-describedby={quickPreview && previewOpen ? previewId : undefined}
        onMouseEnter={quickPreview ? showPreview : undefined}
        onMouseLeave={quickPreview ? hidePreview : undefined}
        onFocus={quickPreview ? showPreview : undefined}
        onBlur={quickPreview ? hidePreview : undefined}
        onPointerDown={warmDetail}
        onClick={(event) => {
          setPreviewOpen(false);
          if (!event.defaultPrevented && event.button === 0) {
            api("/api/marketplace/behavior", {
              method: "POST",
              body: JSON.stringify({
                modelId: model._id,
                assetType: model.assetType,
                eventType: "click",
                queryId,
                position,
                source: behaviorSource,
              }),
            }).catch(() => {});
          }
          navigateTo(href, onNavigate, event);
        }}
      >
        <div className="marketModelThumb">
          {image ? (
            <img
              src={image}
              alt={model.title}
              loading={prioritizeCover ? "eager" : "lazy"}
              fetchPriority={prioritizeCover ? "high" : "auto"}
              referrerPolicy="no-referrer"
            />
          ) : (
            <Package size={32} />
          )}
          <span className={`badge ${accessBadgeClass(model.accessType)}`}>{accessLabel(model.accessType)}</span>
          <span className="marketModelHoverMeta">
            <span className="marketModelHoverSize">{sizeLabel}</span>
            <span className="marketModelHoverRenderer">{rendererLabel}</span>
            <span
              className="marketModelHoverDownloads"
              aria-label={`${downloadCount} ${textFor(language, "lượt tải", "downloads")}`}
            >
              <Download size={13} aria-hidden="true" />
              <span>{downloadCount}</span>
            </span>
          </span>
        </div>
        <strong>{model.title}</strong>
      </a>
      {quickPreview && previewOpen && createPortal(
        <aside
          ref={previewRef}
          id={previewId}
          role="tooltip"
          className={`marketModelQuickPreview ${previewPosition.ready ? "ready" : ""}`}
          data-placement={previewPosition.placement}
          style={{ top: previewPosition.top, left: previewPosition.left }}
        >
          <div className="marketModelQuickPreviewImage">
            {quickPreviewImage ? (
              <img
                src={quickPreviewImage}
                alt=""
                referrerPolicy="no-referrer"
                onLoad={updatePreviewPosition}
                onError={() => {
                  setPreviewImageStage((current) => (
                    current === "primary" && hasDistinctPreview ? "fallback" : "missing"
                  ));
                }}
              />
            ) : (
              <span className="marketModelQuickPreviewPlaceholder" aria-hidden="true">
                <Package size={48} />
              </span>
            )}
          </div>
          <div className="marketModelQuickPreviewBody">
            <span className="marketModelQuickPreviewCategory">{categoryLabel}</span>
            <div className="marketModelQuickPreviewHeading">
              <strong>{model.title}</strong>
              <span className={`badge ${accessBadgeClass(model.accessType)}`}>
                {accessLabel(model.accessType)}
              </span>
            </div>
            <div className="marketModelQuickPreviewMeta">
              <span>
                <HardDrive size={15} aria-hidden="true" />
                <small>{textFor(language, "Dung lượng", "Size")}</small>
                <strong>{sizeLabel}</strong>
              </span>
              <span>
                <Sparkles size={15} aria-hidden="true" />
                <small>Renderer</small>
                <strong>{rendererLabel}</strong>
              </span>
              <span>
                <Download size={15} aria-hidden="true" />
                <small>{textFor(language, "Lượt tải", "Downloads")}</small>
                <strong>{downloadCount}</strong>
              </span>
            </div>
          </div>
        </aside>,
        document.body,
      )}
    </>
  );
}

function ModelPreview({ model, assetType = "model", language = "vi" }) {
  const images = useMemo(() => {
    const previews = (model.previewImages || [])
      .map((image) => ({ ...image, url: previewImageSrc(image) }))
      .filter((image) => image?.url);
    const coverImage = model.coverImage
      ? { ...model.coverImage, url: cover(model), isCoverFallback: true }
      : null;
    const candidates = [...previews, coverImage].filter(Boolean);
    return candidates.filter((image, index) => candidates.findIndex((item) => item.url === image.url) === index);
  }, [model]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageStates, setImageStates] = useState({});
  const openerRef = useRef(null);
  const lightboxRef = useRef(null);
  const activeImage = images[activeIndex] || null;
  const activeImageUrl = activeImage?.url || "";

  useEffect(() => {
    setActiveIndex(0);
    setLightboxOpen(false);
    setImageStates({});
  }, [model._id]);

  function setImageState(url, status) {
    if (!url) return;
    setImageStates((current) => current[url] === status ? current : { ...current, [url]: status });
  }

  useEffect(() => {
    if (!activeImageUrl || imageStates[activeImageUrl] !== "error" || images.length <= 1) return;
    const nextIndex = images.findIndex((image, index) => (
      index !== activeIndex && imageStates[image.url] !== "error"
    ));
    if (nextIndex >= 0) setActiveIndex(nextIndex);
  }, [activeImageUrl, activeIndex, imageStates, images]);

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const opener = openerRef.current;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => lightboxRef.current?.focus());

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setLightboxOpen(false);
        return;
      }
      if (images.length <= 1) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + images.length) % images.length);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % images.length);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      window.requestAnimationFrame(() => opener?.focus());
    };
  }, [images.length, lightboxOpen]);

  function moveImage(direction) {
    if (images.length <= 1) return;
    setActiveIndex((current) => (current + direction + images.length) % images.length);
  }

  const lightbox = lightboxOpen
    && activeImageUrl
    && imageStates[activeImageUrl] !== "error"
    && typeof document !== "undefined"
    ? createPortal(
      <div
        className="marketLightbox"
        role="dialog"
        aria-modal="true"
        aria-label={textFor(language, "Xem ảnh đầy đủ", "Full image viewer")}
        tabIndex={-1}
        ref={lightboxRef}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setLightboxOpen(false);
        }}
      >
        <button
          type="button"
          className="marketLightboxClose"
          onClick={() => setLightboxOpen(false)}
          aria-label={textFor(language, "Đóng ảnh", "Close image")}
          title={textFor(language, "Đóng ảnh", "Close image")}
        >
          <X size={22} />
        </button>
        <img
          src={activeImageUrl}
          alt={activeImage.alt || model.title}
          referrerPolicy="no-referrer"
        />
        {images.length > 1 && (
          <>
            <button
              type="button"
              className="marketLightboxNav previous"
              onClick={() => moveImage(-1)}
              aria-label={textFor(language, "Ảnh trước", "Previous image")}
            >
              <ChevronLeft size={28} />
            </button>
            <button
              type="button"
              className="marketLightboxNav next"
              onClick={() => moveImage(1)}
              aria-label={textFor(language, "Ảnh tiếp theo", "Next image")}
            >
              <ChevronRight size={28} />
            </button>
          </>
        )}
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <div
        className={`marketDetailMedia asset-${assetType} ${images.length > 1 ? "hasPreviews" : "single"}`}
      >
        {images.length > 1 && (
          <div className="marketPreviewStrip">
            {images.slice(0, 8).map((image, index) => {
              const src = image.url;
              if (!src) return null;
              return (
                <button
                  type="button"
                  key={`${src}-${index}`}
                  className={`${index === activeIndex ? "active" : ""} image-${imageStates[src] || "loading"}`}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`${textFor(language, "Ảnh xem trước", "Preview")} ${index + 1}`}
                >
                  <img
                    src={src}
                    alt={image.alt || model.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onLoad={() => setImageState(src, "loaded")}
                    onError={() => setImageState(src, "error")}
                  />
                </button>
              );
            })}
          </div>
        )}
        <div className={`marketDetailImage ${activeImageUrl ? "" : "empty"}`}>
          {activeImageUrl ? (
            <button
              ref={openerRef}
              type="button"
              className="marketDetailImageButton"
              style={assetType === "scene" ? {
                backgroundImage: `url(${JSON.stringify(activeImageUrl)})`,
              } : undefined}
              onClick={() => {
                if (imageStates[activeImageUrl] !== "error") setLightboxOpen(true);
              }}
              aria-label={textFor(language, "Mở ảnh đầy đủ", "Open full image")}
            >
              {imageStates[activeImageUrl] !== "loaded" && (
                <span className={`marketDetailImageStatus ${imageStates[activeImageUrl] === "error" ? "error" : "loading"}`} aria-hidden="true">
                  {imageStates[activeImageUrl] === "error" ? <Package size={34} /> : <Loader2 className="spin" size={28} />}
                </span>
              )}
              <img
                src={activeImageUrl}
                alt={activeImage.alt || model.title}
                referrerPolicy="no-referrer"
                style={{ opacity: imageStates[activeImageUrl] === "loaded" ? 1 : 0 }}
                onLoad={() => setImageState(activeImageUrl, "loaded")}
                onError={() => setImageState(activeImageUrl, "error")}
              />
            </button>
          ) : (
            <Package size={48} />
          )}
          {images.length > 1 && (
            <div className="marketGalleryControls">
              <button className="previous" type="button" onClick={() => moveImage(-1)} aria-label={textFor(language, "Ảnh trước", "Previous image")}><ChevronLeft size={22} /></button>
              <button className="next" type="button" onClick={() => moveImage(1)} aria-label={textFor(language, "Ảnh tiếp theo", "Next image")}><ChevronRight size={22} /></button>
            </div>
          )}
        </div>
      </div>
      {lightbox}
    </>
  );
}

function DetailFacetList({ facet, values = [], filterOptions = {}, language = "vi", fallback = "" }) {
  const normalizedValues = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!normalizedValues.length && !fallback) return <span className="marketMetaEmpty">-</span>;
  if (!normalizedValues.length) return <span className="marketDetailFacetText">{fallback}</span>;

  const options = filterOptions[facet] || [];
  return (
    <div className={`marketDetailFacetList ${facet}`}>
      {normalizedValues.map((value) => {
        const option = options.find((item) => item.value === value) || { value, label: value };
        const label = labelForFacet({ [facet]: options }, facet, value, language);
        return (
          <span className={`marketDetailFacetChip ${facet}`} key={`${facet}-${value}`} title={label}>
            {facet === "form" && <ShapeIcon value={value} />}
            {option.iconKey && !["form", "color"].includes(facet) && <FacetIcon iconKey={option.iconKey} />}
            {facet === "color" && (
              <i
                className="marketColorSwatch"
                style={{ backgroundColor: option.hex || value }}
                aria-hidden="true"
              />
            )}
            {!["form", "color"].includes(facet) && <span>{label}</span>}
          </span>
        );
      })}
    </div>
  );
}

function ModelMetaRow({ label, value, children }) {
  return (
    <div className="marketMetaRow">
      <span>{label}</span>
      <div className="marketMetaValue">
        {children || <strong>{value || "-"}</strong>}
      </div>
    </div>
  );
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function fileToSearchImageData(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("File phải là ảnh.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    const maxSize = 384;
    const ratio = Math.min(1, maxSize / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const width = Math.max(1, Math.round((image.naturalWidth || 1) * ratio));
    const height = Math.max(1, Math.round((image.naturalHeight || 1) * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);
    const imageData = canvas.toDataURL("image/jpeg", 0.68);
    return { imageData, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function imageSearchErrorMessage(message, language) {
  const value = String(message || "");
  if (language !== "vi") return value || "Image search failed.";
  if (value.includes("not configured") || value.includes("not available")) {
    return "Hệ thống tìm ảnh chưa được cấu hình.";
  }
  if (value.includes("Login is required")) return "Cần đăng nhập để tìm kiếm bằng hình ảnh.";
  if (value.includes("quota exceeded")) return "Bạn đã hết lượt tìm kiếm hình ảnh hôm nay.";
  if (value.includes("too large")) return "Ảnh tìm kiếm có dung lượng quá lớn.";
  if (value.includes("Invalid image")) return "Ảnh tìm kiếm không hợp lệ.";
  return value || "Không tìm kiếm được bằng hình ảnh.";
}

function ImageSearchDialog({
  open,
  assetType = "model",
  language,
  file,
  preview,
  searching,
  error,
  onSelectFile,
  onError,
  onSearch,
  onClose,
}) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    function handlePaste(event) {
      const item = Array.from(event.clipboardData?.items || [])
        .find((candidate) => candidate.type?.startsWith("image/"));
      const pastedFile = item?.getAsFile();
      if (!pastedFile) return;
      event.preventDefault();
      onSelectFile(new File(
        [pastedFile],
        pastedFile.name || `clipboard-${Date.now()}.png`,
        { type: pastedFile.type || "image/png" },
      ));
    }

    function handleKeyDown(event) {
      if (event.key === "Escape" && !searching) onClose();
    }

    document.addEventListener("paste", handlePaste);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, onSelectFile, open, searching]);

  if (!open) return null;

  async function readClipboardImage() {
    onError("");
    try {
      if (!navigator.clipboard?.read) throw new Error("Clipboard image reading is not available.");
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        onSelectFile(new File([blob], `clipboard-${Date.now()}.${imageType.split("/")[1] || "png"}`, { type: imageType }));
        return;
      }
      throw new Error("Clipboard does not contain an image.");
    } catch (clipboardError) {
      onError(language === "vi"
        ? "Không đọc được ảnh trong clipboard."
        : clipboardError.message || "Cannot read an image from the clipboard.");
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    const droppedFile = Array.from(event.dataTransfer?.files || [])
      .find((candidate) => candidate.type?.startsWith("image/"));
    if (droppedFile) onSelectFile(droppedFile);
  }

  return (
    <div
      className="marketImageSearchOverlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !searching) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="marketImageSearchDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-image-search-title"
        tabIndex={-1}
      >
        <header className="marketImageSearchDialogHeader">
          <h2 id="market-image-search-title">
            <ImagePlus size={20} />
            {assetType === "scene"
              ? textFor(language, "Tìm scene bằng ảnh", "Search scenes by image")
              : textFor(language, "Tìm model bằng ảnh", "Search models by image")}
          </h2>
          <button
            type="button"
            className="iconButton"
            onClick={onClose}
            disabled={searching}
            aria-label={language === "vi" ? "Đóng" : "Close"}
            title={language === "vi" ? "Đóng" : "Close"}
          >
            <X size={18} />
          </button>
        </header>

        <div
          className={`marketImageSearchDropzone ${preview ? "hasImage" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {preview ? (
            <img src={preview} alt={file?.name || "Image search preview"} />
          ) : (
            <ImageIcon size={42} />
          )}
        </div>

        {file && (
          <div className="marketImageSearchFileMeta">
            <strong>{file.name || (language === "vi" ? "Ảnh clipboard" : "Clipboard image")}</strong>
            <span>{Math.max(1, Math.ceil(Number(file.size || 0) / 1024)).toLocaleString(language === "vi" ? "vi-VN" : "en-US")} KB</span>
          </div>
        )}

        <div className="marketImageSearchActions">
          <button type="button" className="smallButton" onClick={() => inputRef.current?.click()} disabled={searching}>
            <Upload size={16} />
            {language === "vi" ? "Chọn ảnh" : "Choose image"}
          </button>
          <button type="button" className="smallButton" onClick={readClipboardImage} disabled={searching}>
            <ClipboardPaste size={16} />
            {language === "vi" ? "Dán ảnh" : "Paste image"}
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const selectedFile = event.target.files?.[0];
            event.target.value = "";
            if (selectedFile) onSelectFile(selectedFile);
          }}
        />

        {error && <p className="error marketImageSearchDialogError">{error}</p>}

        <footer className="marketImageSearchDialogFooter">
          <button type="button" className="smallButton" onClick={onClose} disabled={searching}>
            {language === "vi" ? "Hủy" : "Cancel"}
          </button>
          <button type="button" className="primaryButton" onClick={onSearch} disabled={!file || searching}>
            {searching ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            {searching
              ? (language === "vi" ? "Đang tìm..." : "Searching...")
              : textFor(language, `Tìm ${catalogNoun(assetType, "vi")}`, `Search ${catalogNoun(assetType, "en", true)}`)}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ModelListPage({ user, language, path, onNavigate, assetType = "model" }) {
  const segment = catalogSegment(assetType);
  const noun = catalogNoun(assetType, language);
  const [categories, setCategories] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [models, setModels] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [search, setSearch] = useState(() => searchFromPath(path, assetType));
  const [category, setCategory] = useState(() => categoryFromPath(path, assetType));
  const [openCategory, setOpenCategory] = useState("");
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);
  const [activeFilters, setActiveFilters] = useState(EMPTY_FILTERS);
  const [accessType, setAccessType] = useState("");
  const [sortMode, setSortMode] = useState(assetType === "model" ? "source_id_desc" : "");
  const [effectiveSort, setEffectiveSort] = useState(assetType === "model" ? "source_id_desc" : "newest");
  const [imageSearchMeta, setImageSearchMeta] = useState(null);
  const [imageSearchPreview, setImageSearchPreview] = useState("");
  const [imageSearching, setImageSearching] = useState(false);
  const [imageSearchOpen, setImageSearchOpen] = useState(false);
  const [imageSearchFile, setImageSearchFile] = useState(null);
  const [imageSearchDraftPreview, setImageSearchDraftPreview] = useState("");
  const [imageSearchDialogError, setImageSearchDialogError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [searchMeta, setSearchMeta] = useState({ queryId: "", correctedQuery: "", engine: "" });
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const listRequestIdRef = useRef(0);
  const listAbortRef = useRef(null);
  const suggestionAbortRef = useRef(null);
  const initializedCatalogRef = useRef("");
  const searchActiveRef = useRef(Boolean(search.trim()));

  const loadCategories = useCallback(async () => {
    const data = await apiCached(assetType === "scene" ? "/api/marketplace/scenes/categories" : "/api/marketplace/categories");
    setCategories(data.categories || []);
  }, [assetType]);

  const loadFilterOptions = useCallback(async () => {
    const data = await apiCached(assetType === "scene" ? "/api/marketplace/scenes/filters" : "/api/marketplace/filters");
    setFilterOptions(data.filters || {});
  }, [assetType]);

  function toggleFacetValue(facet, value) {
    setActiveFilters((current) => ({
      ...current,
      [facet]: toggleListValue(current[facet] || [], value),
    }));
  }

  function clearFacet(facet) {
    setActiveFilters((current) => ({
      ...current,
      [facet]: [],
    }));
  }

  const selectCategory = useCallback((nextCategory) => {
    const normalized = String(nextCategory || "");
    setCategory(normalized);
    const nextPath = normalized ? `/${segment}?category=${encodeURIComponent(normalized)}` : `/${segment}`;
    if (path !== nextPath) onNavigate?.(nextPath);
  }, [onNavigate, path, segment]);

  function clearAllFilters() {
    selectCategory("");
    setOpenCategory("");
    setActiveFilters(EMPTY_FILTERS);
    setAccessType("");
  }

  const applySearchSuggestion = useCallback((suggestion) => {
    if (suggestion.type === "category" && suggestion.categoryKey) {
      const matchedCategory = categories.find((categoryItem) => (
        String(categoryItem.sourceCategoryId || "") === String(suggestion.categoryKey)
        || String(categoryItem.slug || "") === String(suggestion.categoryKey)
      ));
      setSearch("");
      selectCategory(matchedCategory?.slug || suggestion.categoryKey);
    } else {
      setSearch(suggestion.value);
      rememberMarketplaceSearch(assetType, suggestion.value);
    }
    setSuggestionsOpen(false);
  }, [assetType, categories, selectCategory]);

  const loadModels = useCallback(async (page = 1, options = {}) => {
    const requestId = ++listRequestIdRef.current;
    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;
    const query = new URLSearchParams({ page: String(page), limit: "60" });
    if (search.trim()) query.set("q", search.trim());
    if (category) query.set("category", category);
    if (accessType) query.set("accessType", accessType);
    if (sortMode) query.set("sort", sortMode);
    Object.entries(activeFilters).forEach(([key, values]) => {
      if (values?.length) query.set(key, values.join(","));
    });
    setLoading(true);
    setError("");
    if (options.clearImage !== false) {
      setImageSearchMeta(null);
      setImageSearchPreview("");
    }
    try {
      const data = await api(`/api/marketplace/${segment}?${query.toString()}`, {
        signal: controller.signal,
      });
      if (requestId !== listRequestIdRef.current) return;
      setModels(data.assets || data.scenes || data.models || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
      setEffectiveSort(data.sort?.effective || (search.trim() ? "relevance" : "newest"));
      setSearchMeta({
        queryId: data.search?.queryId || "",
        correctedQuery: data.search?.correctedQuery || "",
        engine: data.search?.engine || "",
      });
    } catch (err) {
      if (err.name !== "AbortError" && requestId === listRequestIdRef.current) setError(err.message);
    } finally {
      if (requestId === listRequestIdRef.current) setLoading(false);
    }
  }, [accessType, activeFilters, category, search, segment, sortMode]);

  useEffect(() => () => {
    listAbortRef.current?.abort();
    suggestionAbortRef.current?.abort();
  }, []);

  async function searchByImage(file) {
    if (!user) {
      setImageSearchDialogError(language === "vi" ? "Cần đăng nhập để tìm kiếm bằng hình ảnh." : "Login is required for image search.");
      return false;
    }
    listRequestIdRef.current += 1;
    setImageSearching(true);
    setError("");
    setImageSearchDialogError("");
    try {
      const payload = await fileToSearchImageData(file);
      setImageSearchPreview(payload.imageData);
      const data = await api(assetType === "scene" ? "/api/marketplace/scenes/image-search" : "/api/marketplace/image-search", {
        method: "POST",
        body: JSON.stringify({
          imageData: payload.imageData,
          fileName: file.name,
          accessType,
          category,
          ...activeFilters,
          limit: 60,
        }),
      });
      setModels(data.assets || data.scenes || data.models || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
      setImageSearchMeta(data.imageSearch || null);
      setEffectiveSort("relevance");
      return true;
    } catch (err) {
      setImageSearchDialogError(imageSearchErrorMessage(err.message, language));
      return false;
    } finally {
      setImageSearching(false);
    }
  }

  function selectImageSearchFile(file) {
    setImageSearchDialogError("");
    if (!file?.type?.startsWith("image/")) {
      setImageSearchDialogError(language === "vi" ? "File phải là ảnh." : "The selected file must be an image.");
      return;
    }
    if (Number(file.size || 0) > 20 * 1024 * 1024) {
      setImageSearchDialogError(language === "vi" ? "Ảnh không được lớn hơn 20 MB." : "The image must not exceed 20 MB.");
      return;
    }
    setImageSearchFile(file);
    setImageSearchDraftPreview(URL.createObjectURL(file));
  }

  function closeImageSearchDialog() {
    if (imageSearching) return;
    setImageSearchOpen(false);
    setImageSearchFile(null);
    setImageSearchDraftPreview("");
    setImageSearchDialogError("");
  }

  async function submitImageSearch() {
    if (!imageSearchFile) return;
    const searched = await searchByImage(imageSearchFile);
    if (searched) closeImageSearchDialog();
  }

  useEffect(() => () => {
    if (imageSearchDraftPreview.startsWith("blob:")) URL.revokeObjectURL(imageSearchDraftPreview);
  }, [imageSearchDraftPreview]);

  useEffect(() => {
    loadCategories().catch(() => { });
    loadFilterOptions().catch(() => { });
  }, [loadCategories, loadFilterOptions]);

  useEffect(() => {
    const nextCategory = categoryFromPath(path, assetType);
    setCategory((current) => current === nextCategory ? current : nextCategory);
    const nextSearch = searchFromPath(path, assetType);
    setSearch((current) => current === nextSearch ? current : nextSearch);
  }, [path, assetType]);

  useEffect(() => {
    const active = search.trim().length >= 2;
    if (active === searchActiveRef.current) return;
    searchActiveRef.current = active;
    if (active) {
      setSortMode("relevance");
      setEffectiveSort("relevance");
    } else if (assetType === "model") {
      setSortMode("source_id_desc");
      setEffectiveSort("source_id_desc");
    } else {
      setSortMode("");
      setEffectiveSort("newest");
    }
  }, [assetType, search]);

  useEffect(() => {
    if (!category || openCategory) return;
    const parentSlug = parentSlugForCategory(categories, category);
    if (parentSlug) setOpenCategory(parentSlug);
  }, [categories, category, openCategory]);

  useEffect(() => {
    const isInitialCatalogLoad = initializedCatalogRef.current !== segment;
    initializedCatalogRef.current = segment;
    if (search.trim().length === 1) return undefined;
    const timer = window.setTimeout(() => {
      loadModels(1);
    }, isInitialCatalogLoad ? 0 : 150);
    return () => window.clearTimeout(timer);
  }, [loadModels, search, segment]);

  useEffect(() => {
    const q = search.trim();
    suggestionAbortRef.current?.abort();
    if (q.length < 2 || imageSearchMeta) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    suggestionAbortRef.current = controller;
    const timer = window.setTimeout(() => {
      const recent = marketplaceRecentSearches(assetType)
        .filter((value) => value.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 3)
        .map((value) => ({ type: "recent_query", value, label: value, assetType }));
      api(`/api/marketplace/search/suggestions?assetType=${assetType}&q=${encodeURIComponent(q)}&limit=8`, {
        signal: controller.signal,
      })
        .then((data) => {
          const combined = [...recent, ...(data.suggestions || [])]
            .filter((item, index, items) => items.findIndex((entry) => entry.value.toLowerCase() === item.value.toLowerCase()) === index)
            .slice(0, 8);
          setSuggestions(combined);
        })
        .catch((err) => {
          if (err.name !== "AbortError") setSuggestions([]);
        });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [assetType, imageSearchMeta, search]);

  const activeFilterCount = useMemo(
    () => Object.values(activeFilters).reduce((total, values) => total + (values?.length || 0), 0),
    [activeFilters],
  );
  const totalFilterCount = activeFilterCount + (category ? 1 : 0) + (accessType ? 1 : 0);
  const sortOptions = [
    ...(assetType === "model" ? [{
      value: "source_id_desc",
      vi: search.trim() || imageSearchMeta ? "ID lớn nhất" : "Phù hợp nhất",
      en: search.trim() || imageSearchMeta ? "Highest ID" : "Best match",
    }] : []),
    { value: "relevance", vi: "Phù hợp nhất", en: "Relevance" },
    { value: "newest", vi: "Mới nhất", en: "Newest" },
    { value: "popular", vi: "Tải nhiều nhất", en: "Most downloaded" },
    { value: "oldest", vi: "Cũ nhất", en: "Oldest" },
    { value: "title_asc", vi: "Tên A-Z", en: "Title A-Z" },
    { value: "title_desc", vi: "Tên Z-A", en: "Title Z-A" },
  ];
  const filterChips = useMemo(() => {
    const chips = [];
    if (category) {
      chips.push({
        key: `category:${category}`,
        label: labelForCategory(findCategoryBySlug(categories, category), language) || category,
        onRemove: () => selectCategory(""),
      });
    }
    if (accessType) {
      chips.push({
        key: `access:${accessType}`,
        label: accessType === "pro" ? "PRO" : "FREE",
        onRemove: () => setAccessType(""),
      });
    }
    Object.entries(activeFilters).forEach(([facet, values]) => {
      (values || []).forEach((value) => {
        chips.push({
          key: `${facet}:${value}`,
          label: labelForFacet(filterOptions, facet, value, language),
          onRemove: () => toggleFacetValue(facet, value),
        });
      });
    });
    return chips;
  }, [activeFilters, accessType, categories, category, filterOptions, language, selectCategory]);

  function goToPage(page) {
    const target = Math.min(Math.max(1, Number(page) || 1), Math.max(1, pagination.totalPages || 1));
    if (target === pagination.page || loading) return;
    loadModels(target).then(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  return (
    <>
      <div className="marketLayout">
      <aside className={`marketSidebar panel ${mobileFiltersOpen ? "mobileOpen" : ""}`}>
        <div className="marketSidebarHeading">
          <h2>
            <Filter size={20} />
            {textFor(language, "Bộ lọc", "Filters")}
            <span className={`marketFilterCount ${totalFilterCount ? "active" : ""}`}>{totalFilterCount}</span>
          </h2>
          <button
            type="button"
            className="marketMobileFilterToggle"
            onClick={() => setMobileFiltersOpen((current) => !current)}
            aria-expanded={mobileFiltersOpen}
            aria-label={textFor(language, mobileFiltersOpen ? "Thu gọn bộ lọc" : "Mở bộ lọc", mobileFiltersOpen ? "Collapse filters" : "Open filters")}
          >
            {mobileFiltersOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </button>
        </div>
        <div className="marketSidebarBody">
        <div className="marketSidebarActions">
          <button
            type="button"
            className={!totalFilterCount ? "active smallButton" : "smallButton"}
            onClick={clearAllFilters}
          >
            {language === "vi" ? "Tất cả" : "All"}
          </button>
          {totalFilterCount > 0 && (
            <button type="button" className="smallButton" onClick={clearAllFilters}>
              <X size={15} />
              {textFor(language, "Xóa", "Clear")}
            </button>
          )}
        </div>
        <div className={`marketFilterBlock ${category ? "hasSelection" : ""}`}>
          <div className="marketFilterBlockTitle">
            <button
              type="button"
              className="marketFilterCollapse"
              onClick={() => setCategoriesExpanded((value) => !value)}
              aria-expanded={categoriesExpanded}
            >
              <span>{textFor(language, "Danh mục", "Category")}</span>
              {categoriesExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {category && (
              <button
                type="button"
                className="marketFacetClear"
                onClick={() => selectCategory("")}
                aria-label={textFor(language, "Xóa danh mục", "Clear category")}
                title={textFor(language, "Xóa danh mục", "Clear category")}
              >
                <span>1</span>
                <X size={12} />
              </button>
            )}
          </div>
          {categoriesExpanded && <div className="marketCategoryList">
            {categories.map((item) => (
              <CategoryButton
                key={item._id || item.slug}
                category={item}
                selected={category}
                isOpen={openCategory === item.slug}
                onOpen={setOpenCategory}
                onSelect={selectCategory}
                language={language}
              />
            ))}
          </div>}
        </div>
        <div className="marketFilterBlock">
          <div className="marketFacetList">
            {Object.keys(FILTER_TITLES_EN).map((facet) => (
              <FacetSection
                key={facet}
                id={facet}
                title={(language === "vi" ? FILTER_TITLES_VI : FILTER_TITLES_EN)[facet]}
                options={filterOptions[facet] || []}
                values={activeFilters[facet] || []}
                onToggle={toggleFacetValue}
                onClear={clearFacet}
                language={language}
              />
            ))}
          </div>
        </div>
        </div>
      </aside>

      <section className="marketContent">
        <div className="panel marketSearchPanel">
          <div className="marketResultBar">
            <div className="marketResultSummary">
              <span>{loading && !models.length ? "..." : (pagination.total || 0)} {textFor(language, noun, `${noun} found`)}</span>
            </div>
            <label className="marketSearchField marketResultSearch">
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onFocus={() => setSuggestionsOpen(true)}
                onBlur={() => window.setTimeout(() => setSuggestionsOpen(false), 120)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    rememberMarketplaceSearch(assetType, search);
                    setSuggestionsOpen(false);
                  }
                }}
                placeholder={textFor(language, `Tìm kiếm ${noun}...`, `Search ${noun}...`)}
              />
              {IMAGE_SEARCH_ENABLED && <button
                type="button"
                className="marketImageSearchButton"
                disabled={imageSearching}
                onClick={() => {
                  setImageSearchDialogError("");
                  setImageSearchOpen(true);
                }}
                aria-label={language === "vi" ? "Tìm bằng hình ảnh" : "Search by image"}
                title={language === "vi" ? "Tìm bằng hình ảnh" : "Search by image"}
              >
                <ImagePlus size={17} />
              </button>}
              {suggestionsOpen && suggestions.length > 0 && (
                <div className="marketSearchSuggestions" role="listbox">
                  {suggestions.map((suggestion) => (
                    <button
                      type="button"
                      role="option"
                      key={`${suggestion.type}:${suggestion.value}:${suggestion.slug}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => applySearchSuggestion(suggestion)}
                    >
                      <Search size={14} />
                      <span>{suggestion.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </label>
            <div className="marketResultControls">
              <div className="marketAccessToggle" role="group" aria-label={textFor(language, "Lọc quyền tải", "Access filter")}>
                {["pro", "free"].map((value) => (
                  <button
                    type="button"
                    key={value}
                    className={accessType === value ? "active" : ""}
                    onClick={() => setAccessType(accessType === value ? "" : value)}
                  >
                    {value === "pro" ? "Pro" : "Free"}
                  </button>
                ))}
              </div>
              <label className="marketSortControl">
                <span>{textFor(language, "Sắp xếp", "Sort")}</span>
                <select
                  value={imageSearchMeta ? "relevance" : effectiveSort}
                  disabled={Boolean(imageSearchMeta)}
                  onChange={(event) => {
                    setSortMode(event.target.value);
                    setEffectiveSort(event.target.value);
                  }}
                >
                  {sortOptions
                    .filter((option) => option.value !== "relevance" || Boolean(search.trim() || imageSearchMeta))
                    .map((option) => (
                    <option key={option.value} value={option.value}>
                      {language === "vi" ? option.vi : option.en}
                    </option>
                    ))}
                </select>
                <ChevronDown size={15} aria-hidden="true" />
              </label>
            </div>
            {filterChips.length > 0 && (
              <div className="marketFilterChips marketResultChips">
                {filterChips.map((chip) => (
                  <button type="button" key={chip.key} className="marketFilterChip" onClick={chip.onRemove}>
                    {chip.label}
                    <X size={12} />
                  </button>
                ))}
                <button type="button" className="marketClearLink" onClick={clearAllFilters}>
                  {textFor(language, "Xóa bộ lọc", "Clear filters")}
                </button>
              </div>
            )}
          </div>
          {imageSearchMeta && (
            <div className="marketImageSearchMeta">
              {imageSearchPreview && <img src={imageSearchPreview} alt="Image search preview" />}
              <span>{language === "vi" ? "Kết quả tìm bằng hình ảnh" : "Image search results"}</span>
              <button type="button" className="smallButton" onClick={() => loadModels(1)}>
                <X size={15} />
                {textFor(language, "Xóa", "Clear")}
              </button>
            </div>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {loading && <p className="success marketLoadingStatus"><Loader2 size={15} className="spin" />{language === "vi" ? "Đang tải..." : "Loading..."}</p>}
        <div className="marketGrid">
            {models.map((model, index) => (
              <ModelCard
                key={model._id}
                model={model}
                onNavigate={onNavigate}
                language={language}
                quickPreview
                queryId={searchMeta.queryId}
                position={(pagination.page - 1) * 60 + index + 1}
                behaviorSource="search"
              />
            ))}
        </div>
        {!loading && !models.length && (
          <section className="panel emptyState">
            <p>{textFor(language, `Chưa có ${noun} phù hợp.`, `No matching ${noun} yet.`)}</p>
            {searchMeta.correctedQuery && (
              <button type="button" className="smallButton" onClick={() => setSearch(searchMeta.correctedQuery)}>
                {textFor(language, `Tìm “${searchMeta.correctedQuery}”`, `Search “${searchMeta.correctedQuery}”`)}
              </button>
            )}
            {suggestions.length > 0 && (
              <div className="marketEmptySuggestions" aria-label={textFor(language, "Gợi ý liên quan", "Related suggestions")}>
                {suggestions.slice(0, 3).map((suggestion) => (
                  <button
                    type="button"
                    className="smallButton"
                    key={`empty:${suggestion.type}:${suggestion.value}:${suggestion.slug}`}
                    onClick={() => applySearchSuggestion(suggestion)}
                  >
                    <Search size={14} />
                    {suggestion.label}
                  </button>
                ))}
              </div>
            )}
            {totalFilterCount > 0 && (
              <button type="button" className="smallButton" onClick={clearAllFilters}>
                <X size={15} />
                {textFor(language, "Xóa bộ lọc", "Clear filters")}
              </button>
            )}
          </section>
        )}
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onPageChange={goToPage}
          loading={loading}
          language={language}
          itemLabel={noun}
        />
        </section>
      </div>
      <ImageSearchDialog
        open={imageSearchOpen}
        assetType={assetType}
        language={language}
        file={imageSearchFile}
        preview={imageSearchDraftPreview}
        searching={imageSearching}
        error={imageSearchDialogError}
        onSelectFile={selectImageSearchFile}
        onError={setImageSearchDialogError}
        onSearch={submitImageSearch}
        onClose={closeImageSearchDialog}
      />
      <SiteFooter language={language} className="marketPageFooter" />
    </>
  );
}

function TurnstileDownloadGate({ siteKey, action, modelId, language, onVerified, onExpired }) {
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const callbacksRef = useRef({ onVerified, onExpired });
  const [widgetError, setWidgetError] = useState("");

  callbacksRef.current = { onVerified, onExpired };

  useEffect(() => {
    if (!siteKey || !containerRef.current) return undefined;
    let active = true;
    setWidgetError("");

    loadTurnstileScript()
      .then((turnstile) => {
        if (!active || !containerRef.current) return;
        widgetRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action: action || "marketplace_download",
          cData: String(modelId || "").slice(0, 255),
          theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
          size: "flexible",
          callback: (token) => callbacksRef.current.onVerified?.(token),
          "expired-callback": () => callbacksRef.current.onExpired?.(),
          "error-callback": () => setWidgetError(
            language === "vi" ? "Không thể xác minh. Vui lòng thử lại." : "Verification failed. Please try again.",
          ),
        });
      })
      .catch(() => {
        if (active) {
          setWidgetError(
            language === "vi" ? "Không tải được bộ xác minh. Vui lòng thử lại." : "Could not load verification. Please try again.",
          );
        }
      });

    return () => {
      active = false;
      if (widgetRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetRef.current);
      }
      widgetRef.current = null;
    };
  }, [siteKey, action, modelId, language]);

  return (
    <section className="marketDownloadVerifyGate" aria-live="polite">
      <div className="marketDownloadVerifyHeading">
        <ShieldCheck size={18} />
        <span>{language === "vi" ? "Đang xác minh để hiện nút tải" : "Verifying to show the download button"}</span>
      </div>
      <div className="marketDownloadTurnstile" ref={containerRef} />
      {widgetError && <p className="error">{widgetError}</p>}
    </section>
  );
}

function MarketplaceReportModal({
  assetType,
  error,
  language,
  message,
  reason,
  submitting,
  onClose,
  onMessageChange,
  onReasonChange,
  onSubmit,
}) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  const submittingRef = useRef(submitting);

  useEffect(() => {
    closeRef.current = onClose;
    submittingRef.current = submitting;
  }, [onClose, submitting]);

  useEffect(() => {
    const returnFocusTo = document.activeElement;
    function handleDialogKeys(event) {
      if (event.key === "Escape" && !submittingRef.current) {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        "button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]",
      ) || [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleDialogKeys);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleDialogKeys);
      document.body.style.overflow = previousOverflow;
      returnFocusTo?.focus?.();
    };
  }, []);

  const noun = assetType === "scene" ? "Scene" : "Model";

  return createPortal(
    <div
      className="marketReportOverlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onClose();
      }}
    >
      <section ref={dialogRef} className="marketReportDialog panel" role="dialog" aria-modal="true" aria-labelledby="market-report-title">
        <header>
          <div>
            <h2 id="market-report-title"><Flag size={19} /> {textFor(language, `Báo lỗi ${noun}`, `Report ${noun} issue`)}</h2>
            <p>{textFor(language, "Chọn đúng vấn đề để admin kiểm tra nhanh hơn.", "Choose the issue that best helps the administrator investigate.")}</p>
          </div>
          <button type="button" className="iconButton" onClick={onClose} disabled={submitting} aria-label={textFor(language, "Đóng", "Close")}>
            <X size={18} />
          </button>
        </header>
        <form onSubmit={onSubmit}>
          <label>
            <span>{textFor(language, "Loại lỗi", "Issue type")}</span>
            <select autoFocus value={reason} onChange={(event) => onReasonChange(event.target.value)} required>
              <option value="">{textFor(language, "Chọn loại lỗi", "Select an issue")}</option>
              {MARKETPLACE_REPORT_REASONS.map(([value, vi, en]) => (
                <option key={value} value={value}>{textFor(language, vi, en)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>
              {textFor(language, "Mô tả thêm", "Additional details")}
              {reason === "other" ? " *" : ""}
            </span>
            <textarea
              value={message}
              onChange={(event) => onMessageChange(event.target.value.slice(0, 1000))}
              maxLength={1000}
              rows={5}
              required={reason === "other"}
              placeholder={textFor(language, "Mô tả ngắn vấn đề bạn gặp phải...", "Briefly describe what went wrong...")}
            />
            <small>{message.length}/1000</small>
          </label>
          {error && <p className="error">{error}</p>}
          <footer>
            <button type="button" className="smallButton" onClick={onClose} disabled={submitting}>
              {textFor(language, "Hủy", "Cancel")}
            </button>
            <button type="submit" className="primaryButton" disabled={submitting || !reason || (reason === "other" && !message.trim())}>
              <Flag size={16} />
              {submitting
                ? textFor(language, "Đang gửi...", "Submitting...")
                : textFor(language, "Gửi báo lỗi", "Submit report")}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}

function ModelDetailPage({ slug, user, language, onNavigate, onUserChange, assetType = "model" }) {
  const segment = catalogSegment(assetType);
  const noun = catalogNoun(assetType, language);
  const [model, setModel] = useState(null);
  const [recommendedModels, setRecommendedModels] = useState([]);
  const [expandedRecommendations, setExpandedRecommendations] = useState([]);
  const [recommendationInfo, setRecommendationInfo] = useState({ total: 0, hasMore: false });
  const [recommendationsExpanded, setRecommendationsExpanded] = useState(false);
  const [initialRecommendationsLoading, setInitialRecommendationsLoading] = useState(false);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState("");
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [downloadProtection, setDownloadProtection] = useState({ enabled: false, siteKey: "", action: "" });
  const [turnstileToken, setTurnstileToken] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reported, setReported] = useState(false);
  const [reportError, setReportError] = useState("");
  const [shouldLoadRecommendations, setShouldLoadRecommendations] = useState(false);
  const recommendationSectionRef = useRef(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    setError("");
    setModel(null);
    setRecommendedModels([]);
    setExpandedRecommendations([]);
    setRecommendationInfo({ total: 0, hasMore: false });
    setRecommendationsExpanded(false);
    setInitialRecommendationsLoading(false);
    setShouldLoadRecommendations(false);
    setRecommendationsError("");
    setDownloadProtection({ enabled: false, siteKey: "", action: "" });
    setTurnstileToken("");
    const detailRequest = apiCached(`/api/marketplace/${segment}/${encodeURIComponent(slug)}?includeRecommendations=false`);
    detailRequest
      .then((data) => {
        if (!active) return;
        setModel(data.asset || data.scene || data.model || null);
        setDownloadProtection(data.downloadProtection || { enabled: false, siteKey: "", action: "" });
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    apiCached(assetType === "scene" ? "/api/marketplace/scenes/filters" : "/api/marketplace/filters")
      .then((filterData) => {
        if (active) setFilterOptions(filterData.filters || EMPTY_FILTERS);
      })
      .catch(() => {
        if (active) setFilterOptions(EMPTY_FILTERS);
      });

    return () => {
      active = false;
    };
  }, [slug, assetType, segment]);

  useEffect(() => {
    if (loading) return undefined;
    const target = recommendationSectionRef.current;
    if (!target || shouldLoadRecommendations) return undefined;
    if (typeof IntersectionObserver !== "function") {
      setShouldLoadRecommendations(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setShouldLoadRecommendations(true);
      observer.disconnect();
    }, { rootMargin: "700px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loading, model?._id, slug, shouldLoadRecommendations]);

  useEffect(() => {
    if (!model?._id || !shouldLoadRecommendations) return undefined;
    const controller = new AbortController();
    let active = true;
    setInitialRecommendationsLoading(true);
    setRecommendationsError("");
    api(`/api/marketplace/${segment}/${encodeURIComponent(model.slug || slug)}/recommendations?offset=0&limit=6`, {
      signal: controller.signal,
    })
      .then((data) => {
        if (!active) return;
        const items = data.assets || data.scenes || data.models || [];
        setRecommendedModels(items);
        setRecommendationInfo({
          total: data.pagination?.total ?? items.length,
          hasMore: Boolean(data.pagination?.hasMore),
          engine: data.discovery?.engine || "catalog_behavior_v3",
        });
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setRecommendationsError(err.message);
      })
      .finally(() => {
        if (active) setInitialRecommendationsLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [model?._id, model?.slug, segment, shouldLoadRecommendations, slug]);

  useEffect(() => {
    if (!model?._id) return undefined;
    const timer = window.setTimeout(() => {
      api("/api/marketplace/behavior", {
        method: "POST",
        body: JSON.stringify({
          assetId: model._id,
          assetType,
          eventType: "detail_view",
          source: "detail",
        }),
      }).catch(() => {});
    }, 1_000);
    return () => window.clearTimeout(timer);
  }, [assetType, model?._id]);

  useEffect(() => {
    let active = true;
    setReported(false);
    if (!user || !model?._id) return () => { active = false; };
    api(`/api/marketplace/${segment}/${model._id}/report-status`)
      .then((data) => {
        if (active) setReported(Boolean(data.reported));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [model?._id, segment, user]);

  async function toggleMoreRecommendations() {
    if (recommendationsExpanded) {
      setRecommendationsExpanded(false);
      return;
    }
    if (expandedRecommendations.length) {
      setRecommendationsExpanded(true);
      return;
    }
    setRecommendationsLoading(true);
    setRecommendationsError("");
    try {
      const data = await api(
        `/api/marketplace/${segment}/${encodeURIComponent(model?.slug || model?._id || slug)}/recommendations?offset=6&limit=54`,
      );
      setExpandedRecommendations(data.assets || data.scenes || data.models || []);
      setRecommendationInfo((current) => ({
        ...current,
        total: data.pagination?.total ?? current.total,
        hasMore: Boolean(data.pagination?.hasMore),
      }));
      setRecommendationsExpanded(true);
    } catch (err) {
      setRecommendationsError(err.message);
    } finally {
      setRecommendationsLoading(false);
    }
  }

  async function downloadModel() {
    if (!model) return;
    if (downloadProtection.enabled && !turnstileToken) {
      return;
    }
    setDownloading(true);
    setMessage("");
    setError("");
    try {
      const data = await api(`/api/marketplace/${segment}/${model._id}/download-session`, {
        method: "POST",
        body: JSON.stringify({ turnstileToken }),
      });
      setTurnstileToken("");
      setMessage(
        language === "vi"
          ? `Đã tạo phiên tải. Còn ${data.remaining ?? "-"} lượt hôm nay.`
          : `Download session created. ${data.remaining ?? "-"} downloads remaining today.`,
      );
      api("/api/auth/user")
        .then((current) => {
          if (current.user) onUserChange?.(current.user);
        })
        .catch(() => { });
      window.open(buildApiUrl(data.downloadUrl), "_blank", "noopener,noreferrer");
    } catch (err) {
      const quota = err.data?.details;
      if (err.code === "DOWNLOAD_QUOTA_EXCEEDED" && quota) {
        const resetAt = quota.resetAt ? new Date(quota.resetAt).toLocaleString(language === "vi" ? "vi-VN" : "en-US") : "-";
        setError(language === "vi"
          ? `Không đủ lượt tải: cần ${quota.required}, còn ${quota.remaining}. Hạn mức đặt lại lúc ${resetAt}.`
          : `Not enough downloads: ${quota.required} required, ${quota.remaining} remaining. Quota resets at ${resetAt}.`);
      } else {
        setError(err.message);
      }
      if (downloadProtection.enabled || String(err.code || "").startsWith("TURNSTILE_")) {
        setTurnstileToken("");
      }
    } finally {
      setDownloading(false);
    }
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!model || !user || reportSubmitting) return;
    setReportSubmitting(true);
    setReportError("");
    try {
      const data = await api(`/api/marketplace/${segment}/${model._id}/reports`, {
        method: "POST",
        body: JSON.stringify({
          reason: reportReason,
          message: reportMessage.trim(),
        }),
      });
      setReported(Boolean(data.reported));
      setReportOpen(false);
      setReportReason("");
      setReportMessage("");
      setMessage(textFor(language, "Đã gửi báo lỗi để admin kiểm tra.", "Your report was sent for administrator review."));
    } catch (err) {
      setReportError(err.message);
    } finally {
      setReportSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="panel emptyState">
        <p>{textFor(language, `Đang tải ${noun}...`, `Loading ${noun}...`)}</p>
      </section>
    );
  }

  if (!model) {
    return (
      <section className="panel emptyState">
        <button type="button" className="smallButton" onClick={() => navigateTo(`/${segment}`, onNavigate)}>
          <ArrowLeft size={16} />
          {assetType === "scene" ? textFor(language, "Scene", "Scenes") : textFor(language, "Model", "Models")}
        </button>
        <p className="error">{error || textFor(language, `Không tìm thấy ${noun}.`, `${assetType === "scene" ? "Scene" : "Model"} not found.`)}</p>
      </section>
    );
  }

  const fileReady = model.fileStatus === "ready";
  const isDemo = Boolean(model.isDemo);
  const requiresPro = model.accessType !== "free" && !user?.isPro;
  const canDownload = Boolean(user) && fileReady && !requiresPro && !isDemo;
  const requiresDownloadVerification = downloadProtection.enabled && !turnstileToken;
  const loginReturnTo = `/${segment}/${encodeURIComponent(model.slug || model._id || slug)}`;
  const loginHref = buildApiUrl(`/api/auth/google?returnTo=${encodeURIComponent(loginReturnTo)}`);
  const categoryLabel = modelCategoryLabel(model, language);
  const categoryTrail = [model.parentCategory, model.category]
    .filter((item) => item?.slug)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.slug === item.slug) === index);

  return (
    <div className={`marketDetailPage asset-${assetType}`}>
      <div className="marketDetailTopbar">
        <button type="button" className="marketBackButton" onClick={() => navigateTo(`/${segment}`, onNavigate)}>
          <ArrowLeft size={16} />
          {assetType === "scene" ? textFor(language, "Tất cả scene", "All scenes") : textFor(language, "Tất cả model", "All models")}
        </button>
        <nav className="marketDetailBreadcrumb" aria-label={textFor(language, "Danh mục model", "Model category")}>
          {categoryTrail.length ? categoryTrail.map((item, index) => {
            const href = `/${segment}?category=${encodeURIComponent(item.slug)}`;
            return (
              <React.Fragment key={item.slug}>
                {index > 0 && <span aria-hidden="true">/</span>}
                <a href={href} onClick={(event) => navigateTo(href, onNavigate, event)}>{labelForCategory(item, language)}</a>
              </React.Fragment>
            );
          }) : <span>{categoryLabel || (assetType === "scene" ? textFor(language, "Thư viện scene", "Scene library") : textFor(language, "Thư viện model", "Model library"))}</span>}
        </nav>
      </div>

      <section className="marketDetailHero">
        <ModelPreview model={model} assetType={assetType} language={language} />
        <aside className="marketDetailInfo panel">
          <div className="marketDetailBadges">
            {isDemo && <span className="badge">DEMO</span>}
            <span className={`badge ${accessBadgeClass(model.accessType)}`}>{accessLabel(model.accessType)}</span>
            <span className={`badge ${statusBadgeClass(model.fileStatus)}`}>
              {fileReady ? textFor(language, "Sẵn sàng", "Ready") : textFor(language, "Chưa sẵn sàng", "Not ready")}
            </span>
          </div>
          <h1>{model.title}</h1>
          <div className="marketDetailQuickFacts">
            <div><Sparkles size={17} /><span>Renderer</span><strong>{model.renderer || model.renderers?.[0] || "-"}</strong></div>
            <div><HardDrive size={17} /><span>{textFor(language, "Dung lượng", "Size")}</span><strong>{model.sizeText || formatBytes(model.fileSize)}</strong></div>
            <div><ShieldCheck size={17} /><span>{textFor(language, "Quyền tải", "Access")}</span><strong>{accessLabel(model.accessType).toUpperCase()}</strong></div>
            <div>
              <Download size={17} />
              <span>{textFor(language, "Lượt tải", "Downloads")}</span>
              <strong>{Number(model.downloadCount || 0).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</strong>
            </div>
          </div>

          <div className="marketDetailActions">
            <p className="marketQuotaCost">
              {assetType === "scene"
                ? textFor(language, "Mỗi lần tải Scene trừ 5 lượt.", "Each Scene download costs 5 downloads.")
                : textFor(language, "Mỗi lần tải Model trừ 1 lượt.", "Each Model download costs 1 download.")}
            </p>
            {requiresDownloadVerification ? (
              <TurnstileDownloadGate
                siteKey={downloadProtection.siteKey}
                action={downloadProtection.action}
                modelId={model._id}
                language={language}
                onVerified={setTurnstileToken}
                onExpired={() => setTurnstileToken("")}
              />
            ) : (
              <div className="marketDetailDownloadRow">
                {isDemo ? (
                  <button className="primaryButton" type="button" disabled>
                    <Package size={18} />
                    {assetType === "scene" ? textFor(language, "Scene mẫu giao diện", "Interface demo scene") : textFor(language, "Model mẫu giao diện", "Interface demo model")}
                  </button>
                ) : !user ? (
                  <a className="primaryButton" href={loginHref}>
                    <LogIn size={18} />
                    {textFor(language, "Đăng nhập để tải", "Sign in to download")}
                  </a>
                ) : requiresPro ? (
                  <button className="primaryButton" type="button" onClick={() => navigateTo("/topup?mode=pro", onNavigate)}>
                    <ShieldCheck size={18} />
                    {textFor(language, "Nâng cấp Pro để tải", "Upgrade to Pro")}
                  </button>
                ) : (
                  <button className="primaryButton" type="button" disabled={downloading || !canDownload} onClick={downloadModel}>
                    <Download size={18} />
                    {downloading ? textFor(language, "Đang tạo phiên tải...", "Creating download...") : textFor(language, `Tải ${noun}`, `Download ${noun}`)}
                  </button>
                )}
                {!user ? (
                  <a
                    className="iconButton marketReportIconButton"
                    href={loginHref}
                    aria-label={textFor(language, "Đăng nhập để báo lỗi", "Sign in to report")}
                    title={textFor(language, "Đăng nhập để báo lỗi", "Sign in to report")}
                  >
                    <Flag size={18} />
                  </a>
                ) : (
                  <button
                    className={`iconButton marketReportIconButton ${reported ? "reported" : ""}`}
                    type="button"
                    disabled={reported}
                    aria-label={reported
                      ? textFor(language, "Đã báo lỗi", "Issue reported")
                      : textFor(language, "Báo lỗi", "Report issue")}
                    title={reported
                      ? textFor(language, "Đã báo lỗi", "Issue reported")
                      : textFor(language, "Báo lỗi", "Report issue")}
                    onClick={() => {
                      setReportError("");
                      setReportOpen(true);
                    }}
                  >
                    {reported ? <CheckCircle2 size={18} /> : <Flag size={18} />}
                  </button>
                )}
              </div>
            )}
          </div>

          {!fileReady && (
            <p className="error">
              {textFor(language, `${assetType === "scene" ? "Scene" : "Model"} này chưa có file sẵn sàng tải.`, `This ${noun} does not have a ready file yet.`)}
            </p>
          )}
          {message && <p className="success">{message}</p>}
          {error && <p className="error">{error}</p>}

          <div className="marketDetailMeta">
            <ModelMetaRow label="Renderer">
              <DetailFacetList
                facet="render"
                values={model.renderers}
                filterOptions={filterOptions}
                language={language}
                fallback={model.renderer}
              />
            </ModelMetaRow>
            <ModelMetaRow label={textFor(language, "Phong cách", "Style")}>
              <DetailFacetList facet="style" values={model.styles} filterOptions={filterOptions} language={language} />
            </ModelMetaRow>
            {assetType === "scene" && <ModelMetaRow label={textFor(language, "Nền tảng", "Platform")}>
              <DetailFacetList facet="platform" values={model.platforms} filterOptions={filterOptions} language={language} />
            </ModelMetaRow>}
            {assetType !== "scene" && <ModelMetaRow label={textFor(language, "Hình dạng", "Form")}>
              <DetailFacetList facet="form" values={model.forms} filterOptions={filterOptions} language={language} />
            </ModelMetaRow>}
            {assetType !== "scene" && <ModelMetaRow label={textFor(language, "Màu sắc", "Color")}>
              <DetailFacetList facet="color" values={model.colors} filterOptions={filterOptions} language={language} />
            </ModelMetaRow>}
            {assetType !== "scene" && <ModelMetaRow label={textFor(language, "Vật liệu", "Material")}>
              <DetailFacetList facet="material" values={model.materials} filterOptions={filterOptions} language={language} />
            </ModelMetaRow>}
          </div>
        </aside>
      </section>

      {reportOpen && (
        <MarketplaceReportModal
          assetType={assetType}
          error={reportError}
          language={language}
          message={reportMessage}
          reason={reportReason}
          submitting={reportSubmitting}
          onClose={() => setReportOpen(false)}
          onMessageChange={setReportMessage}
          onReasonChange={setReportReason}
          onSubmit={submitReport}
        />
      )}

      <section ref={recommendationSectionRef} className="marketRecommendations">
        <div className="marketSectionHeader">
          <div>
            <h2>{assetType === "scene" ? textFor(language, "Scene đề xuất", "Recommended scenes") : textFor(language, "Model đề xuất", "Recommended models")}</h2>
            <p>{textFor(language, `Các ${noun} có mức độ liên quan cao nhất.`, `The most relevant related ${catalogNoun(assetType, "en", true)}.`)}</p>
          </div>
        </div>
        {!shouldLoadRecommendations ? (
          <div className="marketRecommendationDeferred" aria-hidden="true" />
        ) : initialRecommendationsLoading ? (
          <section className="panel emptyState">
            <Loader2 className="spin" size={18} />
            <p>{textFor(language, "Đang tải đề xuất...", "Loading recommendations...")}</p>
          </section>
        ) : recommendedModels.length > 0 ? (
          <>
            <div className="marketRecommendationInitialGrid">
              {recommendedModels.slice(0, 6).map((item) => (
                <ModelCard
                  key={item._id}
                  model={item}
                  onNavigate={onNavigate}
                  language={language}
                  quickPreview
                  behaviorSource="detail"
                />
              ))}
            </div>
            {recommendationsExpanded && expandedRecommendations.length > 0 && (
              <div className="marketRecommendationExpandedGrid">
                {expandedRecommendations.map((item) => (
                  <ModelCard
                    key={item._id}
                    model={item}
                    onNavigate={onNavigate}
                    language={language}
                    quickPreview
                    behaviorSource="detail"
                  />
                ))}
              </div>
            )}
            {(recommendationInfo.hasMore || expandedRecommendations.length > 0) && (
              <button
                type="button"
                className="marketRecommendationToggle"
                disabled={recommendationsLoading}
                onClick={toggleMoreRecommendations}
                aria-expanded={recommendationsExpanded}
              >
                {recommendationsLoading ? <Loader2 className="spin" size={16} /> : recommendationsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                {recommendationsLoading
                  ? textFor(language, "Đang tải đề xuất...", "Loading recommendations...")
                  : recommendationsExpanded
                    ? textFor(language, "Thu gọn", "Show less")
                    : textFor(language, "Xem thêm", "Show more")}
              </button>
            )}
            {recommendationsError && <p className="error marketRecommendationError">{recommendationsError}</p>}
          </>
        ) : (
          <section className="panel emptyState">
            <p>{textFor(language, `Chưa có ${noun} đề xuất.`, "No recommendations yet.")}</p>
          </section>
        )}
      </section>
      <SiteFooter language={language} className="marketDetailFooter" />
    </div>
  );
}

export default function Models({ user, language = "vi", path = "/models", onNavigate, onUserChange, assetType = "model" }) {
  const slug = detailSlugFromPath(path, assetType);
  if (slug) {
    return <ModelDetailPage slug={slug} user={user} language={language} onNavigate={onNavigate} onUserChange={onUserChange} assetType={assetType} />;
  }
  return <ModelListPage user={user} language={language} path={path} onNavigate={onNavigate} assetType={assetType} />;
}
