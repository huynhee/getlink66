import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Eye,
  EyeOff,
  FileArchive,
  Image as ImageIcon,
  ListChecks,
  Package,
  Pencil,
  RefreshCw,
  Save,
  Search,
  UploadCloud,
} from "lucide-react";
import { api } from "../api.js";

const emptyImportForm = {
  sourceModelId: "",
  sourceSlug: "",
  sourceCategoryId: "",
  title: "",
  slug: "",
  styles: "",
  renderers: "",
  forms: "",
  colors: "",
  materials: "",
  renderer: "",
  sizeText: "",
  accessType: "member",
  isPublished: true,
};

const emptyDriveImportForm = {
  rootFolderId: "",
  pageToken: "",
  limit: "20",
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

const metadataStatusLabels = {
  all: "Tất cả metadata",
  complete: "Đủ metadata",
  incomplete: "Thiếu metadata",
};

const accessLabels = {
  all: "Tất cả quyền",
  free: "Free",
  member: "Pro",
};

const publishLabels = {
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
};

const facetOptionMap = {
  styles: "style",
  renderers: "render",
  forms: "form",
  colors: "color",
  materials: "material",
};

const facetLabelsVi = {
  classic: "Cổ điển",
  modern: "Hiện đại",
  ethnic: "Truyền thống",
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
  if (["failed", "incomplete", "unpublished", "draft", "expired", "revoked"].includes(value)) return "error";
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

function optionLabel(option) {
  return facetLabelsVi[option.value] || option.label || option.value;
}

function categoryValue(category = {}) {
  return String(category.sourceCategoryId || category.slug || category._id || "");
}

function categoryLabel(category = {}) {
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

function previewLines(model) {
  return (model.previewImages || [])
    .filter((item) => item.driveFileId)
    .map((item) => [
      item.driveFileId || "",
      item.fileName || "",
      item.width || "",
      item.height || "",
      item.size || "",
      item.alt || "",
    ].join("|"))
    .join("\n");
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
      {detail && <small>{detail}</small>}
    </div>
  );
}

function MissingFields({ fields = [] }) {
  if (!fields.length) return null;
  return (
    <div className="marketAdminMissing">
      <AlertTriangle size={15} />
      <strong>Thiếu dữ liệu:</strong>
      {fields.map((field) => <span key={field}>{missingLabels[field] || field}</span>)}
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

function CategorySelect({ value, categories = [], onChange }) {
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
        <span>Danh mục mẹ</span>
        <select value={parentValue} onChange={(event) => handleParentChange(event.target.value)}>
          <option value="">Chọn danh mục mẹ</option>
          {categories.map((category) => (
            <option key={category._id || category.slug} value={categoryValue(category)}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
      </label>
      {children.length > 0 && (
        <label>
          <span>Danh mục con</span>
          <select value={selectedChildValue} onChange={(event) => onChange(event.target.value)}>
            <option value="">Chọn danh mục con</option>
            {children.map((category) => (
              <option key={category._id || category.slug} value={categoryValue(category)}>
                {categoryLabel(category)}
              </option>
            ))}
          </select>
        </label>
      )}
      {value && !findCategoryByValue(categories, value) && (
        <small>Giá trị hiện tại chưa có trong cây danh mục: {value}</small>
      )}
    </div>
  );
}

function FacetPicker({ field, value, options = [], onChange }) {
  const selected = csvToValues(value);

  function toggle(nextValue) {
    const next = selected.includes(nextValue)
      ? selected.filter((item) => item !== nextValue)
      : [...selected, nextValue];
    onChange(valuesToCsv(next));
  }

  return (
    <div className={`marketAdminFacetPicker ${field}`}>
      <span>{facetTitles[field]}</span>
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
              {optionLabel(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelSummary({ model, selected, onEdit }) {
  const state = publicState(model);
  const missing = model.metadataMissingFields || [];
  return (
    <article className={`marketAdminItem ${state.key} ${selected ? "selected" : ""}`}>
      <div className="marketAdminModelHead">
        <div className="marketAdminModelIcon">
          <Package size={22} />
        </div>
        <div className="marketAdminModelTitle">
          <strong>{model.title}</strong>
          <span>{model.slug}</span>
        </div>
        <div className="marketAdminBadges">
          <span className={`badge ${statusClass(state.key)}`}>{state.label}</span>
          <span className={`badge ${statusClass(model.metadataStatus)}`}>
            {metadataStatusLabels[model.metadataStatus] || "Thiếu metadata"}
          </span>
          <span className={`badge ${statusClass(model.fileStatus)}`}>
            {fileStatusLabels[model.fileStatus] || model.fileStatus || "Thiếu file"}
          </span>
          <span className="badge">{accessLabels[model.accessType] || model.accessType}</span>
        </div>
      </div>

      <MissingFields fields={missing} />

      <div className="marketAdminModelGrid">
        <ModelFact label="File nén" value={formatBytes(model.fileSize)} detail={model.archiveExt || "archive"} />
        <ModelFact label="Ảnh cover" value={model.coverImage?.driveFileId ? "Đã gắn" : "Thiếu"} detail={model.coverImage?.fileName} />
        <ModelFact label="Preview" value={`${model.previewImages?.length || 0} ảnh`} detail={model.metadataFileName || "metadata"} />
        <ModelFact label="Lần quét Drive" value={formatDate(model.lastDriveScanAt)} detail={model.driveFolderName || model.source?.slug} />
      </div>

      <div className="marketAdminModelActions">
        <button type="button" className="primaryButton" onClick={() => onEdit(model)}>
          <Pencil size={16} /> Chỉnh sửa model
        </button>
      </div>
    </article>
  );
}

export default function AdminMarketplace() {
  const [activeTab, setActiveTab] = useState("import");
  const [models, setModels] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState("");
  const [fileStatus, setFileStatus] = useState("all");
  const [accessType, setAccessType] = useState("all");
  const [published, setPublished] = useState("all");
  const [metadataStatus, setMetadataStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [downloads, setDownloads] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [categoryTree, setCategoryTree] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [importForm, setImportForm] = useState(emptyImportForm);
  const [driveImportForm, setDriveImportForm] = useState(emptyDriveImportForm);
  const [attachById, setAttachById] = useState({});
  const [assetById, setAssetById] = useState({});
  const [metadataById, setMetadataById] = useState({});
  const [selectedModel, setSelectedModel] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const currentSelectedModel = useMemo(() => {
    if (!selectedModel?._id) return null;
    return models.find((model) => model._id === selectedModel._id) || selectedModel;
  }, [models, selectedModel]);

  const activeFilterCount = useMemo(() => {
    return [fileStatus, accessType, published, metadataStatus].filter((item) => item !== "all").length +
      (search.trim() ? 1 : 0);
  }, [fileStatus, accessType, published, metadataStatus, search]);

  function updateImport(field, value) {
    setImportForm((current) => ({ ...current, [field]: value }));
  }

  function updateDriveImport(field, value) {
    setDriveImportForm((current) => ({ ...current, [field]: value }));
  }

  function selectForEdit(model) {
    setSelectedModel(model);
    setActiveTab("edit");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function attachForm(model) {
    return attachById[model._id] || {
      storageProvider: model.storageProvider || "google_drive",
      storageKey: model.storageKey || "",
      driveFileId: model.driveFileId || "",
      telegramFileRef: model.telegramFileRef || "",
      archiveExt: model.archiveExt || "zip",
      fileSize: model.fileSize || "",
      sha256: model.sha256 || "",
      fileStatus: model.fileStatus === "ready" ? "ready" : "pending_upload",
    };
  }

  function updateAttach(model, field, value) {
    setAttachById((current) => ({
      ...current,
      [model._id]: { ...attachForm(model), [field]: value },
    }));
  }

  function assetForm(model) {
    return assetById[model._id] || {
      coverDriveFileId: model.coverImage?.driveFileId || "",
      coverFileName: model.coverImage?.fileName || "",
      coverWidth: model.coverImage?.width || "",
      coverHeight: model.coverImage?.height || "",
      coverSize: model.coverImage?.size || "",
      coverAlt: model.coverImage?.alt || "",
      previewImages: previewLines(model),
      metadataDriveFileId: model.metadataDriveFileId || "",
      metadataFileName: model.metadataFileName || "",
      metadataSize: model.metadataSize || "",
    };
  }

  function updateAsset(model, field, value) {
    setAssetById((current) => ({
      ...current,
      [model._id]: { ...assetForm(model), [field]: value },
    }));
  }

  function metadataForm(model) {
    return metadataById[model._id] || {
      title: model.title || "",
      slug: model.slug || "",
      sourceSlug: model.source?.slug || "",
      sourceCategoryId: model.categorySourceId || model.source?.categoryId || "",
      styles: (model.styles || []).join(", "),
      renderers: (model.renderers || []).join(", "),
      forms: (model.forms || []).join(", "),
      colors: (model.colors || []).join(", "),
      materials: (model.materials || []).join(", "),
      renderer: model.renderer || "",
      sizeText: model.sizeText || "",
    };
  }

  function updateMetadata(model, field, value) {
    setMetadataById((current) => ({
      ...current,
      [model._id]: { ...metadataForm(model), [field]: value },
    }));
  }

  async function loadModels(nextPage = page) {
    const query = new URLSearchParams({ page: String(nextPage), fileStatus, accessType, published, metadataStatus });
    if (search.trim()) query.set("search", search.trim());
    const [modelRes, statsRes, downloadRes, sessionRes] = await Promise.all([
      api(`/api/admin/marketplace/models?${query.toString()}`),
      api("/api/admin/marketplace/stats"),
      api("/api/admin/marketplace/downloads?limit=8"),
      api("/api/admin/marketplace/download-sessions?limit=8"),
    ]);
    setModels(modelRes.models || []);
    setPagination(modelRes.pagination || { page: 1, totalPages: 1, total: 0 });
    setStats(statsRes.stats || null);
    setDownloads(downloadRes.downloads || []);
    setSessions(sessionRes.sessions || []);
  }

  async function loadTaxonomy() {
    const [categoryRes, filterRes] = await Promise.all([
      api("/api/marketplace/categories"),
      api("/api/marketplace/filters"),
    ]);
    setCategoryTree(categoryRes.categories || []);
    setFilterOptions(filterRes.filters || {});
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadModels(1).catch((err) => setError(err.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search, fileStatus, accessType, published, metadataStatus]);

  useEffect(() => {
    loadTaxonomy().catch((err) => setError(err.message));
  }, []);

  async function importModel(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      if (categoryHasChildren(categoryTree, importForm.sourceCategoryId)) {
        setError("Danh mục đang chọn còn danh mục con. Hãy chọn danh mục con trước khi import.");
        return;
      }
      const data = await api("/api/admin/marketplace/models/import-metadata", {
        method: "POST",
        body: JSON.stringify(importForm),
      });
      setImportForm(emptyImportForm);
      setMessage(`Đã import ${data.model?.title || ""}`);
      await loadModels(1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function importDriveFolder(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const data = await api("/api/admin/marketplace/import-drive-folder", {
        method: "POST",
        body: JSON.stringify({
          rootFolderId: driveImportForm.rootFolderId,
          pageToken: driveImportForm.pageToken,
          limit: Number(driveImportForm.limit || 20),
          accessType: driveImportForm.accessType,
          isPublished: driveImportForm.isPublished,
        }),
      });
      setLastScan(data);
      setDriveImportForm((current) => ({ ...current, pageToken: data.nextPageToken || "" }));
      setMessage(
        `Đã quét Drive: ${data.createdCount || 0} tạo mới, ` +
        `${data.updatedCount || 0} cập nhật, ${data.unchangedCount || 0} không đổi` +
        (data.hasMore ? ". Đã có token trang tiếp theo." : ". Đã hết dữ liệu."),
      );
      await loadModels(1);
    } catch (err) {
      setError(err.message);
    }
  }

  async function attachFile(model) {
    setMessage("");
    setError("");
    try {
      const form = attachForm(model);
      const data = await api(`/api/admin/marketplace/models/${model._id}/attach-file`, {
        method: "POST",
        body: JSON.stringify({
          ...form,
          fileSize: Number(form.fileSize || 0),
        }),
      });
      setSelectedModel(data.model || model);
      setMessage(`Đã gắn file cho ${data.model?.title || model.title}`);
      await loadModels(page);
    } catch (err) {
      setError(err.message);
    }
  }

  async function attachAssets(model) {
    setMessage("");
    setError("");
    try {
      const form = assetForm(model);
      const data = await api(`/api/admin/marketplace/models/${model._id}/attach-assets`, {
        method: "POST",
        body: JSON.stringify({
          coverDriveFileId: form.coverDriveFileId,
          coverFileName: form.coverFileName,
          coverWidth: Number(form.coverWidth || 0),
          coverHeight: Number(form.coverHeight || 0),
          coverSize: Number(form.coverSize || 0),
          coverAlt: form.coverAlt,
          previewImages: form.previewImages,
          metadataDriveFileId: form.metadataDriveFileId,
          metadataFileName: form.metadataFileName,
          metadataSize: Number(form.metadataSize || 0),
        }),
      });
      setSelectedModel(data.model || model);
      setMessage(`Đã gắn ảnh/metadata cho ${data.model?.title || model.title}`);
      await loadModels(page);
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveModelMetadata(model) {
    setMessage("");
    setError("");
    try {
      const form = metadataForm(model);
      if (categoryHasChildren(categoryTree, form.sourceCategoryId)) {
        setError("Danh mục đang chọn còn danh mục con. Hãy chọn danh mục con trước khi lưu.");
        return;
      }
      const data = await api(`/api/admin/marketplace/models/${model._id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: form.title,
          slug: form.slug,
          sourceSlug: form.sourceSlug,
          sourceCategoryId: form.sourceCategoryId,
          styles: form.styles,
          renderers: form.renderers,
          forms: form.forms,
          colors: form.colors,
          materials: form.materials,
          renderer: form.renderer,
          sizeText: form.sizeText,
        }),
      });
      setSelectedModel(data.model || model);
      setMetadataById((current) => {
        const next = { ...current };
        delete next[model._id];
        return next;
      });
      setMessage(`Đã cập nhật phân loại cho ${data.model?.title || model.title}`);
      await loadModels(page);
    } catch (err) {
      setError(err.message);
    }
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
      const data = await api(`/api/admin/marketplace/models/${model._id}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setSelectedModel(data.model || model);
      await loadModels(page);
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
  }

  function goToPage(nextPage) {
    const target = Math.min(Math.max(1, Number(nextPage) || 1), Math.max(1, pagination.totalPages || 1));
    setPage(target);
    loadModels(target).catch((err) => setError(err.message));
  }

  const selectedState = currentSelectedModel ? publicState(currentSelectedModel) : null;
  const selectedAttachForm = currentSelectedModel ? attachForm(currentSelectedModel) : null;
  const selectedAssetForm = currentSelectedModel ? assetForm(currentSelectedModel) : null;
  const selectedMetadataForm = currentSelectedModel ? metadataForm(currentSelectedModel) : null;

  return (
    <section className="panel adminMarketplace">
      <div className="marketAdminHeader">
        <div>
          <h2><Database size={20} /> Quản lý model</h2>
          <p className="muted">Google Drive lưu file nén, ảnh preview và metadata gốc. Mongo chỉ lưu dữ liệu nhẹ để tìm kiếm, publish và ghi lịch sử.</p>
        </div>
        <button type="button" className="smallButton" onClick={cleanupRawMetadata}>
          <RefreshCw size={15} /> Dọn dữ liệu Mongo
        </button>
      </div>

      {stats && (
        <div className="marketAdminKpis">
          <KpiCard icon={Package} label="Tổng model" value={stats.models} />
          <KpiCard icon={ListChecks} label="Đủ metadata" value={stats.completeMetadata} tone="success" />
          <KpiCard icon={AlertTriangle} label="Thiếu metadata" value={stats.incompleteMetadata} tone="warning" />
          <KpiCard icon={CheckCircle2} label="File sẵn sàng" value={stats.ready} tone="success" />
          <KpiCard icon={AlertTriangle} label="Thiếu file" value={stats.missing} tone="warning" />
          <KpiCard icon={EyeOff} label="Bản nháp" value={stats.draft} />
        </div>
      )}

      <div className="marketAdminTabs" role="tablist" aria-label="Khu quản lý model">
        {[
          ["import", "Import / đồng bộ", UploadCloud],
          ["search", "Tìm kiếm model", Search],
          ["edit", "Chỉnh sửa model", Pencil],
          ["logs", "Nhật ký tải", Clock3],
        ].map(([key, label, Icon]) => (
          <button
            type="button"
            key={key}
            className={activeTab === key ? "active" : ""}
            onClick={() => setActiveTab(key)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "import" && (
        <div className="marketAdminWorkbench single">
          <form className="marketAdminForm marketAdminSyncPanel" onSubmit={importDriveFolder}>
            <div className="marketAdminPanelTitle">
              <h3>Đồng bộ Google Drive</h3>
              <span className="badge pending">Quét theo batch</span>
            </div>
            <div className="marketAdminFieldGrid">
              <label>
                <span>Thư mục models trên Drive</span>
                <input
                  value={driveImportForm.rootFolderId}
                  onChange={(event) => updateDriveImport("rootFolderId", event.target.value)}
                  placeholder="Drive folder URL / ID"
                  required
                />
              </label>
              <label>
                <span>Token trang tiếp theo</span>
                <input
                  value={driveImportForm.pageToken}
                  onChange={(event) => updateDriveImport("pageToken", event.target.value)}
                  placeholder="Tự điền sau mỗi batch"
                />
              </label>
              <label>
                <span>Số folder mỗi batch</span>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={driveImportForm.limit}
                  onChange={(event) => updateDriveImport("limit", event.target.value)}
                />
              </label>
              <label>
                <span>Quyền tải mặc định</span>
                <select value={driveImportForm.accessType} onChange={(event) => updateDriveImport("accessType", event.target.value)}>
                  <option value="free">Free</option>
                  <option value="member">Pro</option>
                </select>
              </label>
            </div>
            <div className="marketAdminSyncActions">
              <label className="checkboxInline">
                <input
                  type="checkbox"
                  checked={driveImportForm.isPublished}
                  onChange={(event) => updateDriveImport("isPublished", event.target.checked)}
                />
                Xuất bản nếu model đủ metadata
              </label>
              <button type="button" className="smallButton" onClick={() => updateDriveImport("pageToken", "")}>
                Reset token
              </button>
              <button className="primaryButton">
                <UploadCloud size={17} /> {driveImportForm.pageToken ? "Quét batch tiếp theo" : "Quét batch đầu tiên"}
              </button>
            </div>
            {lastScan && (
              <div className="marketAdminScanResult">
                <span>{lastScan.scannedFolders || 0} đã quét</span>
                <span>{lastScan.createdCount || 0} tạo mới</span>
                <span>{lastScan.updatedCount || 0} cập nhật</span>
                <span>{lastScan.unchangedCount || 0} không đổi</span>
                <span>{lastScan.hasMore ? "Còn batch tiếp" : "Đã hết"}</span>
              </div>
            )}
          </form>

          <details className="marketAdminForm marketAdminManualImport">
            <summary><Save size={16} /> Import metadata thủ công</summary>
            <form onSubmit={importModel}>
              <div className="marketAdminFieldGrid">
                <label><span>Mã catalog</span><input value={importForm.sourceModelId} onChange={(event) => updateImport("sourceModelId", event.target.value)} required /></label>
                <label><span>Tên model</span><input value={importForm.title} onChange={(event) => updateImport("title", event.target.value)} required /></label>
                <label><span>Slug web</span><input value={importForm.slug} onChange={(event) => updateImport("slug", event.target.value)} placeholder="outdoor-kitchen-145" /></label>
                  <CategorySelect
                    value={importForm.sourceCategoryId}
                    categories={categoryTree}
                    onChange={(value) => updateImport("sourceCategoryId", value)}
                  />
                <label><span>Slug nguồn</span><input value={importForm.sourceSlug} onChange={(event) => updateImport("sourceSlug", event.target.value)} /></label>
                <label><span>Dung lượng hiển thị</span><input value={importForm.sizeText} onChange={(event) => updateImport("sizeText", event.target.value)} placeholder="25 MB" /></label>
                <label><span>Renderer hiển thị</span><select value={importForm.renderer} onChange={(event) => updateImport("renderer", event.target.value)}>
                  <option value="">Chọn renderer</option>
                  {(filterOptions.render || []).map((option) => (
                    <option key={option.value} value={option.label || option.value}>{optionLabel(option)}</option>
                  ))}
                </select></label>
                <label><span>Quyền tải</span><select value={importForm.accessType} onChange={(event) => updateImport("accessType", event.target.value)}>
                  <option value="free">Free</option>
                  <option value="member">Pro</option>
                </select></label>
              </div>
              <div className="marketAdminFacetGrid">
                {Object.entries(facetOptionMap).map(([field, filterKey]) => (
                  <FacetPicker
                    key={field}
                    field={field}
                    value={importForm[field]}
                    options={filterOptions[filterKey] || []}
                    onChange={(value) => updateImport(field, value)}
                  />
                ))}
              </div>
              <div className="marketAdminSyncActions">
                <label className="checkboxInline">
                  <input type="checkbox" checked={importForm.isPublished} onChange={(event) => updateImport("isPublished", event.target.checked)} />
                  Xuất bản nếu đủ metadata
                </label>
                <button className="primaryButton"><Save size={17} /> Import / cập nhật</button>
              </div>
            </form>
          </details>
        </div>
      )}

      {activeTab === "search" && (
        <>
          <div className="adminTableToolbar marketAdminToolbar">
            <label className="adminSearchField">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm model theo tên hoặc slug..." />
            </label>
            <select value={metadataStatus} onChange={(event) => setMetadataStatus(event.target.value)}>
              <option value="all">Tất cả metadata</option>
              <option value="complete">Đủ metadata</option>
              <option value="incomplete">Thiếu metadata</option>
            </select>
            <select value={fileStatus} onChange={(event) => setFileStatus(event.target.value)}>
              <option value="all">Tất cả file</option>
              <option value="missing">Thiếu file</option>
              <option value="pending_upload">Chờ upload</option>
              <option value="ready">Sẵn sàng</option>
              <option value="failed">Lỗi file</option>
            </select>
            <select value={published} onChange={(event) => setPublished(event.target.value)}>
              <option value="all">Tất cả publish</option>
              <option value="published">Đã xuất bản</option>
              <option value="unpublished">Bản nháp</option>
            </select>
            <select value={accessType} onChange={(event) => setAccessType(event.target.value)}>
              <option value="all">Tất cả quyền</option>
              <option value="free">Free</option>
              <option value="member">Pro</option>
            </select>
            <span className={`marketFilterCount ${activeFilterCount ? "active" : ""}`}>{activeFilterCount}</span>
            {activeFilterCount > 0 && (
              <button type="button" className="smallButton" onClick={clearFilters}>Xóa lọc</button>
            )}
          </div>

          <div className="marketAdminList">
            {models.map((model) => (
              <ModelSummary
                key={model._id}
                model={model}
                selected={currentSelectedModel?._id === model._id}
                onEdit={selectForEdit}
              />
            ))}
            {!models.length && <p className="muted">Chưa có model phù hợp.</p>}
          </div>

          <div className="adminPagination">
            <button className="smallButton" disabled={pagination.page <= 1} onClick={() => goToPage(pagination.page - 1)}>Trước</button>
            <span>Trang {pagination.page}/{pagination.totalPages} - {pagination.total} model</span>
            <button className="smallButton" disabled={pagination.page >= pagination.totalPages} onClick={() => goToPage(pagination.page + 1)}>Sau</button>
          </div>
        </>
      )}

      {activeTab === "edit" && (
        <div className="marketAdminEditPanel">
          {!currentSelectedModel ? (
            <section className="marketAdminEmpty">
              <Package size={36} />
              <h3>Chưa chọn model</h3>
              <p>Vào tab Tìm kiếm model, chọn đúng model rồi bấm Chỉnh sửa model.</p>
              <button type="button" className="primaryButton" onClick={() => setActiveTab("search")}>
                <Search size={16} /> Đi tới tìm kiếm
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
                  <span className={`badge ${statusClass(selectedState.key)}`}>{selectedState.label}</span>
                  <span className={`badge ${statusClass(currentSelectedModel.metadataStatus)}`}>
                    {metadataStatusLabels[currentSelectedModel.metadataStatus] || "Thiếu metadata"}
                  </span>
                  <span className={`badge ${statusClass(currentSelectedModel.fileStatus)}`}>
                    {fileStatusLabels[currentSelectedModel.fileStatus] || currentSelectedModel.fileStatus}
                  </span>
                </div>
              </div>

              <MissingFields fields={currentSelectedModel.metadataMissingFields || []} />

              <div className="marketAdminModelGrid">
                <ModelFact label="File nén" value={formatBytes(currentSelectedModel.fileSize)} detail={currentSelectedModel.archiveExt || "archive"} />
                <ModelFact label="Ảnh cover" value={currentSelectedModel.coverImage?.driveFileId ? "Đã gắn" : "Thiếu"} detail={currentSelectedModel.coverImage?.fileName} />
                <ModelFact label="Preview" value={`${currentSelectedModel.previewImages?.length || 0} ảnh`} detail={currentSelectedModel.metadataFileName || "metadata"} />
                <ModelFact label="Lần quét Drive" value={formatDate(currentSelectedModel.lastDriveScanAt)} detail={currentSelectedModel.driveFolderName || currentSelectedModel.source?.slug} />
              </div>

              <section className="marketAdminEditSection">
                <EditSectionTitle
                  icon={ListChecks}
                  title="Thông tin phân loại và bộ lọc"
                />
                <div className="marketAdminFieldGrid">
                  <label>
                    <span>Tên model</span>
                    <small>Tên hiển thị trên web.</small>
                    <input value={selectedMetadataForm.title} onChange={(event) => updateMetadata(currentSelectedModel, "title", event.target.value)} />
                  </label>
                  <label>
                    <span>Slug web</span>
                    <small>URL nội bộ của trang model.</small>
                    <input value={selectedMetadataForm.slug} onChange={(event) => updateMetadata(currentSelectedModel, "slug", event.target.value)} />
                  </label>
                  <label>
                    <span>Slug nguồn</span>
                    <small>Mã đối chiếu folder/metadata Drive.</small>
                    <input value={selectedMetadataForm.sourceSlug} onChange={(event) => updateMetadata(currentSelectedModel, "sourceSlug", event.target.value)} />
                  </label>
                  <CategorySelect
                    value={selectedMetadataForm.sourceCategoryId}
                    categories={categoryTree}
                    onChange={(value) => updateMetadata(currentSelectedModel, "sourceCategoryId", value)}
                  />
                  <label>
                    <span>Renderer hiển thị</span>
                    <small>Dòng renderer hiện ở card/detail.</small>
                    <select value={selectedMetadataForm.renderer} onChange={(event) => updateMetadata(currentSelectedModel, "renderer", event.target.value)}>
                      <option value="">Chọn renderer</option>
                      {(filterOptions.render || []).map((option) => (
                        <option key={option.value} value={option.label || option.value}>{optionLabel(option)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Dung lượng hiển thị</span>
                    <small>Text nhẹ cho UI, ví dụ 25 MB.</small>
                    <input value={selectedMetadataForm.sizeText} onChange={(event) => updateMetadata(currentSelectedModel, "sizeText", event.target.value)} placeholder="25 MB" />
                  </label>
                </div>
                <div className="marketAdminFacetGrid">
                  {Object.entries(facetOptionMap).map(([field, filterKey]) => (
                    <FacetPicker
                      key={field}
                      field={field}
                      value={selectedMetadataForm[field]}
                      options={filterOptions[filterKey] || []}
                      onChange={(value) => updateMetadata(currentSelectedModel, field, value)}
                    />
                  ))}
                </div>
                <div className="marketAdminSyncActions">
                  <button type="button" className="primaryButton" onClick={() => saveModelMetadata(currentSelectedModel)}>
                    <Save size={16} /> Lưu phân loại / bộ lọc
                  </button>
                </div>
              </section>

              <section className="marketAdminEditSection">
                <EditSectionTitle
                  icon={Eye}
                  title="Trạng thái hiển thị"
                />
                <div className="marketAdminQuickControls">
                  <label>
                    <span>Quyền tải</span>
                    <small>Free ai cũng tải; Pro cần gói đang hoạt động.</small>
                    <select value={accessControlValue(currentSelectedModel.accessType)} onChange={(event) => quickUpdate(currentSelectedModel, { accessType: event.target.value })}>
                      <option value="free">Free</option>
                      <option value="member">Pro</option>
                    </select>
                  </label>
                  <label>
                    <span>Publish</span>
                    <small>Bật/tắt model trên trang public.</small>
                    <select value={String(Boolean(currentSelectedModel.isPublished))} onChange={(event) => quickUpdate(currentSelectedModel, { isPublished: event.target.value === "true" })}>
                      <option value="true">Đã xuất bản</option>
                      <option value="false">Bản nháp</option>
                    </select>
                  </label>
                  <label>
                    <span>Trạng thái file</span>
                    <small>Ready mới tạo được phiên tải.</small>
                    <select value={currentSelectedModel.fileStatus} onChange={(event) => quickUpdate(currentSelectedModel, { fileStatus: event.target.value })}>
                      <option value="missing">Thiếu file</option>
                      <option value="pending_upload">Chờ upload</option>
                      <option value="ready">Sẵn sàng</option>
                      <option value="failed">Lỗi file</option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="marketAdminEditSection">
                <EditSectionTitle
                  icon={FileArchive}
                  title="File nén tải về"
                />
                <div className="marketAttachGrid">
                  <label>
                    <span>Storage</span>
                    <small>Nơi lưu file nén chính.</small>
                    <select value={selectedAttachForm.storageProvider} onChange={(event) => updateAttach(currentSelectedModel, "storageProvider", event.target.value)}>
                      <option value="google_drive">Google Drive</option>
                      <option value="b2">Backblaze B2</option>
                      <option value="r2">Cloudflare R2</option>
                      <option value="local">Local</option>
                      <option value="telegram">Telegram</option>
                    </select>
                  </label>
                  <label>
                    <span>Drive file ID</span>
                    <small>ID file archive trên Google Drive.</small>
                    <input value={selectedAttachForm.driveFileId} onChange={(event) => updateAttach(currentSelectedModel, "driveFileId", event.target.value)} placeholder="Drive file ID của file nén" />
                  </label>
                  <label>
                    <span>Storage key</span>
                    <small>Dùng cho R2/B2/local sau này.</small>
                    <input value={selectedAttachForm.storageKey} onChange={(event) => updateAttach(currentSelectedModel, "storageKey", event.target.value)} placeholder="Storage key" />
                  </label>
                  <label>
                    <span>Đuôi file</span>
                    <small>zip, rar hoặc 7z.</small>
                    <input value={selectedAttachForm.archiveExt} onChange={(event) => updateAttach(currentSelectedModel, "archiveExt", event.target.value)} placeholder="zip / rar / 7z" />
                  </label>
                  <label>
                    <span>Dung lượng</span>
                    <small>Số byte của file nén.</small>
                    <input type="number" value={selectedAttachForm.fileSize} onChange={(event) => updateAttach(currentSelectedModel, "fileSize", event.target.value)} placeholder="Dung lượng byte" />
                  </label>
                  <label>
                    <span>SHA-256</span>
                    <small>Plugin dùng để verify file tải về.</small>
                    <input value={selectedAttachForm.sha256} onChange={(event) => updateAttach(currentSelectedModel, "sha256", event.target.value)} placeholder="SHA-256" />
                  </label>
                  <button type="button" className="smallButton" onClick={() => attachFile(currentSelectedModel)}>
                    <UploadCloud size={15} /> Gắn file nén
                  </button>
                </div>
              </section>

              <section className="marketAdminEditSection">
                <EditSectionTitle
                  icon={ImageIcon}
                  title="Ảnh cover, preview và metadata gốc"
                />
                <div className="marketAssetGrid">
                  <label>
                    <span>Cover Drive ID</span>
                    <small>Ảnh vuông cho card/grid.</small>
                    <input value={selectedAssetForm.coverDriveFileId} onChange={(event) => updateAsset(currentSelectedModel, "coverDriveFileId", event.target.value)} placeholder="Drive file ID của cover" />
                  </label>
                  <label>
                    <span>Tên cover</span>
                    <small>Ví dụ cover.jpg.</small>
                    <input value={selectedAssetForm.coverFileName} onChange={(event) => updateAsset(currentSelectedModel, "coverFileName", event.target.value)} placeholder="cover.jpg" />
                  </label>
                  <label>
                    <span>Rộng cover</span>
                    <small>Pixel chiều rộng.</small>
                    <input type="number" value={selectedAssetForm.coverWidth} onChange={(event) => updateAsset(currentSelectedModel, "coverWidth", event.target.value)} placeholder="Chiều rộng cover" />
                  </label>
                  <label>
                    <span>Cao cover</span>
                    <small>Pixel chiều cao.</small>
                    <input type="number" value={selectedAssetForm.coverHeight} onChange={(event) => updateAsset(currentSelectedModel, "coverHeight", event.target.value)} placeholder="Chiều cao cover" />
                  </label>
                  <label>
                    <span>Dung lượng cover</span>
                    <small>Số byte của ảnh cover.</small>
                    <input type="number" value={selectedAssetForm.coverSize} onChange={(event) => updateAsset(currentSelectedModel, "coverSize", event.target.value)} placeholder="Dung lượng cover" />
                  </label>
                  <label>
                    <span>Alt cover</span>
                    <small>Text thay thế cho ảnh.</small>
                    <input value={selectedAssetForm.coverAlt} onChange={(event) => updateAsset(currentSelectedModel, "coverAlt", event.target.value)} placeholder="Alt cover" />
                  </label>
                  <label className="marketAssetWide">
                    <span>Preview images</span>
                    <small>Mỗi dòng: driveFileId|fileName|width|height|size|alt.</small>
                    <textarea value={selectedAssetForm.previewImages} onChange={(event) => updateAsset(currentSelectedModel, "previewImages", event.target.value)} placeholder="previewDriveFileId|preview-01.jpg|width|height|size|alt" />
                  </label>
                  <label>
                    <span>Metadata Drive ID</span>
                    <small>ID file metadata.json.gz gốc.</small>
                    <input value={selectedAssetForm.metadataDriveFileId} onChange={(event) => updateAsset(currentSelectedModel, "metadataDriveFileId", event.target.value)} placeholder="Drive file ID metadata.json.gz" />
                  </label>
                  <label>
                    <span>Tên metadata</span>
                    <small>Thường là metadata.json.gz.</small>
                    <input value={selectedAssetForm.metadataFileName} onChange={(event) => updateAsset(currentSelectedModel, "metadataFileName", event.target.value)} placeholder="metadata.json.gz" />
                  </label>
                  <label>
                    <span>Dung lượng metadata</span>
                    <small>Số byte của file metadata.</small>
                    <input type="number" value={selectedAssetForm.metadataSize} onChange={(event) => updateAsset(currentSelectedModel, "metadataSize", event.target.value)} placeholder="Dung lượng metadata" />
                  </label>
                  <button type="button" className="smallButton" onClick={() => attachAssets(currentSelectedModel)}>
                    <UploadCloud size={15} /> Gắn ảnh / metadata
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {activeTab === "logs" && (
        <div className="marketAdminAuditGrid">
          <section className="panel">
            <h3>Nhật ký tải model</h3>
            <div className="marketAdminLogList">
              {downloads.map((item) => (
                <div className="marketAdminLogItem" key={item._id}>
                  <div>
                    <strong>{item.modelId?.title || "Model"}</strong>
                    <small>{item.userId?.email || item.guestKey || "guest"} - {item.clientType} - {item.accessTier}</small>
                  </div>
                  <span className={`badge ${item.quotaCharged ? "success" : ""}`}>{item.quotaCharged ? "Tính lượt" : "Miễn lượt"}</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
              ))}
              {!downloads.length && <p className="muted">Chưa có log tải.</p>}
            </div>
          </section>
          <section className="panel">
            <h3>Phiên tải gần đây</h3>
            <div className="marketAdminLogList">
              {sessions.map((item) => (
                <div className="marketAdminLogItem" key={item._id}>
                  <div>
                    <strong>{item.modelId?.title || "Phiên tải"}</strong>
                    <small>{item.userId?.email || item.guestKey || "guest"} - {item.clientType} - {item.accessTier}</small>
                  </div>
                  <span className={`badge ${statusClass(item.status)}`}>{item.status}</span>
                  <span>{formatDate(item.createdAt)}</span>
                </div>
              ))}
              {!sessions.length && <p className="muted">Chưa có phiên tải.</p>}
            </div>
          </section>
        </div>
      )}

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
