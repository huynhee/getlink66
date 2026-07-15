import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  GitCompareArrows,
  ListChecks,
  Package,
  Pencil,
  RefreshCw,
  Save,
  Search,
  UploadCloud,
  X,
} from "lucide-react";
import { api } from "../api.js";
import Pagination from "./Pagination.jsx";
import { text } from "../i18n.js";

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

const accessLabels = {
  all: "Tất cả quyền",
  free: "Free",
  member: "Pro",
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

function optionLabel(option, language = "vi") {
  if (language === "en") return option.label || option.value;
  return facetLabelsVi[option.value] || option.label || option.value;
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
      <span>{language === "en" ? ({ styles: "Style", renderers: "Render", forms: "Form", colors: "Color", materials: "Material" }[field] || field) : facetTitles[field]}</span>
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
              {optionLabel(option, language)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelSummary({ model, selected, selectedForBulk, onBulkToggle, onEdit, language = "vi" }) {
  const isScene = model.assetType === "scene";
  const state = publicState(model);
  const missing = model.metadataMissingFields || [];
  const localizedState = {
    draft: text(language, "Bản nháp", "Draft"),
    incomplete: text(language, "Thiếu metadata", "Incomplete metadata"),
    pending: text(language, "Thiếu file", "Missing file"),
    online: text(language, "Đang online", "Online"),
  }[state.key] || state.label;
  return (
    <article className={`marketAdminItem ${state.key} ${selected ? "selected" : ""}`}>
      <div className="marketAdminModelHead">
        <label className="marketAdminBulkCheck" title={isScene ? text(language, "Chọn scene", "Select scene") : text(language, "Chọn model", "Select model")}>
          <input
            type="checkbox"
            checked={selectedForBulk}
            onChange={() => onBulkToggle(model._id)}
          />
        </label>
        <div className="marketAdminModelIcon">
          <Package size={22} />
        </div>
        <div className="marketAdminModelTitle">
          <strong>{model.title}</strong>
          <span>{model.slug}</span>
        </div>
        <div className="marketAdminBadges">
          <span className={`badge ${statusClass(state.key)}`}>{localizedState}</span>
          <span className={`badge ${statusClass(model.metadataStatus)}`}>
            {model.metadataStatus === "complete" ? text(language, "Đủ metadata", "Metadata ready") : text(language, "Thiếu metadata", "Incomplete metadata")}
          </span>
          <span className={`badge ${statusClass(model.fileStatus)}`}>
            {model.fileStatus === "ready" ? text(language, "Sẵn sàng", "Ready") : (language === "en" ? (model.fileStatus || "Missing file") : (fileStatusLabels[model.fileStatus] || "Thiếu file"))}
          </span>
          <span className="badge">{accessLabels[model.accessType] || model.accessType}</span>
        </div>
      </div>

      <MissingFields fields={missing} language={language} />

      <div className="marketAdminModelGrid">
        <ModelFact label={text(language, "File nén", "Archive")} value={formatBytes(model.fileSize)} detail={model.archiveExt || "archive"} />
        <ModelFact label={text(language, "Ảnh cover", "Cover image")} value={model.coverImage?.driveFileId ? text(language, "Đã gắn", "Attached") : text(language, "Thiếu", "Missing")} detail={model.coverImage?.fileName} />
        <ModelFact label="Preview" value={`${model.previewImages?.length || 0} ${text(language, "ảnh", "images")}`} detail={model.metadataFileName || "metadata"} />
        <ModelFact label={text(language, "Lần quét Drive", "Last Drive scan")} value={formatDate(model.lastDriveScanAt)} detail={model.driveFolderName || model.source?.slug} />
        <ModelFact label={text(language, "Search index", "Search index")} value={model.discoveryStatus || "pending"} detail={model.discoveryError || formatDate(model.discoveryIndexedAt)} />
      </div>

      <div className="marketAdminModelActions">
        <button type="button" className="primaryButton" onClick={() => onEdit(model)}>
          <Pencil size={16} /> {isScene ? text(language, "Chỉnh sửa scene", "Edit scene") : text(language, "Chỉnh sửa model", "Edit model")}
        </button>
      </div>
    </article>
  );
}

export default function AdminMarketplace({ language = "vi", assetType = "model" }) {
  const l = (vi, en) => text(language, vi, en);
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
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [categoryTree, setCategoryTree] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [driveImportForm, setDriveImportForm] = useState(emptyDriveImportForm);
  const [metadataById, setMetadataById] = useState({});
  const [stateById, setStateById] = useState({});
  const [metadataVersionById, setMetadataVersionById] = useState({});
  const [selectedModel, setSelectedModel] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [reconcileReset, setReconcileReset] = useState(false);
  const [syncInfo, setSyncInfo] = useState(null);
  const [syncRootFolderId, setSyncRootFolderId] = useState("");
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncFolderId, setSyncFolderId] = useState("");
  const [folderSyncRunning, setFolderSyncRunning] = useState(false);
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null);
  const [metadataSavingId, setMetadataSavingId] = useState("");
  const [metadataConflict, setMetadataConflict] = useState(null);
  const [selectedModelIds, setSelectedModelIds] = useState([]);
  const [bulkAction, setBulkAction] = useState("publish");
  const [bulkAccessType, setBulkAccessType] = useState("member");
  const [bulkRunning, setBulkRunning] = useState(false);
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
      renderer: model.renderer || "",
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

  const loadModels = useCallback(async (nextPage = 1) => {
    const query = new URLSearchParams({ page: String(nextPage), fileStatus, accessType, published, metadataStatus });
    if (search.trim()) query.set("search", search.trim());
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
    setSelectedModelIds((current) => current.filter((id) => (modelRes.models || []).some((model) => model._id === id)));
  }, [accessType, adminAssetBase, fileStatus, isScene, metadataStatus, published, search]);

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

  async function importDriveFolder(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const data = await api(`${adminOpsBase}/drive/reconcile`, {
        method: "POST",
        body: JSON.stringify({
          rootFolderId: driveImportForm.rootFolderId,
          limit: Number(driveImportForm.limit || 20),
          ...(driveImportForm.pageToken ? { pageToken: driveImportForm.pageToken } : {}),
          ...(reconcileReset ? { reset: true } : {}),
        }),
      });
      setLastScan(data);
      setReconcileReset(false);
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
            renderer: form.renderer,
            sha256: model.sha256 || "",
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
  const selectedMetadataForm = currentSelectedModel ? metadataForm(currentSelectedModel) : null;
  const selectedOperationalForm = currentSelectedModel ? stateForm(currentSelectedModel) : null;
  const allPageSelected = models.length > 0 && models.every((model) => selectedModelIds.includes(model._id));

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
        </div>
      )}

      <div className="marketAdminTabs" role="tablist" aria-label={isScene ? l("Khu quản lý scene", "Scene management sections") : l("Khu quản lý model", "Model management sections")}>
        {[
          ["import", l("Import / đồng bộ", "Import / sync"), UploadCloud],
          ["search", isScene ? l("Tìm kiếm scene", "Search scenes") : l("Tìm kiếm model", "Search models"), Search],
          ["edit", isScene ? l("Chỉnh sửa scene", "Edit scene") : l("Chỉnh sửa model", "Edit model"), Pencil],
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
              <h3>{l("Đối soát toàn bộ Drive", "Full Drive reconciliation")}</h3>
              <span className="badge pending">{l("Chỉ chạy thủ công", "Manual only")}</span>
            </div>
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
                <span>{l("Token trang tiếp theo", "Next page token")}</span>
                <input
                  value={driveImportForm.pageToken}
                  onChange={(event) => updateDriveImport("pageToken", event.target.value)}
                  placeholder={l("Tự điền sau mỗi batch", "Filled after each batch")}
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
              <button type="button" className="smallButton" onClick={() => {
                updateDriveImport("pageToken", "");
                setReconcileReset(true);
              }}>
                {l("Đặt lại token", "Reset token")}
              </button>
              <button className="primaryButton">
                <UploadCloud size={17} /> {driveImportForm.pageToken ? l("Quét batch tiếp theo", "Scan next batch") : l("Quét batch đầu tiên", "Scan first batch")}
              </button>
            </div>
            {lastScan && (
              <div className="marketAdminScanResult">
                <span>{lastScan.scannedFolders || 0} {l("đã quét", "scanned")}</span>
                <span>{lastScan.createdCount || 0} {l("tạo mới", "created")}</span>
                <span>{lastScan.updatedCount || 0} {l("cập nhật", "updated")}</span>
                <span>{lastScan.unchangedCount || 0} {l("không đổi", "unchanged")}</span>
                <span>{lastScan.hasMore ? l("Còn batch tiếp", "More batches") : l("Đã hết", "Complete")}</span>
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
              <button type="button" className="smallButton" onClick={syncOneDriveFolder} disabled={folderSyncRunning || !syncFolderId.trim()}>
                <RefreshCw size={17} /> {folderSyncRunning ? l("Đang đồng bộ...", "Syncing...") : isScene ? l("Sync một scene", "Sync one scene") : l("Sync một model", "Sync one model")}
              </button>
              <button type="button" className="primaryButton" onClick={runDriveSyncNow} disabled={syncRunning || !(syncRootFolderId || driveImportForm.rootFolderId)}>
                <RefreshCw size={17} /> {syncRunning ? l("Đang đọc changes...", "Reading changes...") : l("Đọc Changes API ngay", "Read Changes API now")}
              </button>
            </div>
          </section>

          <details className="marketAdminForm marketAdminManualImport">
            <summary><Database size={16} /> {isScene ? "Migration metadata V3" : "Migration metadata V2"}</summary>
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
          <div className="adminTableToolbar marketAdminToolbar">
            <label className="adminSearchField">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isScene ? l("Tìm scene theo tên hoặc slug...", "Search by scene name or slug...") : l("Tìm model theo tên hoặc slug...", "Search by model name or slug...")} />
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
            <span className={`marketFilterCount ${activeFilterCount ? "active" : ""}`}>{activeFilterCount}</span>
            {activeFilterCount > 0 && (
              <button type="button" className="smallButton" onClick={clearFilters}>{l("Xóa lọc", "Clear filters")}</button>
            )}
          </div>

          <div className="marketAdminBulkBar">
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
          </div>

          <div className="marketAdminList">
            {models.map((model) => (
              <ModelSummary
                key={model._id}
                model={model}
                selected={currentSelectedModel?._id === model._id}
                selectedForBulk={selectedModelIds.includes(model._id)}
                onBulkToggle={toggleSelectedModel}
                onEdit={selectForEdit}
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
                </div>
                <div className="marketAdminFacetGrid">
                  {Object.entries(facetOptionMap).filter(([field]) => !isScene || ["styles", "renderers"].includes(field)).map(([field, filterKey]) => (
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
