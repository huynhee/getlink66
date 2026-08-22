import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Flag,
  GitCompareArrows,
  ImageOff,
  ListChecks,
  Maximize2,
  Package,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Square,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { api, apiBinary, buildApiUrl } from "../api.js";
import Pagination from "./Pagination.jsx";
import AdminMarketplaceTaxonomy from "./AdminMarketplaceTaxonomy.jsx";
import { text } from "../i18n.js";

const emptyDriveImportForm = {
  rootFolderId: "",
  pageToken: "",
  limit: "100",
  accessType: "member",
  isPublished: true,
};

const missingLabels = {
  category: "Danh mục",
  style: "Phong cách",
  render: "Render",
  form: "Hình dạng",
  color: "Màu sắc",
  material: "Vật liệu",
};

const fileStatusLabels = {
  all: "Tất cả file",
  missing: "Thiếu file",
  pending_upload: "Chờ upload",
  ready: "Sẵn sàng",
  failed: "Lỗi file",
};

const accessLabels = {
  all: "Tất cả quyền",
  free: "Free",
  member: "Pro",
};

const reportReasonLabels = {
  download_failed: ["Không tải được", "Download failed"],
  archive_corrupt: ["File nén bị lỗi", "Corrupt archive"],
  wrong_asset: ["Sai model hoặc scene", "Wrong asset"],
  missing_files: ["Thiếu file hoặc tài nguyên", "Missing files or assets"],
  preview_incorrect: ["Ảnh preview không đúng", "Incorrect preview"],
  metadata_incorrect: ["Thông tin không chính xác", "Incorrect information"],
  duplicate: ["Tài nguyên bị trùng", "Duplicate asset"],
  other: ["Lỗi khác", "Other issue"],
};

const reportStatusLabels = {
  open: ["Mới", "Open"],
  investigating: ["Đang kiểm tra", "Investigating"],
  resolved: ["Đã xử lý", "Resolved"],
  dismissed: ["Bỏ qua", "Dismissed"],
};

const _publishLabels = {
  all: "Tất cả publish",
  published: "Đã xuất bản",
  unpublished: "Bản nháp",
};

const facetTitles = {
  styles: "Phong cách",
  renderers: "Render",
  forms: "Hình dạng",
  colors: "Màu sắc",
  materials: "Vật liệu",
  platforms: "Nền tảng",
};

const facetOptionMap = {
  styles: "style",
  renderers: "render",
  forms: "form",
  colors: "color",
  materials: "material",
  platforms: "platform",
};

const facetLabelsVi = {
  classic: "Cổ điển",
  modern: "Hiện đại",
  ethnic: "Truyền thống",
  industrial: "Công nghiệp",
  neoclassic: "Tân cổ điển",
  luxury: "Sang trọng",
  indochine: "Đông Dương",
  japanese: "Nhật Bản",
  "wabi-sabi": "Wabi-sabi",
  french: "Phong cách Pháp",
  "modern-classic": "Cổ điển hiện đại",
  other: "Khác",
  vray: "Vray",
  corona: "Corona",
  standard: "Standard",
  round: "Tròn",
  oval: "Bầu dục",
  square: "Vuông",
  rectangle: "Chữ nhật",
  triangle: "Tam giác",
  diamond: "Hình thoi",
  pentagon: "Ngũ giác",
  star: "Ngôi sao",
  angle: "Angle",
  bioform: "Bioform",
  white: "Trắng",
  gray: "Xám",
  black: "Đen",
  brown: "Nâu",
  red: "Đỏ",
  orange: "Cam",
  yellow: "Vàng",
  beige: "Be",
  pink: "Hồng",
  magenta: "Tím hồng",
  purple: "Tím",
  blue: "Xanh dương",
  sky: "Xanh trời",
  cyan: "Xanh ngọc",
  lime: "Xanh lá sáng",
  green: "Xanh lá",
  brick: "Gạch",
  ceramics: "Gốm sứ",
  concrete: "Bê tông",
  fabric: "Vải",
  fur: "Lông",
  glass: "Kính",
  gypsum: "Thạch cao",
  leather: "Da",
  liquid: "Chất lỏng",
  metal: "Kim loại",
  organics: "Hữu cơ",
  paper: "Giấy",
  plastic: "Nhựa",
  rattan: "Mây tre",
  stone: "Đá",
  wood: "Gỗ",
};

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return "-";
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(size / 1024)} KB`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN");
}

function statusClass(value) {
  if (["ready", "complete", "published", "online", "used"].includes(value)) return "success";
  if (["failed", "incomplete", "unpublished", "draft", "expired", "revoked", "delete_error", "purge_error"].includes(value)) return "error";
  return "pending";
}

function accessControlValue(value) {
  return value === "free" ? "free" : "member";
}

function csvToValues(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function valuesToCsv(values = []) {
  return [...new Set(values.filter(Boolean))].join(", ");
}

function optionLabel(option, language = "vi") {
  if (language === "en") return option.labelEn || option.label || option.value;
  return option.labelVi || facetLabelsVi[option.value] || option.label || option.value;
}

function categoryValue(category = {}) {
  return String(category.sourceCategoryId || category.slug || category._id || "");
}

function categoryLabel(category = {}, language = "vi") {
  if (language === "en") return category.titleEn || category.title || category.slug || categoryValue(category);
  return category.title || category.titleEn || category.slug || categoryValue(category);
}

function findCategoryPath(categories = [], value = "", parents = []) {
  const normalized = String(value || "");
  if (!normalized) return [];
  for (const category of categories) {
    const currentPath = [...parents, category];
    const matches = [category.sourceCategoryId, category.slug, category._id]
      .map((item) => String(item || ""))
      .includes(normalized);
    if (matches) return currentPath;
    const childPath = findCategoryPath(category.children || [], normalized, currentPath);
    if (childPath.length) return childPath;
  }
  return [];
}

function findCategoryByValue(categories = [], value = "") {
  return findCategoryPath(categories, value).at(-1) || null;
}

function categoryHasChildren(categories = [], value = "") {
  const category = findCategoryByValue(categories, value);
  return Boolean(category?.children?.length);
}

function publicState(model) {
  if (!model.isPublished) return { key: "draft", label: "Bản nháp" };
  if (model.metadataStatus !== "complete") return { key: "incomplete", label: "Thiếu metadata" };
  if (model.fileStatus !== "ready") return { key: "pending", label: "Thiếu file" };
  return { key: "online", label: "Đang online" };
}

function KpiCard({ icon: Icon, label, value, tone = "" }) {
  return (
    <div className={`marketAdminKpi ${tone}`}>
      <Icon size={18} />
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function ModelFact({ label, value, detail }) {
  return (
    <div className="marketAdminFact">
      <span>{label}</span>
      <strong>{value || "-"}</strong>
      {detail && <span className="marketAdminFactDetail">{detail}</span>}
    </div>
  );
}

function formatTimeRemaining(value, language = "vi") {
  const time = new Date(value).getTime();
  if (!value || !Number.isFinite(time)) return "-";
  const remaining = time - Date.now();
  if (remaining <= 0) return text(language, "Đến hạn xóa", "Due for deletion");
  const hours = Math.ceil(remaining / (60 * 60 * 1000));
  if (hours < 24) return text(language, `Còn ${hours} giờ`, `${hours} hours left`);
  const days = Math.ceil(hours / 24);
  return text(language, `Còn ${days} ngày`, `${days} days left`);
}

function AdminCover({ model, adminAssetBase, language = "vi" }) {
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(model.coverImage?.driveFileId || model.previewImages?.[0]?.driveFileId);
  if (!hasImage || failed || model.deletionStatus === "purged") {
    return <div className="marketAdminModelCover placeholder"><ImageOff size={20} /><span>{text(language, "Thiếu ảnh", "No image")}</span></div>;
  }
  return (
    <div className="marketAdminModelCover">
      <img
        crossOrigin="use-credentials"
        src={buildApiUrl(`${adminAssetBase}/${model._id}/cover?v=${encodeURIComponent(model.coverImage?.driveVersion || model.coverImage?.modifiedTime || "0")}`)}
        alt={model.title || "Cover"}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

function AdminPreviewGallery({ model, adminAssetBase, language = "vi" }) {
  const images = useMemo(() => {
    const refs = [];
    const seen = new Set();
    if (model.coverImage?.driveFileId) {
      seen.add(model.coverImage.driveFileId);
      refs.push({ key: `cover-${model.coverImage.driveFileId}`, label: text(language, "Ảnh cover", "Cover"), url: `${adminAssetBase}/${model._id}/cover?v=${encodeURIComponent(model.coverImage.driveVersion || model.coverImage.modifiedTime || "0")}` });
    }
    (model.previewImages || []).forEach((image, index) => {
      if (!image?.driveFileId || seen.has(image.driveFileId)) return;
      seen.add(image.driveFileId);
      refs.push({ key: image.driveFileId, label: `${text(language, "Ảnh", "Preview")} ${index + 1}`, url: `${adminAssetBase}/${model._id}/preview/${index}?v=${encodeURIComponent(image.driveVersion || image.modifiedTime || "0")}` });
    });
    return refs;
  }, [adminAssetBase, language, model]);
  const [selected, setSelected] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const expandButtonRef = useRef(null);

  useEffect(() => {
    setSelected(0);
    setLightboxOpen(false);
  }, [model._id]);

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const returnFocusTo = expandButtonRef.current;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setLightboxOpen(false);
      if (event.key === "ArrowLeft") setSelected((current) => (current - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") setSelected((current) => (current + 1) % images.length);
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.classList.add("modalOpen");
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("modalOpen");
      returnFocusTo?.focus();
    };
  }, [images.length, lightboxOpen]);

  if (!images.length) {
    return <div className="marketAdminGalleryEmpty"><ImageOff size={28} /><span>{text(language, "Model chưa có cover hoặc preview.", "This asset has no cover or preview images.")}</span></div>;
  }
  const current = images[Math.min(selected, images.length - 1)];
  const move = (direction) => setSelected((selected + direction + images.length) % images.length);
  return (
    <section className="marketAdminGallery" aria-label={text(language, "Ảnh model", "Asset images")}>
      <div className="marketAdminGalleryMain">
        <img crossOrigin="use-credentials" src={buildApiUrl(current.url)} alt={`${model.title} - ${current.label}`} />
        <button ref={expandButtonRef} type="button" className="iconButton marketAdminGalleryExpand" onClick={() => setLightboxOpen(true)} title={text(language, "Xem ảnh đầy đủ", "View full image")}>
          <Maximize2 size={17} />
        </button>
        {images.length > 1 && (
          <div className="marketAdminGalleryNav">
            <button type="button" className="iconButton" onClick={() => move(-1)} aria-label={text(language, "Ảnh trước", "Previous image")}><ChevronLeft size={18} /></button>
            <button type="button" className="iconButton" onClick={() => move(1)} aria-label={text(language, "Ảnh sau", "Next image")}><ChevronRight size={18} /></button>
          </div>
        )}
      </div>
      <div className="marketAdminGalleryThumbs">
        {images.map((image, index) => (
          <button type="button" key={image.key} className={index === selected ? "active" : ""} onClick={() => setSelected(index)} title={image.label}>
            <img crossOrigin="use-credentials" src={buildApiUrl(image.url)} alt={image.label} loading="lazy" />
          </button>
        ))}
      </div>
      {lightboxOpen && (
        <div className="marketAdminLightbox" role="dialog" aria-modal="true" aria-label={text(language, "Xem ảnh đầy đủ", "Full image preview")} onMouseDown={(event) => event.target === event.currentTarget && setLightboxOpen(false)}>
          <button autoFocus type="button" className="iconButton marketAdminLightboxClose" onClick={() => setLightboxOpen(false)} aria-label={text(language, "Đóng", "Close")}><X size={20} /></button>
          {images.length > 1 && <button type="button" className="iconButton previous" onClick={() => move(-1)} aria-label={text(language, "Ảnh trước", "Previous image")}><ChevronLeft size={22} /></button>}
          <img crossOrigin="use-credentials" src={buildApiUrl(current.url)} alt={`${model.title} - ${current.label}`} />
          {images.length > 1 && <button type="button" className="iconButton next" onClick={() => move(1)} aria-label={text(language, "Ảnh sau", "Next image")}><ChevronRight size={22} /></button>}
        </div>
      )}
    </section>
  );
}

function AdminImageManager({
  model,
  adminAssetBase,
  language = "vi",
  busy = false,
  onUpload,
  onReorder,
  onDelete,
  onSetCover,
}) {
  const [ordered, setOrdered] = useState(model.previewImages || []);
  const [draggedId, setDraggedId] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const originalIds = useMemo(
    () => (model.previewImages || []).map((image) => image.driveFileId).filter(Boolean),
    [model.previewImages],
  );
  const orderedIds = ordered.map((image) => image.driveFileId).filter(Boolean);
  const orderChanged = orderedIds.join("|") !== originalIds.join("|");

  useEffect(() => {
    setOrdered(model.previewImages || []);
    setDeleteTarget(null);
  }, [model._id, model.previewImages]);

  function moveImage(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= ordered.length || fromIndex === toIndex) return;
    setOrdered((current) => {
      const next = [...current];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
  }

  function sourceIndex(image) {
    return (model.previewImages || []).findIndex((item) => item.driveFileId === image.driveFileId);
  }

  return (
    <section className="marketAdminEditSection marketAdminImageManager">
      <EditSectionTitle icon={UploadCloud} title={text(language, "Ảnh cover và preview", "Cover and preview images")} />
      <div className="marketAdminImageToolbar">
        <label className={`smallButton ${busy ? "disabled" : ""}`}>
          <UploadCloud size={16} /> {text(language, "Tải cover", "Upload cover")}
          <input
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload("cover", [file]);
              event.target.value = "";
            }}
          />
        </label>
        <label className={`smallButton ${busy || ordered.length >= 20 ? "disabled" : ""}`}>
          <UploadCloud size={16} /> {text(language, "Thêm preview", "Add previews")}
          <input
            type="file"
            accept=".jpg,.jpeg,.png,image/jpeg,image/png"
            multiple
            disabled={busy || ordered.length >= 20}
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              if (files.length) onUpload("preview", files);
              event.target.value = "";
            }}
          />
        </label>
        <span>{ordered.length}/20 preview</span>
      </div>

      <div className="marketAdminPreviewOrderList">
        {ordered.map((image, index) => {
          const currentIndex = sourceIndex(image);
          const version = encodeURIComponent(image.driveVersion || image.modifiedTime || "0");
          return (
            <article
              key={image.driveFileId}
              draggable={!busy}
              className={draggedId === image.driveFileId ? "dragging" : ""}
              onDragStart={() => setDraggedId(image.driveFileId)}
              onDragEnd={() => setDraggedId("")}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                const fromIndex = ordered.findIndex((item) => item.driveFileId === draggedId);
                moveImage(fromIndex, index);
                setDraggedId("");
              }}
            >
              <GripVertical size={17} aria-hidden="true" />
              <img
                crossOrigin="use-credentials"
                src={buildApiUrl(`${adminAssetBase}/${model._id}/preview/${currentIndex}?v=${version}`)}
                alt={`${model.title} - preview ${index + 1}`}
                loading="lazy"
              />
              <div>
                <strong>Preview {index + 1}</strong>
                <span>{image.fileName || "preview"}</span>
                <small>{image.width && image.height ? `${image.width} × ${image.height} · ` : ""}{formatBytes(image.size)}</small>
              </div>
              <div className="marketAdminPreviewActions">
                <button type="button" className="iconButton" disabled={busy || index === 0} onClick={() => moveImage(index, index - 1)} title={text(language, "Đưa lên", "Move up")}><ArrowUp size={15} /></button>
                <button type="button" className="iconButton" disabled={busy || index === ordered.length - 1} onClick={() => moveImage(index, index + 1)} title={text(language, "Đưa xuống", "Move down")}><ArrowDown size={15} /></button>
                <button type="button" className="smallButton" disabled={busy} onClick={() => onSetCover(currentIndex)} title={text(language, "Dùng ảnh này làm cover", "Use this image as cover")}>
                  <Square size={14} /> {text(language, "Đặt cover", "Set cover")}
                </button>
                <button type="button" className="iconButton danger" disabled={busy} onClick={() => setDeleteTarget({ image, currentIndex })} title={text(language, "Xóa preview", "Delete preview")}><Trash2 size={15} /></button>
              </div>
            </article>
          );
        })}
        {!ordered.length && <p className="muted">{text(language, "Chưa có ảnh preview.", "No preview images yet.")}</p>}
      </div>

      {orderChanged && (
        <div className="marketAdminSyncActions">
          <button type="button" className="smallButton" disabled={busy} onClick={() => setOrdered(model.previewImages || [])}>
            <RotateCcw size={15} /> {text(language, "Hoàn tác thứ tự", "Reset order")}
          </button>
          <button type="button" className="primaryButton" disabled={busy} onClick={() => onReorder(orderedIds)}>
            <Save size={15} /> {text(language, "Lưu thứ tự preview", "Save preview order")}
          </button>
        </div>
      )}

      {deleteTarget && (
        <div className="marketAdminImageDeleteConfirm">
          <span>{text(language, `Xóa ${deleteTarget.image.fileName || "preview"} khỏi Drive?`, `Delete ${deleteTarget.image.fileName || "preview"} from Drive?`)}</span>
          <button type="button" className="smallButton" disabled={busy} onClick={() => setDeleteTarget(null)}>{text(language, "Hủy", "Cancel")}</button>
          <button type="button" className="smallButton danger" disabled={busy} onClick={() => onDelete(deleteTarget.currentIndex).then((deleted) => deleted && setDeleteTarget(null))}>
            <Trash2 size={15} /> {text(language, "Xóa ảnh", "Delete image")}
          </button>
        </div>
      )}
    </section>
  );
}

function MissingFields({ fields = [], language = "vi" }) {
  if (!fields.length) return null;
  return (
    <div className="marketAdminMissing">
      <AlertTriangle size={15} />
      <strong>{text(language, "Thiếu dữ liệu:", "Missing data:")}</strong>
      {fields.map((field) => <span key={field}>{language === "en" ? field : (missingLabels[field] || field)}</span>)}
    </div>
  );
}

function EditSectionTitle({ icon: Icon, title }) {
  return (
    <div className="marketAdminSectionTitle">
      <h4><Icon size={16} /> {title}</h4>
    </div>
  );
}

function CategorySelect({ value, categories = [], onChange, language = "vi" }) {
  const path = findCategoryPath(categories, value);
  const parentValue = path[0] ? categoryValue(path[0]) : "";
  const selectedParent = categories.find((category) => categoryValue(category) === parentValue) || null;
  const children = selectedParent?.children || [];
  const selectedChildValue = path.length > 1 ? categoryValue(path[1]) : "";

  function handleParentChange(nextValue) {
    const nextParent = categories.find((category) => categoryValue(category) === nextValue);
    onChange(nextParent?.children?.length ? nextValue : nextValue);
  }

  return (
    <div className="marketAdminCategoryPicker">
      <label>
        <span>{text(language, "Danh mục mẹ", "Parent category")}</span>
        <select value={parentValue} onChange={(event) => handleParentChange(event.target.value)}>
          <option value="">{text(language, "Chọn danh mục mẹ", "Select parent category")}</option>
          {categories.map((category) => (
            <option key={category._id || category.slug} value={categoryValue(category)}>
              {categoryLabel(category, language)}
            </option>
          ))}
        </select>
      </label>
      {children.length > 0 && (
        <label>
          <span>{text(language, "Danh mục con", "Subcategory")}</span>
          <select value={selectedChildValue} onChange={(event) => onChange(event.target.value)}>
            <option value="">{text(language, "Chọn danh mục con", "Select subcategory")}</option>
            {children.map((category) => (
              <option key={category._id || category.slug} value={categoryValue(category)}>
                {categoryLabel(category, language)}
              </option>
            ))}
          </select>
        </label>
      )}
      {value && !findCategoryByValue(categories, value) && (
        <span className="marketAdminCategoryHint">
          {text(language, "Giá trị hiện tại chưa có trong cây danh mục:", "Current value is not in the category tree:")} {value}
        </span>
      )}
    </div>
  );
}

function FacetPicker({ field, value, options = [], onChange, language = "vi" }) {
  const selected = csvToValues(value);

  function toggle(nextValue) {
    const next = selected.includes(nextValue)
      ? selected.filter((item) => item !== nextValue)
      : [...selected, nextValue];
    onChange(valuesToCsv(next));
  }

  return (
    <div className={`marketAdminFacetPicker ${field}`}>
      <span>{language === "en" ? ({ styles: "Style", renderers: "Render", forms: "Form", colors: "Color", materials: "Material", platforms: "Platform" }[field] || field) : facetTitles[field]}</span>
      <div>
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              type="button"
              key={option.value}
              className={active ? "active" : ""}
              onClick={() => toggle(option.value)}
              title={option.value}
            >
              {option.hex && <i style={{ backgroundColor: option.hex }} />}
              {option.iconKey && (
                <span className={`marketFacetBrandIcon ${option.iconKey}`} aria-hidden="true">
                  {{ vray: "V", corona: "", standard: "S", "3dsmax": "3", autocad: "A", sketchup: "S", "fbx-obj": "F" }[option.iconKey] || option.iconKey.slice(0, 1).toUpperCase()}
                </span>
              )}
              {optionLabel(option, language)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ManagedAssetSummary({
  model,
  selected,
  selectedForBulk,
  onBulkToggle,
  onEdit,
  onTrash,
  onRestore,
  onPermanentDelete,
  adminAssetBase,
  deletedView = false,
  language = "vi",
}) {
  const state = publicState(model);
  const localizedState = {
    draft: text(language, "Bản nháp", "Draft"),
    incomplete: text(language, "Thiếu metadata", "Incomplete metadata"),
    pending: text(language, "Thiếu file", "Missing file"),
    online: text(language, "Đang online", "Online"),
  }[state.key] || state.label;
  const deletionLabel = {
    deleting: text(language, "Đang chuyển vào thùng rác", "Moving to trash"),
    trashed: text(language, "Trong thùng rác", "In trash"),
    delete_error: text(language, "Lỗi thao tác Drive", "Drive operation failed"),
    purging: text(language, "Đang xóa vĩnh viễn", "Deleting permanently"),
    purge_error: text(language, "Lỗi xóa vĩnh viễn", "Permanent delete failed"),
  }[model.deletionStatus] || localizedState;
  const isScene = model.assetType === "scene";
  const deletionBusy = ["deleting", "purging"].includes(model.deletionStatus);

  return (
    <article className={`marketAdminItem ${deletedView ? "trashed" : state.key} ${selected ? "selected" : ""}`}>
      <div className={`marketAdminModelHead ${deletedView ? "withoutBulk" : ""}`}>
        {!deletedView && (
          <label className="marketAdminBulkCheck" title={text(language, "Chọn tài nguyên", "Select asset")}>
            <input type="checkbox" checked={selectedForBulk} onChange={() => onBulkToggle(model._id)} />
          </label>
        )}
        <AdminCover model={model} adminAssetBase={adminAssetBase} language={language} />
        <div className="marketAdminModelTitle">
          <strong>{model.title}</strong>
          <span>{model.slug}</span>
        </div>
        <div className="marketAdminBadges">
          <span className={`badge ${statusClass(deletedView ? model.deletionStatus : state.key)}`}>{deletionLabel}</span>
          <span className={`badge ${statusClass(model.metadataStatus)}`}>
            {model.metadataStatus === "complete" ? text(language, "Đủ metadata", "Metadata ready") : text(language, "Thiếu metadata", "Incomplete metadata")}
          </span>
          <span className={`badge ${statusClass(model.fileStatus)}`}>
            {model.fileStatus === "ready" ? text(language, "Sẵn sàng", "Ready") : (fileStatusLabels[model.fileStatus] || model.fileStatus)}
          </span>
          <span className="badge">{accessLabels[model.accessType] || model.accessType}</span>
          {Number(model.openReportCount || 0) > 0 && (
            <span className="badge danger marketAdminReportBadge">
              <Flag size={12} /> {Number(model.openReportCount).toLocaleString()} {text(language, "báo lỗi", "reports")}
            </span>
          )}
        </div>
      </div>
      <MissingFields fields={model.metadataMissingFields || []} language={language} />
      <div className="marketAdminModelGrid">
        <ModelFact label={text(language, "File nén", "Archive")} value={formatBytes(model.fileSize)} detail={model.archiveExt || "archive"} />
        <ModelFact label={text(language, "Ảnh cover", "Cover image")} value={model.coverImage?.driveFileId ? text(language, "Đã gắn", "Attached") : text(language, "Thiếu", "Missing")} detail={model.coverImage?.fileName} />
        <ModelFact label="Preview" value={`${model.previewImages?.length || 0} ${text(language, "ảnh", "images")}`} detail={model.metadataFileName || "metadata"} />
        <ModelFact label={text(language, "Lần quét Drive", "Last Drive scan")} value={formatDate(model.lastDriveScanAt)} detail={model.driveFolderName || model.source?.slug} />
        {deletedView && <ModelFact label={text(language, "Xóa vĩnh viễn", "Permanent deletion")} value={formatTimeRemaining(model.purgeAt, language)} detail={model.deletionError || formatDate(model.purgeAt)} />}
      </div>
      <div className="marketAdminModelActions">
        {!deletedView && <button type="button" className="primaryButton" onClick={() => onEdit(model)}><Pencil size={16} /> {isScene ? text(language, "Chỉnh sửa scene", "Edit scene") : text(language, "Chỉnh sửa model", "Edit model")}</button>}
        {!deletedView && <button type="button" className="smallButton danger" onClick={() => onTrash(model)}><Trash2 size={16} /> {text(language, "Đưa vào thùng rác", "Move to trash")}</button>}
        {deletedView && model.deletionStatus === "delete_error" && <button type="button" className="smallButton" onClick={() => onTrash(model)}><RefreshCw size={16} /> {text(language, "Thử xóa lại", "Retry trash")}</button>}
        {deletedView && <button type="button" className="primaryButton" disabled={deletionBusy} onClick={() => onRestore(model)}><RotateCcw size={16} /> {text(language, "Khôi phục", "Restore")}</button>}
        {deletedView && <button type="button" className="smallButton danger" disabled={deletionBusy} onClick={() => onPermanentDelete(model)}><Trash2 size={16} /> {model.deletionStatus === "purge_error" ? text(language, "Thử xóa lại", "Retry deletion") : text(language, "Xóa vĩnh viễn", "Delete permanently")}</button>}
      </div>
    </article>
  );
}

export default function AdminMarketplace({ language = "vi", assetType = "model" }) {
  const l = useCallback((vi, en) => text(language, vi, en), [language]);
  const isScene = assetType === "scene";
  const adminAssetBase = isScene ? "/api/admin/marketplace/scenes" : "/api/admin/marketplace/models";
  const adminOpsBase = isScene ? adminAssetBase : "/api/admin/marketplace";
  const publicAssetBase = isScene ? "/api/marketplace/scenes" : "/api/marketplace";
  const assetName = isScene ? "scene" : "model";
  const [activeTab, setActiveTab] = useState("import");
  const [models, setModels] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState("");
  const [fileStatus, setFileStatus] = useState("all");
  const [accessType, setAccessType] = useState("all");
  const [published, setPublished] = useState("all");
  const [metadataStatus, setMetadataStatus] = useState("all");
  const [reportedOnly, setReportedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [categoryTree, setCategoryTree] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [driveImportForm, setDriveImportForm] = useState(emptyDriveImportForm);
  const [metadataById, setMetadataById] = useState({});
  const [stateById, setStateById] = useState({});
  const [metadataVersionById, setMetadataVersionById] = useState({});
  const [selectedModel, setSelectedModel] = useState(null);
  const [reconcileStarting, setReconcileStarting] = useState(false);
  const [reconcileCanceling, setReconcileCanceling] = useState(false);
  const [syncInfo, setSyncInfo] = useState(null);
  const [syncRootFolderId, setSyncRootFolderId] = useState("");
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncFolderId, setSyncFolderId] = useState("");
  const [folderSyncRunning, setFolderSyncRunning] = useState(false);
  const [retryingFailureType, setRetryingFailureType] = useState("");
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null);
  const [metadataSavingId, setMetadataSavingId] = useState("");
  const [imageManagingId, setImageManagingId] = useState("");
  const [verifyingFileId, setVerifyingFileId] = useState("");
  const [metadataConflict, setMetadataConflict] = useState(null);
  const [selectedModelIds, setSelectedModelIds] = useState([]);
  const [bulkAction, setBulkAction] = useState("publish");
  const [bulkAccessType, setBulkAccessType] = useState("member");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [catalogView, setCatalogView] = useState("active");
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteRunning, setDeleteRunning] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportPage, setReportPage] = useState(1);
  const [reportPagination, setReportPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [reportSearch, setReportSearch] = useState("");
  const [reportStatus, setReportStatus] = useState("active");
  const [reportReason, setReportReason] = useState("");
  const [reportNotes, setReportNotes] = useState({});
  const [reportLoadingId, setReportLoadingId] = useState("");

  const currentSelectedModel = useMemo(() => {
    if (!selectedModel?._id) return null;
    return models.find((model) => model._id === selectedModel._id) || selectedModel;
  }, [models, selectedModel]);

  const activeFilterCount = useMemo(() => {
    return [fileStatus, accessType, published, metadataStatus].filter((item) => item !== "all").length +
      (reportedOnly ? 1 : 0) +
      (search.trim() ? 1 : 0);
  }, [fileStatus, accessType, published, metadataStatus, reportedOnly, search]);

  function updateDriveImport(field, value) {
    setDriveImportForm((current) => ({ ...current, [field]: value }));
  }

  function selectForEdit(model) {
    setSelectedModel(model);
    setActiveTab("edit");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function metadataForm(model) {
    return metadataById[model._id] || {
      sourceModelId: model.metadataSourceModelId || model.driveFolderName || "",
      title: model.title || "",
      sourceCategoryId: model.categorySourceId || model.source?.categoryId || "",
      accessType: accessControlValue(model.accessType),
      styles: (model.styles || []).join(", "),
      renderers: (model.renderers || []).join(", "),
      forms: (model.forms || []).join(", "),
      colors: (model.colors || []).join(", "),
      materials: (model.materials || []).join(", "),
      platforms: (model.platforms || []).join(", "),
      renderer: model.renderer || "",
      sha256: model.sha256 || "",
    };
  }

  function stateForm(model) {
    return stateById[model._id] || {
      slug: model.slug || "",
      desiredPublished: Boolean(model.desiredPublished ?? model.isPublished),
    };
  }

  function updateMetadata(model, field, value) {
    setMetadataById((current) => ({
      ...current,
      [model._id]: { ...metadataForm(model), [field]: value },
    }));
  }

  function updateModelState(model, field, value) {
    setStateById((current) => ({
      ...current,
      [model._id]: { ...stateForm(model), [field]: value },
    }));
  }

  const loadModels = useCallback(async (nextPage = 1, deletionView = catalogView) => {
    const query = new URLSearchParams({ page: String(nextPage), fileStatus, accessType, published, metadataStatus, deleted: deletionView });
    if (search.trim()) query.set("search", search.trim());
    if (reportedOnly) query.set("reportedOnly", "true");
    const [modelRes, statsRes, syncRes] = await Promise.all([
      api(`${adminAssetBase}?${query.toString()}`),
      api(isScene ? `${adminAssetBase}/stats` : "/api/admin/marketplace/stats"),
      api(isScene ? `${adminAssetBase}/sync-state` : "/api/admin/marketplace/sync-state").catch(() => ({ config: null, state: null })),
    ]);
    setModels(modelRes.models || []);
    setPagination(modelRes.pagination || { page: 1, totalPages: 1, total: 0 });
    setStats(statsRes.stats || null);
    setSyncInfo(syncRes || null);
    setSyncRootFolderId((current) => current || syncRes?.config?.rootFolderId || "");
    setDriveImportForm((current) => ({
      ...current,
      rootFolderId: current.rootFolderId || syncRes?.config?.rootFolderId || "",
      pageToken: syncRes?.state?.reconciliationPageToken || current.pageToken || "",
      limit: String(syncRes?.state?.reconciliationBatchSize || current.limit || 100),
    }));
    setSelectedModelIds((current) => current.filter((id) => (modelRes.models || []).some((model) => model._id === id)));
  }, [accessType, adminAssetBase, catalogView, fileStatus, isScene, metadataStatus, published, reportedOnly, search]);

  const loadReports = useCallback(async (nextPage = 1) => {
    const query = new URLSearchParams({
      assetType,
      page: String(nextPage),
      status: reportStatus,
    });
    if (reportReason) query.set("reason", reportReason);
    if (reportSearch.trim()) query.set("search", reportSearch.trim());
    const data = await api(`/api/admin/marketplace/reports?${query.toString()}`);
    setReports(data.reports || []);
    setReportPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
    setReportPage(data.pagination?.page || nextPage);
  }, [assetType, reportReason, reportSearch, reportStatus]);

  const loadTaxonomy = useCallback(async () => {
    const [categoryRes, filterRes] = await Promise.all([
      api(isScene ? `${publicAssetBase}/categories` : "/api/marketplace/categories"),
      api(isScene ? `${publicAssetBase}/filters` : "/api/marketplace/filters"),
    ]);
    setCategoryTree(categoryRes.categories || []);
    setFilterOptions(filterRes.filters || {});
  }, [isScene, publicAssetBase]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadModels(1).catch((err) => setError(err.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadModels]);

  useEffect(() => {
    loadTaxonomy().catch((err) => setError(err.message));
  }, [loadTaxonomy]);

  useEffect(() => {
    if (activeTab !== "reports") return undefined;
    const timer = window.setTimeout(() => {
      loadReports(1).catch((err) => setError(err.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [activeTab, loadReports]);

  useEffect(() => {
    if (activeTab !== "import") return undefined;
    const reconciliationStatus = syncInfo?.state?.reconciliationStatus;
    if (!["queued", "running"].includes(reconciliationStatus)) return undefined;
    let disposed = false;
    const syncStateUrl = isScene ? `${adminAssetBase}/sync-state` : "/api/admin/marketplace/sync-state";
    const statsUrl = isScene ? `${adminAssetBase}/stats` : "/api/admin/marketplace/stats";
    const refreshProgress = async () => {
      try {
        const [syncRes, statsRes] = await Promise.all([
          api(syncStateUrl),
          api(statsUrl),
        ]);
        if (disposed) return;
        setSyncInfo(syncRes);
        setStats(statsRes.stats || null);
        const state = syncRes?.state;
        setDriveImportForm((current) => ({
          ...current,
          pageToken: state?.reconciliationPageToken || "",
        }));
        if (state?.reconciliationStatus === "complete") {
          setMessage(l(
            `Đã quét xong ${state.reconciliationScanned || 0} folder.`,
            `Reconciliation completed after scanning ${state.reconciliationScanned || 0} folders.`,
          ));
          await loadModels(1);
        } else if (state?.reconciliationStatus === "error") {
          setError(state.reconciliationError || l("Đối soát Drive bị lỗi.", "Drive reconciliation failed."));
        } else if (state?.reconciliationStatus === "canceled") {
          setMessage(l("Đã dừng quét toàn bộ Drive.", "Full Drive reconciliation stopped."));
        }
      } catch (err) {
        if (!disposed) setError(err.message);
      }
    };
    const timer = window.setInterval(refreshProgress, 2000);
    refreshProgress();
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [activeTab, adminAssetBase, isScene, l, loadModels, syncInfo?.state?.reconciliationStatus]);

  async function startFullReconciliation(event, reset = true) {
    event?.preventDefault?.();
    setMessage("");
    setError("");
    setReconcileStarting(true);
    try {
      const data = await api(`${adminOpsBase}/drive/reconcile/start`, {
        method: "POST",
        body: JSON.stringify({
          rootFolderId: driveImportForm.rootFolderId,
          batchSize: Number(driveImportForm.limit || 100),
          reset,
        }),
      });
      setSyncInfo((current) => ({ ...(current || {}), state: data.state || null }));
      setMessage(reset
        ? l("Đã bắt đầu quét toàn bộ Drive. Có thể rời trang, tiến trình vẫn chạy.", "Full Drive reconciliation started. You can leave this page while it runs.")
        : l("Đã tiếp tục tiến trình từ checkpoint gần nhất.", "Reconciliation resumed from its latest checkpoint."));
    } catch (err) {
      setError(err.message);
    } finally {
      setReconcileStarting(false);
    }
  }

  async function cancelFullReconciliation() {
    setMessage("");
    setError("");
    setReconcileCanceling(true);
    try {
      const data = await api(`${adminOpsBase}/drive/reconcile/cancel`, {
        method: "POST",
        body: JSON.stringify({ rootFolderId: driveImportForm.rootFolderId }),
      });
      setSyncInfo((current) => ({ ...(current || {}), state: data.state || current?.state || null }));
      setMessage(l("Đã yêu cầu dừng. Batch đang chạy sẽ hoàn tất rồi tiến trình dừng.", "Stop requested. The current batch will finish before reconciliation stops."));
    } catch (err) {
      setError(err.message);
    } finally {
      setReconcileCanceling(false);
    }
  }

  async function runDriveSyncNow() {
    setMessage("");
    setError("");
    setSyncRunning(true);
    try {
      const data = await api(isScene ? `${adminAssetBase}/sync-run` : "/api/admin/marketplace/sync-run", {
        method: "POST",
        body: JSON.stringify({ rootFolderId: syncRootFolderId || driveImportForm.rootFolderId }),
      });
      setSyncInfo((current) => ({ ...(current || {}), state: data.state || current?.state || null }));
      setMessage(
        `Đã đọc ${data.changesCount || 0} thay đổi, thêm ${data.queuedCount || 0} folder vào hàng đợi, ` +
        `xử lý ${data.scannedFolders || 0} folder, lỗi ${data.failedCount || 0}.`,
      );
      await loadModels(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncRunning(false);
    }
  }

  async function syncOneDriveFolder() {
    if (!syncFolderId.trim()) return;
    setMessage("");
    setError("");
    setFolderSyncRunning(true);
    try {
      const data = await api(`${adminOpsBase}/drive/sync-folder`, {
        method: "POST",
        body: JSON.stringify({ driveFolderId: syncFolderId.trim() }),
      });
      setSyncFolderId("");
      setMessage(`Đã đồng bộ ${data.model?.title || "model"}; chỉ một folder được đọc.`);
      await loadModels(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setFolderSyncRunning(false);
    }
  }

  async function runMetadataMigration(dryRun) {
    if (!dryRun && !window.confirm("Ghi metadata Mongo hiện tại lên Drive cho batch này? Một file backup sẽ được tạo trước.")) return;
    setMessage("");
    setError("");
    setMigrationRunning(true);
    try {
      const data = await api(`${adminOpsBase}/drive/migrate-metadata`, {
        method: "POST",
        body: JSON.stringify({ limit: 20, dryRun }),
      });
      setMigrationResult(data);
      setMessage(dryRun
        ? `Dry-run: ${data.changed || 0}/${data.inspected || 0} model cần migration.`
        : `Đã migration ${data.migrated || 0} model; ${data.skipped?.length || 0} model bị bỏ qua.`);
      if (!dryRun) await loadModels(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setMigrationRunning(false);
    }
  }

  async function rescanDriveFolder(model) {
    setMessage("");
    setError("");
    try {
      const data = await api(`${adminAssetBase}/${model._id}/rescan-drive`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setSelectedModel(data.model || model);
      setMetadataById((current) => {
        const next = { ...current };
        delete next[model._id];
        return next;
      });
      setMessage(
        `Đã quét lại Drive: ${data.scannedFiles || 0} file, ${data.previewCount || 0} preview` +
        (data.metadataError ? `. Metadata lỗi: ${data.metadataError}` : ""),
      );
      await loadModels(page);
    } catch (err) {
      setError(err.message);
    }
  }

  async function verifyArchiveFile(model) {
    setMessage("");
    setError("");
    setVerifyingFileId(model._id);
    try {
      const data = await api(`${adminAssetBase}/${model._id}/verify-file`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const verification = data.verification || {};
      setMessage(
        `${l("File hợp lệ", "File verified")}: ${verification.fileName || "archive"} · ${formatBytes(verification.fileSize)}`,
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifyingFileId("");
    }
  }

  async function retryFailedJobs(type) {
    setMessage("");
    setError("");
    setRetryingFailureType(type);
    try {
      const endpoint = type === "cover"
        ? `${adminOpsBase}/covers/retry-failures`
        : `${adminOpsBase}/drive/retry-failures`;
      const data = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(type === "drive" ? {
          rootFolderId: syncRootFolderId || driveImportForm.rootFolderId,
        } : {}),
      });
      setMessage(type === "cover"
        ? l(`Đã đưa ${data.requeued || 0} cover lỗi về hàng đợi.`, `Requeued ${data.requeued || 0} failed covers.`)
        : l(
          `Đã thử lại ${data.requeued || 0} folder; còn lỗi ${data.failed || 0}.`,
          `Retried ${data.requeued || 0} folders; ${data.failed || 0} still failed.`,
        ));
      await loadModels(page);
    } catch (err) {
      setError(err.message);
    } finally {
      setRetryingFailureType("");
    }
  }

  async function manageModelImages(model, action) {
    setMessage("");
    setError("");
    setImageManagingId(model._id);
    try {
      const data = await action();
      setSelectedModel(data.model || model);
      await loadModels(page);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setImageManagingId("");
    }
  }

  async function uploadModelImages(model, kind, files) {
    const available = kind === "preview" ? Math.max(0, 20 - (model.previewImages?.length || 0)) : 1;
    const queue = files.slice(0, available);
    if (!queue.length) {
      setError(l("Model đã đủ 20 ảnh preview.", "This asset already has 20 preview images."));
      return;
    }
    const result = await manageModelImages(model, async () => {
      let latest = { model };
      for (const file of queue) {
        latest = await apiBinary(`${adminAssetBase}/${model._id}/images?kind=${kind}`, file, {
          method: "POST",
          headers: { "Content-Type": file.type || "image/jpeg" },
        });
      }
      return latest;
    });
    if (!result) return;
    setMessage(kind === "cover"
      ? l("Đã cập nhật ảnh cover trên Drive.", "Cover image updated on Drive.")
      : l(`Đã tải lên ${queue.length} ảnh preview và đồng bộ lại thứ tự.`, `Uploaded ${queue.length} preview images and synchronized their order.`));
  }

  async function reorderModelPreviews(model, fileIds) {
    const result = await manageModelImages(model, () => api(`${adminAssetBase}/${model._id}/previews/order`, {
      method: "PUT",
      body: JSON.stringify({ fileIds }),
    }));
    if (!result) return;
    setMessage(l("Đã lưu thứ tự preview trên Drive.", "Preview order saved on Drive."));
  }

  async function deleteModelPreview(model, index) {
    const result = await manageModelImages(model, () => api(`${adminAssetBase}/${model._id}/previews/${index}`, {
      method: "DELETE",
      body: JSON.stringify({}),
    }));
    if (!result) return false;
    setMessage(l("Đã chuyển ảnh preview vào thùng rác Drive.", "Preview moved to Drive trash."));
    return true;
  }

  async function setModelCover(model, index) {
    const result = await manageModelImages(model, () => api(`${adminAssetBase}/${model._id}/previews/${index}/cover`, {
      method: "POST",
      body: JSON.stringify({}),
    }));
    if (!result) return;
    setMessage(l("Đã dùng preview đã chọn làm ảnh cover.", "Selected preview is now the cover image."));
  }

  async function saveModelMetadata(model) {
    setMessage("");
    setError("");
    setMetadataSavingId(model._id);
    try {
      const form = metadataForm(model);
      if (categoryHasChildren(categoryTree, form.sourceCategoryId)) {
        setError("Danh mục đang chọn còn danh mục con. Hãy chọn danh mục con trước khi lưu.");
        return;
      }
      const expected = metadataVersionById[model._id] || {
        metadataHash: model.metadataHash || "",
        driveVersion: model.metadataDriveVersion || "",
      };
      const data = await api(`${adminAssetBase}/${model._id}/metadata`, {
        method: "PUT",
        body: JSON.stringify({
          metadata: {
            assetType,
            sourceAssetId: form.sourceModelId,
            sourceModelId: form.sourceModelId,
            title: form.title,
            sourceCategoryId: form.sourceCategoryId,
            accessType: form.accessType,
            styles: form.styles,
            renderers: form.renderers,
            forms: form.forms,
            colors: form.colors,
            materials: form.materials,
            platforms: form.platforms,
            renderer: form.renderer,
            sha256: form.sha256,
          },
          expectedMetadataHash: expected.metadataHash,
          expectedDriveVersion: expected.driveVersion,
        }),
      });
      setSelectedModel(data.model || model);
      setMetadataById((current) => {
        const next = { ...current };
        delete next[model._id];
        return next;
      });
      setMetadataVersionById((current) => {
        const next = { ...current };
        delete next[model._id];
        return next;
      });
      setMessage(`Drive đã xác nhận metadata revision ${data.metadata?.revision || data.model?.metadataRevision || "-"}.`);
      await loadModels(page);
    } catch (err) {
      if (err.code === "METADATA_CONFLICT") {
        setMetadataConflict({ model, form: metadataForm(model), ...err.data });
      } else {
        setError(err.message);
      }
    } finally {
      setMetadataSavingId("");
    }
  }

  function loadConflictVersion() {
    if (!metadataConflict?.model?._id || !metadataConflict.current?.metadata) return;
    const model = metadataConflict.model;
    const current = metadataConflict.current;
    setMetadataById((forms) => ({
      ...forms,
      [model._id]: {
        ...metadataForm(model),
        ...current.metadata,
        styles: (current.metadata.styles || []).join(", "),
        renderers: (current.metadata.renderers || []).join(", "),
        forms: (current.metadata.forms || []).join(", "),
        colors: (current.metadata.colors || []).join(", "),
        materials: (current.metadata.materials || []).join(", "),
        platforms: (current.metadata.platforms || []).join(", "),
      },
    }));
    setMetadataVersionById((versions) => ({
      ...versions,
      [model._id]: {
        metadataHash: current.metadataHash || "",
        driveVersion: current.driveVersion || "",
      },
    }));
    setMetadataConflict(null);
    setMessage("Đã nạp bản mới nhất từ Drive vào form. Kiểm tra rồi bấm lưu lại.");
  }

  async function cleanupRawMetadata() {
    setMessage("");
    setError("");
    try {
      const data = await api("/api/admin/marketplace/cleanup-raw", { method: "POST" });
      setMessage(
        `Đã dọn Mongo: ${data.modified || 0}/${data.matched || 0}, ` +
        `${data.unpublishedIncomplete || 0} model thiếu dữ liệu bị chuyển về bản nháp.`,
      );
      await loadModels(page);
    } catch (err) {
      setError(err.message);
    }
  }

  async function quickUpdate(model, patch) {
    setMessage("");
    setError("");
    try {
      const data = await api(`${adminAssetBase}/${model._id}/state`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSelectedModel(data.model || model);
      await loadModels(page);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  async function saveModelState(model) {
    const form = stateForm(model);
    const data = await quickUpdate(model, {
      slug: form.slug,
      desiredPublished: form.desiredPublished,
    });
    if (!data) return;
    setStateById((current) => {
      const next = { ...current };
      delete next[model._id];
      return next;
    });
    setMessage("Đã cập nhật trạng thái vận hành trên web.");
  }

  function openDeleteDialog(model, mode = "trash") {
    setDeleteDialog({ model, mode });
    setDeleteConfirmation("");
    setError("");
  }

  function closeDeleteDialog() {
    if (deleteRunning) return;
    setDeleteDialog(null);
    setDeleteConfirmation("");
  }

  async function confirmDeleteAction() {
    if (!deleteDialog?.model?._id || deleteConfirmation !== deleteDialog.model.title) return;
    const target = deleteDialog.model;
    const permanent = deleteDialog.mode === "permanent";
    setDeleteRunning(true);
    setMessage("");
    setError("");
    try {
      await api(`${adminAssetBase}/${target._id}${permanent ? "/permanent" : ""}`, {
        method: "DELETE",
        body: JSON.stringify({ confirmation: deleteConfirmation }),
      });
      setDeleteDialog(null);
      setDeleteConfirmation("");
      setSelectedModel((current) => current?._id === target._id ? null : current);
      setSelectedModelIds((current) => current.filter((id) => id !== target._id));
      setCatalogView("trashed");
      setActiveTab("search");
      await loadModels(permanent ? page : 1, "trashed");
      setMessage(permanent
        ? l("Đã xóa vĩnh viễn tài sản Drive và giữ bản ghi lịch sử gọn.", "Drive assets were permanently deleted and a compact history record was retained.")
        : l("Đã đưa tài nguyên vào thùng rác Drive trong 30 ngày.", "The asset was moved to Drive trash for 30 days."));
    } catch (err) {
      setCatalogView("trashed");
      setActiveTab("search");
      setError(err.message);
    } finally {
      setDeleteRunning(false);
    }
  }

  async function restoreDeletedAsset(model) {
    setMessage("");
    setError("");
    try {
      await api(`${adminAssetBase}/${model._id}/restore`, { method: "POST", body: JSON.stringify({}) });
      setCatalogView("active");
      await loadModels(1, "active");
      setMessage(l("Đã khôi phục folder Drive và đồng bộ lại tài nguyên.", "The Drive folder was restored and the asset was synchronized."));
    } catch (err) {
      setError(err.message);
      await loadModels(page);
    }
  }

  function toggleSelectedModel(id) {
    setSelectedModelIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  function toggleSelectPage() {
    const pageIds = models.map((model) => model._id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedModelIds.includes(id));
    setSelectedModelIds(allSelected ? [] : pageIds);
  }

  async function runBulkAction() {
    if (!selectedModelIds.length) return;
    const label = {
      publish: "xuất bản",
      unpublish: "chuyển nháp",
      access: "đổi quyền tải",
      rescan: "quét lại Drive",
    }[bulkAction] || bulkAction;
    if (!window.confirm(`Áp dụng "${label}" cho ${selectedModelIds.length} model?`)) return;
    setMessage("");
    setError("");
    setBulkRunning(true);
    try {
      const data = await api(`${adminAssetBase}/bulk`, {
        method: "POST",
        body: JSON.stringify({
          ids: selectedModelIds,
          action: bulkAction,
          accessType: bulkAccessType,
        }),
      });
      setMessage(
        `Bulk ${label}: ${data.updatedCount || 0} cập nhật, ` +
        `${data.skippedCount || 0} bỏ qua, ${data.failedCount || 0} lỗi.`,
      );
      setSelectedModelIds([]);
      await loadModels(page);
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkRunning(false);
    }
  }

  async function updateReportStatus(report, status) {
    setMessage("");
    setError("");
    setReportLoadingId(report._id);
    try {
      await api(`/api/admin/marketplace/reports/${report._id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          adminNote: reportNotes[report._id] ?? report.adminNote ?? "",
        }),
      });
      setMessage(l("Đã cập nhật trạng thái báo lỗi.", "Report status updated."));
      await Promise.all([loadReports(reportPage), loadModels(page)]);
    } catch (err) {
      setError(err.message);
    } finally {
      setReportLoadingId("");
    }
  }

  async function openReportedAsset(report) {
    if (!report.model?._id) return;
    setMessage("");
    setError("");
    try {
      const query = new URLSearchParams({
        page: "1",
        deleted: "all",
        search: report.model._id,
      });
      const data = await api(`${adminAssetBase}?${query.toString()}`);
      const model = (data.models || []).find((item) => item._id === report.model._id);
      if (!model) throw new Error(l("Không tìm thấy tài nguyên.", "Asset not found."));
      setModels(data.models || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
      selectForEdit(model);
    } catch (err) {
      setError(err.message);
    }
  }

  function clearFilters() {
    setSearch("");
    setFileStatus("all");
    setAccessType("all");
    setPublished("all");
    setMetadataStatus("all");
    setReportedOnly(false);
  }

  function goToPage(nextPage) {
    const target = Math.min(Math.max(1, Number(nextPage) || 1), Math.max(1, pagination.totalPages || 1));
    setPage(target);
    loadModels(target).catch((err) => setError(err.message));
  }

  const selectedState = currentSelectedModel ? publicState(currentSelectedModel) : null;
  const selectedMetadataForm = currentSelectedModel ? metadataForm(currentSelectedModel) : null;
  const selectedOperationalForm = currentSelectedModel ? stateForm(currentSelectedModel) : null;
  const allPageSelected = models.length > 0 && models.every((model) => selectedModelIds.includes(model._id));
  const reconciliationState = syncInfo?.state || {};
  const reconciliationStatus = reconciliationState.reconciliationStatus || "idle";
  const reconciliationActive = ["queued", "running"].includes(reconciliationStatus);
  const reconciliationCanResume = ["error", "canceled"].includes(reconciliationStatus) &&
    Boolean(reconciliationState.reconciliationPageToken);

  return (
    <section className="panel adminMarketplace">
      <div className="marketAdminHeader">
        <div>
          <h2><Database size={20} /> {isScene ? l("Quản lý scene", "Scene management") : l("Quản lý model", "Model management")}</h2>
        </div>
        {!isScene && <button type="button" className="smallButton" onClick={cleanupRawMetadata}>
          <RefreshCw size={15} /> {l("Dọn dữ liệu Mongo", "Clean Mongo data")}
        </button>}
      </div>

      {stats && (
        <div className="marketAdminKpis">
          <KpiCard icon={Package} label={isScene ? l("Tổng scene", "Total scenes") : l("Tổng model", "Total models")} value={stats.models} />
          <KpiCard icon={ListChecks} label={l("Đủ metadata", "Metadata ready")} value={stats.completeMetadata} tone="success" />
          <KpiCard icon={AlertTriangle} label={l("Thiếu metadata", "Incomplete metadata")} value={stats.incompleteMetadata} tone="warning" />
          <KpiCard icon={CheckCircle2} label={l("File sẵn sàng", "Files ready")} value={stats.ready} tone="success" />
          <KpiCard icon={AlertTriangle} label={l("Thiếu file", "Missing files")} value={stats.missing} tone="warning" />
          <KpiCard icon={EyeOff} label={l("Bản nháp", "Drafts")} value={stats.draft} />
          <KpiCard icon={Trash2} label={l("Thùng rác", "Trash")} value={stats.trashed || 0} tone="warning" />
          <KpiCard icon={Flag} label={l("Cần kiểm tra", "Needs review")} value={stats.reportedAssets || 0} tone={Number(stats.reportedAssets || 0) > 0 ? "warning" : "success"} />
        </div>
      )}

      <div className="marketAdminTabs" role="tablist" aria-label={isScene ? l("Khu quản lý scene", "Scene management sections") : l("Khu quản lý model", "Model management sections")}>
        {[
          ["import", l("Import / đồng bộ", "Import / sync"), UploadCloud],
          ["search", isScene ? l("Tìm kiếm scene", "Search scenes") : l("Tìm kiếm model", "Search models"), Search],
          ["edit", isScene ? l("Chỉnh sửa scene", "Edit scene") : l("Chỉnh sửa model", "Edit model"), Pencil],
          ["reports", l("Báo lỗi", "Issue reports"), Flag],
          ["taxonomy", l("Danh mục & bộ lọc", "Categories & filters"), ListChecks],
        ].map(([key, label, Icon]) => (
          <button
            type="button"
            key={key}
            className={activeTab === key ? "active" : ""}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={16} />
            {label}
            {key === "reports" && Number(stats?.activeReports || 0) > 0 && <span>{stats.activeReports}</span>}
          </button>
        ))}
      </div>

      {activeTab === "import" && (
        <div className="marketAdminWorkbench single">
          <form className="marketAdminForm marketAdminSyncPanel" onSubmit={(event) => startFullReconciliation(event, true)}>
            <div className="marketAdminPanelTitle">
              <h3>{l("Đối soát toàn bộ Drive", "Full Drive reconciliation")}</h3>
              <span className={`badge ${reconciliationStatus === "complete" ? "success" : reconciliationActive ? "pending" : ""}`}>
                {reconciliationActive
                  ? l("Đang tự chạy", "Running continuously")
                  : reconciliationStatus === "complete"
                    ? l("Đã hoàn tất", "Complete")
                    : l("Chạy nền có checkpoint", "Background with checkpoint")}
              </span>
            </div>
            <p className="muted">
              {l(
                "Chỉ dùng khi phục hồi hoặc kiểm tra toàn bộ dữ liệu. Model/scene mới và file vừa đổi được Changes API đồng bộ riêng từng folder.",
                "Use only for recovery or a full audit. Changes API syncs new assets and changed files one folder at a time.",
              )}
            </p>
            <div className="marketAdminFieldGrid">
              <label>
                <span>{isScene ? l("Thư mục scenes trên Drive", "Scenes folder on Drive") : l("Thư mục models trên Drive", "Models folder on Drive")}</span>
                <input
                  value={driveImportForm.rootFolderId}
                  onChange={(event) => updateDriveImport("rootFolderId", event.target.value)}
                  placeholder="Drive folder URL / ID"
                  required
                />
              </label>
              <label>
                <span>{l("Checkpoint hiện tại", "Current checkpoint")}</span>
                <input
                  value={driveImportForm.pageToken}
                  readOnly
                  placeholder={l("Tự lưu sau mỗi batch", "Saved after every batch")}
                />
              </label>
              <label>
                <span>{l("Số folder mỗi batch", "Folders per batch")}</span>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={driveImportForm.limit}
                  onChange={(event) => updateDriveImport("limit", event.target.value)}
                />
              </label>
            </div>
            <div className="marketAdminSyncActions">
              {reconciliationCanResume && (
                <button
                  type="button"
                  className="smallButton"
                  disabled={reconcileStarting}
                  onClick={(event) => startFullReconciliation(event, false)}
                >
                  <RefreshCw size={16} /> {l("Tiếp tục từ checkpoint", "Resume from checkpoint")}
                </button>
              )}
              {reconciliationActive ? (
                <button
                  type="button"
                  className="smallButton danger"
                  disabled={reconcileCanceling}
                  onClick={cancelFullReconciliation}
                >
                  <Square size={15} /> {reconcileCanceling ? l("Đang dừng...", "Stopping...") : l("Dừng quét", "Stop")}
                </button>
              ) : (
                <button className="primaryButton" disabled={reconcileStarting}>
                  <UploadCloud size={17} /> {reconcileStarting
                    ? l("Đang khởi tạo...", "Starting...")
                    : l("Quét toàn bộ từ đầu", "Scan everything from start")}
                </button>
              )}
            </div>
            {reconciliationState._id && (
              <div className="marketAdminScanResult">
                <span>{reconciliationState.reconciliationScanned || 0} {l("đã quét", "scanned")}</span>
                <span>{reconciliationState.reconciliationCreated || 0} {l("tạo mới", "created")}</span>
                <span>{reconciliationState.reconciliationUpdated || 0} {l("cập nhật", "updated")}</span>
                <span>{reconciliationState.reconciliationUnchanged || 0} {l("không đổi", "unchanged")}</span>
                <span>{reconciliationState.reconciliationFailed || 0} {l("lỗi", "failed")}</span>
                <span>{reconciliationStatus}</span>
              </div>
            )}
            {reconciliationState.reconciliationError && (
              <div className="marketAdminQueueErrors">
                <div><strong>{l("Lỗi đối soát", "Reconciliation error")}</strong><span>{reconciliationState.reconciliationError}</span></div>
              </div>
            )}
          </form>

          <section className="marketAdminForm marketAdminSyncPanel">
            <div className="marketAdminPanelTitle">
              <h3>Changes API</h3>
              <span className={`badge ${syncInfo?.config?.enabled ? "success" : "pending"}`}>
                {syncInfo?.config?.enabled ? l("Đang bật", "Enabled") : l("Đang tắt", "Disabled")}
              </span>
            </div>
            <p className="muted">
              {l(
                "Đây là đồng bộ tăng dần: chỉ đọc thay đổi mới kể từ token gần nhất, không quét lại toàn bộ Drive.",
                "This is incremental sync: only changes after the latest token are read; the entire Drive is not rescanned.",
              )}
            </p>
            <div className="marketAdminFieldGrid">
              <label>
                <span>Root folder ID</span>
                <input
                  value={syncRootFolderId}
                  onChange={(event) => setSyncRootFolderId(event.target.value)}
                  placeholder={isScene ? "SCENES_DRIVE_ROOT_FOLDER_ID" : "MARKETPLACE_DRIVE_ROOT_FOLDER_ID"}
                />
              </label>
              <ModelFact label={l("Chu kỳ poll", "Poll interval")} value={syncInfo?.config?.pollSeconds || "-"} detail={l("giây", "seconds")} />
              <ModelFact
                label={l("Xác thực Drive", "Drive authentication")}
                value={syncInfo?.config?.auth?.automaticRefresh ? l("Tự gia hạn", "Automatic refresh") : l("Token tạm", "Temporary token")}
                detail={syncInfo?.config?.auth?.automaticRefresh
                  ? l("Không cần thay access token thủ công", "No manual access-token replacement")
                  : l("Chạy npm run drive:auth", "Run npm run drive:auth")}
              />
              <ModelFact label={l("Hàng đợi", "Queue")} value={String(syncInfo?.queue?.pending ?? 0)} detail={`${syncInfo?.queue?.failed || 0} ${l("lỗi", "failed")}`} />
              <ModelFact label={l("Trạng thái", "Status")} value={syncInfo?.state?.status || "idle"} detail={syncInfo?.state?.lastChangesError || syncInfo?.state?.lastError || ""} />
            </div>
            {syncInfo?.state && (
              <div className="marketAdminScanResult">
                <span>Token: {syncInfo.state.changesPageToken ? "đã khởi tạo" : "chưa khởi tạo"}</span>
                <span>Change gần nhất: {syncInfo.state.lastChangesCount || 0}</span>
                <span>Poll: {formatDate(syncInfo.state.lastChangesPollAt)}</span>
              </div>
            )}
            {!!syncInfo?.queue?.recentFailures?.length && (
              <div className="marketAdminQueueErrors">
                {syncInfo.queue.recentFailures.map((item) => (
                  <div key={item._id || item.driveFolderId}>
                    <strong>{item.driveFolderId}</strong>
                    <span>{item.lastError || "Đồng bộ thất bại"}</span>
                    <span>{item.attempts || 0}/8 lần</span>
                  </div>
                ))}
              </div>
            )}
            <div className="marketAdminFieldGrid">
              <label>
                <span>{isScene ? l("Đồng bộ đúng một folder scene", "Sync one scene folder") : l("Đồng bộ đúng một folder model", "Sync one model folder")}</span>
                <input value={syncFolderId} onChange={(event) => setSyncFolderId(event.target.value)} placeholder={`Drive ${assetName} folder URL / ID`} />
              </label>
            </div>
            <div className="marketAdminSyncActions">
              {Number(syncInfo?.queue?.failed || 0) > 0 && (
                <button type="button" className="smallButton" onClick={() => retryFailedJobs("drive")} disabled={Boolean(retryingFailureType)}>
                  <RotateCcw size={17} /> {retryingFailureType === "drive" ? l("Đang thử lại...", "Retrying...") : l("Thử lại sync lỗi", "Retry failed syncs")}
                </button>
              )}
              {Number(stats?.coverCacheErrors || 0) > 0 && (
                <button type="button" className="smallButton" onClick={() => retryFailedJobs("cover")} disabled={Boolean(retryingFailureType)}>
                  <ImageOff size={17} /> {retryingFailureType === "cover" ? l("Đang đưa lại hàng đợi...", "Requeuing...") : l(`Thử lại ${stats.coverCacheErrors} cover lỗi`, `Retry ${stats.coverCacheErrors} failed covers`)}
                </button>
              )}
              <button type="button" className="smallButton" onClick={syncOneDriveFolder} disabled={folderSyncRunning || !syncFolderId.trim()}>
                <RefreshCw size={17} /> {folderSyncRunning ? l("Đang đồng bộ...", "Syncing...") : isScene ? l("Sync một scene", "Sync one scene") : l("Sync một model", "Sync one model")}
              </button>
              <button type="button" className="primaryButton" onClick={runDriveSyncNow} disabled={syncRunning || !(syncRootFolderId || driveImportForm.rootFolderId)}>
                <RefreshCw size={17} /> {syncRunning ? l("Đang đọc changes...", "Reading changes...") : l("Đọc Changes API ngay", "Read Changes API now")}
              </button>
            </div>
          </section>

          <details className="marketAdminForm marketAdminManualImport">
            <summary><Database size={16} /> {isScene ? l("Nâng cấp metadata cũ · Scene V3", "Upgrade legacy metadata · Scene V3") : l("Nâng cấp metadata cũ · Model V2", "Upgrade legacy metadata · Model V2")}</summary>
            <p className="muted">
              {l(
                "Chỉ dùng một lần cho file metadata schema cũ: hệ thống backup rồi chuẩn hóa sang schema hiện tại. Upload và đồng bộ tài nguyên mới không cần chạy mục này.",
                "Use once for legacy metadata schemas: the current file is backed up before conversion. New uploads and normal sync do not use this action.",
              )}
            </p>
            <div className="marketAdminSyncActions">
              <button type="button" className="smallButton" disabled={migrationRunning} onClick={() => runMetadataMigration(true)}>
                {l("Kiểm tra batch đầu", "Check first batch")}
              </button>
              <button type="button" className="primaryButton" disabled={migrationRunning} onClick={() => runMetadataMigration(false)}>
                {migrationRunning ? l("Đang xử lý...", "Processing...") : l("Backup và migrate batch đầu", "Back up and migrate first batch")}
              </button>
            </div>
            {migrationResult && (
              <div className="marketAdminScanResult">
                <span>{l("Đã kiểm tra", "Inspected")}: {migrationResult.inspected || 0}</span>
                <span>Batch: {migrationResult.page || 1}/{migrationResult.totalPages || 1}</span>
                <span>{l("Cần đổi", "Changes needed")}: {migrationResult.changed || 0}</span>
                <span>{l("Đã ghi", "Written")}: {migrationResult.migrated || 0}</span>
                <span>{l("Bỏ qua", "Skipped")}: {migrationResult.skipped?.length || 0}</span>
              </div>
            )}
          </details>

        </div>
      )}

      {activeTab === "search" && (
        <>
          <div className="marketAdminCatalogViews" role="tablist" aria-label={l("Trạng thái catalog", "Catalog state")}>
            <button type="button" role="tab" aria-selected={catalogView === "active"} className={catalogView === "active" ? "active" : ""} onClick={() => { setCatalogView("active"); setPage(1); }}>
              <Package size={15} /> {l("Đang hoạt động", "Active")}
            </button>
            <button type="button" role="tab" aria-selected={catalogView === "trashed"} className={catalogView === "trashed" ? "active" : ""} onClick={() => { setCatalogView("trashed"); setPage(1); }}>
              <Trash2 size={15} /> {l("Thùng rác", "Trash")} <span>{stats?.trashed || 0}</span>
            </button>
          </div>
          <div className="adminTableToolbar marketAdminToolbar">
            <label className="adminSearchField">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isScene ? l("Tìm tên, slug, ID hoặc folder scene...", "Search scene name, slug, ID, or folder...") : l("Tìm tên, slug, ID hoặc folder model...", "Search model name, slug, ID, or folder...")} />
            </label>
            <select value={metadataStatus} onChange={(event) => setMetadataStatus(event.target.value)}>
              <option value="all">{l("Tất cả metadata", "All metadata")}</option>
              <option value="complete">{l("Đủ metadata", "Metadata ready")}</option>
              <option value="incomplete">{l("Thiếu metadata", "Incomplete metadata")}</option>
            </select>
            <select value={fileStatus} onChange={(event) => setFileStatus(event.target.value)}>
              <option value="all">{l("Tất cả file", "All files")}</option>
              <option value="missing">{l("Thiếu file", "Missing file")}</option>
              <option value="pending_upload">{l("Chờ upload", "Pending upload")}</option>
              <option value="ready">{l("Sẵn sàng", "Ready")}</option>
              <option value="failed">{l("Lỗi file", "File error")}</option>
            </select>
            <select value={published} onChange={(event) => setPublished(event.target.value)}>
              <option value="all">{l("Tất cả publish", "All publishing states")}</option>
              <option value="published">{l("Đã xuất bản", "Published")}</option>
              <option value="unpublished">{l("Bản nháp", "Draft")}</option>
            </select>
            <select value={accessType} onChange={(event) => setAccessType(event.target.value)}>
              <option value="all">{l("Tất cả quyền", "All access")}</option>
              <option value="free">Free</option>
              <option value="member">Pro</option>
            </select>
            <label className="checkboxInline marketAdminReportedFilter">
              <input type="checkbox" checked={reportedOnly} onChange={(event) => setReportedOnly(event.target.checked)} />
              <Flag size={14} /> {l("Có báo lỗi", "Reported")}
            </label>
            <span className={`marketFilterCount ${activeFilterCount ? "active" : ""}`}>{activeFilterCount}</span>
            {activeFilterCount > 0 && (
              <button type="button" className="smallButton" onClick={clearFilters}>{l("Xóa lọc", "Clear filters")}</button>
            )}
          </div>

          {catalogView === "active" && <div className="marketAdminBulkBar">
            <label className="checkboxInline">
              <input type="checkbox" checked={allPageSelected} onChange={toggleSelectPage} />
              {l("Chọn trang này", "Select this page")}
            </label>
            <span>{selectedModelIds.length} {isScene ? l("scene đã chọn", "scenes selected") : l("model đã chọn", "models selected")}</span>
            <select value={bulkAction} onChange={(event) => setBulkAction(event.target.value)}>
              <option value="publish">{l("Xuất bản", "Publish")}</option>
              <option value="unpublish">{l("Chuyển nháp", "Move to draft")}</option>
              <option value="access">{l("Đổi quyền tải", "Change access")}</option>
              <option value="rescan">{l("Quét lại Drive", "Rescan Drive")}</option>
            </select>
            {bulkAction === "access" && (
              <select value={bulkAccessType} onChange={(event) => setBulkAccessType(event.target.value)}>
                <option value="member">Pro</option>
                <option value="free">Free</option>
              </select>
            )}
            <button type="button" className="smallButton" disabled={!selectedModelIds.length || bulkRunning} onClick={runBulkAction}>
              <RefreshCw size={15} /> {bulkRunning ? l("Đang xử lý...", "Processing...") : l("Áp dụng", "Apply")}
            </button>
          </div>}

          <div className="marketAdminList">
            {models.map((model) => (
              <ManagedAssetSummary
                key={model._id}
                model={model}
                selected={currentSelectedModel?._id === model._id}
                selectedForBulk={selectedModelIds.includes(model._id)}
                onBulkToggle={toggleSelectedModel}
                onEdit={selectForEdit}
                onTrash={(model) => openDeleteDialog(model, "trash")}
                onRestore={restoreDeletedAsset}
                onPermanentDelete={(model) => openDeleteDialog(model, "permanent")}
                adminAssetBase={adminAssetBase}
                deletedView={catalogView === "trashed"}
                language={language}
              />
            ))}
            {!models.length && <p className="muted">{isScene ? l("Chưa có scene phù hợp.", "No matching scenes.") : l("Chưa có model phù hợp.", "No matching models.")}</p>}
          </div>

          <Pagination
            page={pagination.page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            onPageChange={goToPage}
            language={language}
            itemLabel={assetName}
          />
        </>
      )}

      {activeTab === "reports" && (
        <div className="marketAdminReports">
          <div className="adminTableToolbar marketAdminReportToolbar">
            <label className="adminSearchField">
              <Search size={15} />
              <input
                value={reportSearch}
                onChange={(event) => setReportSearch(event.target.value)}
                placeholder={l("Tìm tên tài nguyên hoặc người báo...", "Search asset or reporter...")}
              />
            </label>
            <select value={reportStatus} onChange={(event) => setReportStatus(event.target.value)}>
              <option value="active">{l("Đang chờ xử lý", "Active reports")}</option>
              <option value="open">{l("Mới", "Open")}</option>
              <option value="investigating">{l("Đang kiểm tra", "Investigating")}</option>
              <option value="resolved">{l("Đã xử lý", "Resolved")}</option>
              <option value="dismissed">{l("Bỏ qua", "Dismissed")}</option>
              <option value="all">{l("Tất cả trạng thái", "All statuses")}</option>
            </select>
            <select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
              <option value="">{l("Tất cả loại lỗi", "All issue types")}</option>
              {Object.entries(reportReasonLabels).map(([value, labels]) => (
                <option key={value} value={value}>{text(language, labels[0], labels[1])}</option>
              ))}
            </select>
          </div>

          <div className="marketAdminReportList">
            {reports.map((report) => {
              const busy = reportLoadingId === report._id;
              const reporter = report.userId && typeof report.userId === "object" ? report.userId : null;
              const statusLabels = reportStatusLabels[report.status] || [report.status, report.status];
              const reasonLabels = reportReasonLabels[report.reason] || [report.reason, report.reason];
              return (
                <article className={`marketAdminReportItem ${report.status}`} key={report._id}>
                  <header>
                    {report.model ? (
                      <AdminCover model={report.model} adminAssetBase={adminAssetBase} language={language} />
                    ) : (
                      <div className="marketAdminCoverPlaceholder"><ImageOff size={18} /></div>
                    )}
                    <div className="marketAdminReportIdentity">
                      <strong>{report.model?.title || l("Tài nguyên không còn tồn tại", "Asset no longer exists")}</strong>
                      <span>{report.model?.slug || String(report.modelId || "")}</span>
                    </div>
                    <div className="marketAdminReportMeta">
                      <span className={`badge ${report.isActive ? "warning" : "success"}`}>{text(language, statusLabels[0], statusLabels[1])}</span>
                      <time>{formatDate(report.createdAt)}</time>
                    </div>
                  </header>
                  <div className="marketAdminReportBody">
                    <div>
                      <span>{l("Người báo", "Reporter")}</span>
                      <strong>{reporter?.name || reporter?.email || l("Không rõ user", "Unknown user")}</strong>
                      {reporter?.name && reporter?.email && <small>{reporter.email}</small>}
                    </div>
                    <div>
                      <span>{l("Loại lỗi", "Issue type")}</span>
                      <strong>{text(language, reasonLabels[0], reasonLabels[1])}</strong>
                    </div>
                    <div className="marketAdminReportMessage">
                      <span>{l("Mô tả", "Description")}</span>
                      <p>{report.message || l("Không có mô tả thêm.", "No additional details.")}</p>
                    </div>
                  </div>
                  <label className="marketAdminReportNote">
                    <span>{l("Ghi chú nội bộ", "Internal note")}</span>
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={reportNotes[report._id] ?? report.adminNote ?? ""}
                      onChange={(event) => setReportNotes((current) => ({ ...current, [report._id]: event.target.value.slice(0, 1000) }))}
                      placeholder={l("Kết quả kiểm tra hoặc nội dung đã sửa...", "Investigation result or applied fix...")}
                    />
                  </label>
                  <footer>
                    <button
                      type="button"
                      className="smallButton"
                      disabled={busy || !report.model || (report.model.deletionStatus && report.model.deletionStatus !== "active")}
                      onClick={() => openReportedAsset(report)}
                    >
                      <Pencil size={15} /> {l("Mở chỉnh sửa", "Open editor")}
                    </button>
                    {report.status !== "investigating" && report.isActive && (
                      <button type="button" className="smallButton" disabled={busy} onClick={() => updateReportStatus(report, "investigating")}>
                        <Search size={15} /> {l("Đang kiểm tra", "Investigating")}
                      </button>
                    )}
                    {!report.isActive && (
                      <button type="button" className="smallButton" disabled={busy} onClick={() => updateReportStatus(report, "open")}>
                        <RotateCcw size={15} /> {l("Mở lại", "Reopen")}
                      </button>
                    )}
                    {report.status !== "resolved" && (
                      <button type="button" className="primaryButton" disabled={busy} onClick={() => updateReportStatus(report, "resolved")}>
                        <CheckCircle2 size={15} /> {l("Đã xử lý", "Resolve")}
                      </button>
                    )}
                    {report.status !== "dismissed" && (
                      <button type="button" className="smallButton danger" disabled={busy} onClick={() => updateReportStatus(report, "dismissed")}>
                        <X size={15} /> {l("Bỏ qua", "Dismiss")}
                      </button>
                    )}
                  </footer>
                </article>
              );
            })}
            {!reports.length && <p className="muted marketAdminReportEmpty">{l("Không có báo lỗi phù hợp.", "No matching issue reports.")}</p>}
          </div>

          <Pagination
            page={reportPagination.page}
            totalPages={reportPagination.totalPages}
            total={reportPagination.total}
            onPageChange={(nextPage) => loadReports(nextPage).catch((err) => setError(err.message))}
            language={language}
            itemLabel={l("báo lỗi", "reports")}
          />
        </div>
      )}

      {activeTab === "edit" && (
        <div className="marketAdminEditPanel">
          {!currentSelectedModel ? (
            <section className="marketAdminEmpty">
              <Package size={36} />
              <h3>{isScene ? l("Chưa chọn scene", "No scene selected") : l("Chưa chọn model", "No model selected")}</h3>
              <p>{isScene ? l("Vào tab Tìm kiếm scene, chọn đúng scene rồi bấm Chỉnh sửa scene.", "Open Search scenes, choose a scene, then select Edit scene.") : l("Vào tab Tìm kiếm model, chọn đúng model rồi bấm Chỉnh sửa model.", "Open Search models, choose a model, then select Edit model.")}</p>
              <button type="button" className="primaryButton" onClick={() => setActiveTab("search")}>
                <Search size={16} /> {l("Đi tới tìm kiếm", "Go to search")}
              </button>
            </section>
          ) : (
            <>
              <div className="marketAdminEditHeader">
                <div>
                  <h3>{currentSelectedModel.title}</h3>
                  <p>{currentSelectedModel.slug}</p>
                </div>
                <div className="marketAdminBadges">
                  <span className={`badge ${statusClass(selectedState.key)}`}>
                    {{
                      draft: l("Bản nháp", "Draft"),
                      incomplete: l("Thiếu metadata", "Incomplete metadata"),
                      pending: l("Thiếu file", "Missing file"),
                      online: l("Đang online", "Online"),
                    }[selectedState.key] || selectedState.label}
                  </span>
                  <span className={`badge ${statusClass(currentSelectedModel.metadataStatus)}`}>
                    {currentSelectedModel.metadataStatus === "complete" ? l("Đủ metadata", "Metadata ready") : l("Thiếu metadata", "Incomplete metadata")}
                  </span>
                  <span className={`badge ${statusClass(currentSelectedModel.fileStatus)}`}>
                    {currentSelectedModel.fileStatus === "ready" ? l("Sẵn sàng", "Ready") : (language === "en" ? currentSelectedModel.fileStatus : (fileStatusLabels[currentSelectedModel.fileStatus] || currentSelectedModel.fileStatus))}
                  </span>
                </div>
              </div>

              <MissingFields fields={currentSelectedModel.metadataMissingFields || []} language={language} />

              <AdminPreviewGallery
                key={currentSelectedModel._id}
                model={currentSelectedModel}
                adminAssetBase={adminAssetBase}
                language={language}
              />

              <AdminImageManager
                model={currentSelectedModel}
                adminAssetBase={adminAssetBase}
                language={language}
                busy={imageManagingId === currentSelectedModel._id}
                onUpload={(kind, files) => uploadModelImages(currentSelectedModel, kind, files)}
                onReorder={(fileIds) => reorderModelPreviews(currentSelectedModel, fileIds)}
                onDelete={(index) => deleteModelPreview(currentSelectedModel, index)}
                onSetCover={(index) => setModelCover(currentSelectedModel, index)}
              />

              <div className="marketAdminModelGrid">
                <ModelFact label={l("File nén", "Archive")} value={formatBytes(currentSelectedModel.fileSize)} detail={currentSelectedModel.archiveExt || "archive"} />
                <ModelFact label={l("Ảnh cover", "Cover image")} value={currentSelectedModel.coverImage?.driveFileId ? l("Đã gắn", "Attached") : l("Thiếu", "Missing")} detail={currentSelectedModel.coverImage?.fileName} />
                <ModelFact label="Drive metadata" value={`Revision ${currentSelectedModel.metadataRevision || 0}`} detail={currentSelectedModel.metadataFileName || l("Thiếu metadata", "Missing metadata")} />
                <ModelFact label={l("Đồng bộ", "Sync")} value={currentSelectedModel.syncStatus || "missing"} detail={currentSelectedModel.syncError || formatDate(currentSelectedModel.lastDriveScanAt)} />
                <ModelFact label="Search index" value={currentSelectedModel.discoveryStatus || "pending"} detail={currentSelectedModel.discoveryError || formatDate(currentSelectedModel.discoveryIndexedAt)} />
              </div>

              <section className="marketAdminEditSection">
                <EditSectionTitle
                  icon={ListChecks}
                  title={l("Metadata trên Drive", "Metadata on Drive")}
                />
                <div className="marketAdminFieldGrid">
                  <label>
                    <span>{isScene ? l("Mã scene", "Scene ID") : l("Mã model", "Model ID")}</span>
                    <input value={selectedMetadataForm.sourceModelId} disabled />
                  </label>
                  <label>
                    <span>{isScene ? l("Tên scene", "Scene name") : l("Tên model", "Model name")}</span>
                    <input value={selectedMetadataForm.title} onChange={(event) => updateMetadata(currentSelectedModel, "title", event.target.value)} />
                  </label>
                  <label>
                    <span>{l("Quyền tải", "Download access")}</span>
                    <select value={selectedMetadataForm.accessType} onChange={(event) => updateMetadata(currentSelectedModel, "accessType", event.target.value)}>
                      <option value="free">Free</option>
                      <option value="member">Pro</option>
                    </select>
                  </label>
                  <CategorySelect
                    value={selectedMetadataForm.sourceCategoryId}
                    categories={categoryTree}
                    onChange={(value) => updateMetadata(currentSelectedModel, "sourceCategoryId", value)}
                    language={language}
                  />
                  <label>
                    <span>{l("Renderer hiển thị", "Display renderer")}</span>
                    <select value={selectedMetadataForm.renderer} onChange={(event) => updateMetadata(currentSelectedModel, "renderer", event.target.value)}>
                      <option value="">{l("Chọn renderer", "Select renderer")}</option>
                      {(filterOptions.render || []).map((option) => (
                        <option key={option.value} value={option.label || option.value}>{optionLabel(option, language)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>SHA-256 archive</span>
                    <input
                      value={selectedMetadataForm.sha256}
                      maxLength={64}
                      spellCheck="false"
                      placeholder={l("64 ký tự hex", "64 hexadecimal characters")}
                      onChange={(event) => updateMetadata(currentSelectedModel, "sha256", event.target.value.trim().toLowerCase())}
                    />
                  </label>
                </div>
                <div className="marketAdminFacetGrid">
                  {Object.entries(facetOptionMap).filter(([field]) => !isScene || ["styles", "renderers", "platforms"].includes(field)).map(([field, filterKey]) => (
                    <FacetPicker
                      key={field}
                      field={field}
                      value={selectedMetadataForm[field]}
                      options={filterOptions[filterKey] || []}
                      onChange={(value) => updateMetadata(currentSelectedModel, field, value)}
                      language={language}
                    />
                  ))}
                </div>
                <div className="marketAdminSyncActions">
                  <button type="button" className="primaryButton" disabled={metadataSavingId === currentSelectedModel._id} onClick={() => saveModelMetadata(currentSelectedModel)}>
                    <Save size={16} /> {metadataSavingId === currentSelectedModel._id ? l("Đang ghi Drive...", "Writing to Drive...") : l("Lưu metadata lên Drive", "Save metadata to Drive")}
                  </button>
                </div>
              </section>

              <section className="marketAdminEditSection">
                <EditSectionTitle
                  icon={Eye}
                  title={l("Trạng thái hiển thị", "Publishing state")}
                />
                <div className="marketAdminQuickControls">
                  <label>
                    <span>Slug web</span>
                    <input value={selectedOperationalForm.slug} onChange={(event) => updateModelState(currentSelectedModel, "slug", event.target.value)} />
                  </label>
                  <label>
                    <span>{l("Mong muốn xuất bản", "Desired publishing state")}</span>
                    <select value={String(selectedOperationalForm.desiredPublished)} onChange={(event) => updateModelState(currentSelectedModel, "desiredPublished", event.target.value === "true")}>
                      <option value="true">{l("Cho phép xuất bản", "Allow publishing")}</option>
                      <option value="false">{l("Bản nháp", "Draft")}</option>
                    </select>
                  </label>
                  <ModelFact label={l("Trạng thái thực tế", "Actual state")} value={currentSelectedModel.isPublished ? l("Đang online", "Online") : l("Đang offline", "Offline")} detail={(currentSelectedModel.publicationBlockers || []).join(", ") || l("Không có blocker", "No blockers")} />
                </div>
                <div className="marketAdminSyncActions">
                  <button type="button" className="smallButton" onClick={() => verifyArchiveFile(currentSelectedModel)} disabled={verifyingFileId === currentSelectedModel._id || !currentSelectedModel.driveFileId}>
                    <CheckCircle2 size={16} /> {verifyingFileId === currentSelectedModel._id ? l("Đang kiểm tra...", "Checking...") : l("Kiểm tra file", "Verify file")}
                  </button>
                  <button type="button" className="smallButton" onClick={() => rescanDriveFolder(currentSelectedModel)} disabled={!currentSelectedModel.driveFolderId}>
                    <RefreshCw size={16} /> {l("Đồng bộ lại folder này", "Resync this folder")}
                  </button>
                  <button type="button" className="primaryButton" onClick={() => saveModelState(currentSelectedModel)}>
                    <Save size={16} /> {l("Lưu trạng thái web", "Save web state")}
                  </button>
                </div>
              </section>

            </>
          )}
        </div>
      )}

      {activeTab === "taxonomy" && (
        <AdminMarketplaceTaxonomy
          assetType={assetType}
          language={language}
          onChanged={() => loadTaxonomy().catch((err) => setError(err.message))}
        />
      )}

      {deleteDialog && (
        <div className="marketAdminConflictOverlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeDeleteDialog()}>
          <section className="marketAdminDeleteDialog" role="dialog" aria-modal="true" aria-labelledby="market-delete-title">
            <header>
              <div>
                <h3 id="market-delete-title"><Trash2 size={18} /> {deleteDialog.mode === "permanent" ? l("Xóa vĩnh viễn", "Delete permanently") : l("Đưa vào thùng rác", "Move to trash")}</h3>
                <p>{deleteDialog.mode === "permanent"
                  ? l("Folder Drive sẽ bị xóa vĩnh viễn và không thể khôi phục. Lịch sử tải vẫn được giữ.", "The Drive folder will be permanently deleted and cannot be restored. Download history is retained.")
                  : l("Tài nguyên sẽ offline ngay, phiên tải đang hoạt động bị thu hồi và folder Drive được giữ trong thùng rác 30 ngày.", "The asset goes offline immediately, active sessions are revoked, and the Drive folder stays in trash for 30 days.")}</p>
              </div>
              <button type="button" className="iconButton" onClick={closeDeleteDialog} aria-label={l("Đóng", "Close")}><X size={18} /></button>
            </header>
            <label>
              <span>{l("Nhập chính xác tên để xác nhận", "Type the exact name to confirm")}</span>
              <strong>{deleteDialog.model.title}</strong>
              <input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={deleteDialog.model.title} />
            </label>
            <footer>
              <button type="button" className="smallButton" onClick={closeDeleteDialog} disabled={deleteRunning}>{l("Hủy", "Cancel")}</button>
              <button type="button" className="primaryButton danger" onClick={confirmDeleteAction} disabled={deleteRunning || deleteConfirmation !== deleteDialog.model.title}>
                <Trash2 size={16} /> {deleteRunning ? l("Đang xử lý...", "Processing...") : deleteDialog.mode === "permanent" ? l("Xóa vĩnh viễn", "Delete permanently") : l("Đưa vào thùng rác", "Move to trash")}
              </button>
            </footer>
          </section>
        </div>
      )}

      {metadataConflict && (
        <div className="marketAdminConflictOverlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMetadataConflict(null);
        }}>
          <section className="marketAdminConflictDialog" role="dialog" aria-modal="true" aria-labelledby="metadata-conflict-title">
            <header>
              <div>
                <h3 id="metadata-conflict-title"><GitCompareArrows size={18} /> {l("Metadata đã thay đổi trên Drive", "Metadata changed on Drive")}</h3>
                <p>{l("Bản đang sửa chưa được ghi đè. Hãy nạp bản Drive mới nhất, kiểm tra rồi lưu lại.", "Your edits were not overwritten. Load the latest Drive version, review it, then save again.")}</p>
              </div>
              <button type="button" className="iconButton" onClick={() => setMetadataConflict(null)} aria-label={l("Đóng", "Close")}>
                <X size={18} />
              </button>
            </header>
            <div className="marketAdminConflictList">
              {(metadataConflict.diff || []).map((item) => (
                <div key={item.field}>
                  <strong>{item.field}</strong>
                  <span><b>{l("Bản đang sửa", "Current edit")}</b>{Array.isArray(item.before) ? item.before.join(", ") : String(item.before ?? "")}</span>
                  <span><b>{l("Bản trên Drive", "Drive version")}</b>{Array.isArray(item.after) ? item.after.join(", ") : String(item.after ?? "")}</span>
                </div>
              ))}
              {!metadataConflict.diff?.length && <p>{l("Drive version đã đổi nhưng các trường metadata hiện không khác.", "The Drive version changed, but the metadata fields currently match.")}</p>}
            </div>
            <footer>
              <button type="button" className="smallButton" onClick={() => setMetadataConflict(null)}>{l("Giữ form đang sửa", "Keep current form")}</button>
              <button type="button" className="primaryButton" onClick={loadConflictVersion}>{l("Nạp bản mới nhất từ Drive", "Load latest Drive version")}</button>
            </footer>
          </section>
        </div>
      )}

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
