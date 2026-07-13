import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
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
        <span className="marketAdminCategoryHint">Giá trị hiện tại chưa có trong cây danh mục: {value}</span>
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

function ModelSummary({ model, selected, selectedForBulk, onBulkToggle, onEdit }) {
  const state = publicState(model);
  const missing = model.metadataMissingFields || [];
  return (
    <article className={`marketAdminItem ${state.key} ${selected ? "selected" : ""}`}>
      <div className="marketAdminModelHead">
        <label className="marketAdminBulkCheck" title="Chọn model">
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
    const [modelRes, statsRes, downloadRes, sessionRes, syncRes] = await Promise.all([
      api(`/api/admin/marketplace/models?${query.toString()}`),
      api("/api/admin/marketplace/stats"),
      api("/api/admin/marketplace/downloads?limit=8"),
      api("/api/admin/marketplace/download-sessions?limit=8"),
      api("/api/admin/marketplace/sync-state").catch(() => ({ config: null, state: null })),
    ]);
    setModels(modelRes.models || []);
    setPagination(modelRes.pagination || { page: 1, totalPages: 1, total: 0 });
    setStats(statsRes.stats || null);
    setDownloads(downloadRes.downloads || []);
    setSessions(sessionRes.sessions || []);
    setSyncInfo(syncRes || null);
    setSyncRootFolderId((current) => current || syncRes?.config?.rootFolderId || "");
    setSelectedModelIds((current) => current.filter((id) => (modelRes.models || []).some((model) => model._id === id)));
  }, [accessType, fileStatus, metadataStatus, published, search]);

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
  }, [loadModels]);

  useEffect(() => {
    loadTaxonomy().catch((err) => setError(err.message));
  }, []);

  async function importDriveFolder(event) {
    event.preventDefault();
    setMessage("");
    setError("");
    try {
      const data = await api("/api/admin/marketplace/drive/reconcile", {
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
      const data = await api("/api/admin/marketplace/sync-run", {
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
      const data = await api("/api/admin/marketplace/drive/sync-folder", {
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
      const data = await api("/api/admin/marketplace/drive/migrate-metadata", {
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
      const data = await api(`/api/admin/marketplace/models/${model._id}/rescan-drive`, {
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
      const data = await api(`/api/admin/marketplace/models/${model._id}/metadata`, {
        method: "PUT",
        body: JSON.stringify({
          metadata: {
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
      const data = await api(`/api/admin/marketplace/models/${model._id}/state`, {
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
      const data = await api("/api/admin/marketplace/models/bulk", {
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
              <h3>Đối soát toàn bộ Drive</h3>
              <span className="badge pending">Chỉ chạy thủ công</span>
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
            </div>
            <div className="marketAdminSyncActions">
              <button type="button" className="smallButton" onClick={() => {
                updateDriveImport("pageToken", "");
                setReconcileReset(true);
              }}>
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

          <section className="marketAdminForm marketAdminSyncPanel">
            <div className="marketAdminPanelTitle">
              <h3>Changes API</h3>
              <span className={`badge ${syncInfo?.config?.enabled ? "success" : "pending"}`}>
                {syncInfo?.config?.enabled ? "Đang bật" : "Đang tắt"}
              </span>
            </div>
            <div className="marketAdminFieldGrid">
              <label>
                <span>Root folder ID</span>
                <input
                  value={syncRootFolderId}
                  onChange={(event) => setSyncRootFolderId(event.target.value)}
                  placeholder="MARKETPLACE_DRIVE_ROOT_FOLDER_ID"
                />
              </label>
              <ModelFact label="Chu kỳ poll" value={syncInfo?.config?.pollSeconds || "-"} detail="giây" />
              <ModelFact label="Hàng đợi" value={String(syncInfo?.queue?.pending ?? 0)} detail={`${syncInfo?.queue?.failed || 0} lỗi`} />
              <ModelFact label="Trạng thái" value={syncInfo?.state?.status || "idle"} detail={syncInfo?.state?.lastChangesError || syncInfo?.state?.lastError || ""} />
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
                <span>Đồng bộ đúng một folder model</span>
                <input value={syncFolderId} onChange={(event) => setSyncFolderId(event.target.value)} placeholder="Drive model folder URL / ID" />
              </label>
            </div>
            <div className="marketAdminSyncActions">
              <button type="button" className="smallButton" onClick={syncOneDriveFolder} disabled={folderSyncRunning || !syncFolderId.trim()}>
                <RefreshCw size={17} /> {folderSyncRunning ? "Đang đồng bộ..." : "Sync một model"}
              </button>
              <button type="button" className="primaryButton" onClick={runDriveSyncNow} disabled={syncRunning || !(syncRootFolderId || driveImportForm.rootFolderId)}>
                <RefreshCw size={17} /> {syncRunning ? "Đang đọc changes..." : "Đọc Changes API ngay"}
              </button>
            </div>
          </section>

          <details className="marketAdminForm marketAdminManualImport">
            <summary><Database size={16} /> Migration metadata V2</summary>
            <div className="marketAdminSyncActions">
              <button type="button" className="smallButton" disabled={migrationRunning} onClick={() => runMetadataMigration(true)}>
                Kiểm tra batch đầu
              </button>
              <button type="button" className="primaryButton" disabled={migrationRunning} onClick={() => runMetadataMigration(false)}>
                {migrationRunning ? "Đang xử lý..." : "Backup và migrate batch đầu"}
              </button>
            </div>
            {migrationResult && (
              <div className="marketAdminScanResult">
                <span>Đã kiểm tra: {migrationResult.inspected || 0}</span>
                <span>Batch: {migrationResult.page || 1}/{migrationResult.totalPages || 1}</span>
                <span>Cần đổi: {migrationResult.changed || 0}</span>
                <span>Đã ghi: {migrationResult.migrated || 0}</span>
                <span>Bỏ qua: {migrationResult.skipped?.length || 0}</span>
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

          <div className="marketAdminBulkBar">
            <label className="checkboxInline">
              <input type="checkbox" checked={allPageSelected} onChange={toggleSelectPage} />
              Chọn trang này
            </label>
            <span>{selectedModelIds.length} model đã chọn</span>
            <select value={bulkAction} onChange={(event) => setBulkAction(event.target.value)}>
              <option value="publish">Xuất bản</option>
              <option value="unpublish">Chuyển nháp</option>
              <option value="access">Đổi quyền tải</option>
              <option value="rescan">Quét lại Drive</option>
            </select>
            {bulkAction === "access" && (
              <select value={bulkAccessType} onChange={(event) => setBulkAccessType(event.target.value)}>
                <option value="member">Pro</option>
                <option value="free">Free</option>
              </select>
            )}
            <button type="button" className="smallButton" disabled={!selectedModelIds.length || bulkRunning} onClick={runBulkAction}>
              <RefreshCw size={15} /> {bulkRunning ? "Đang xử lý..." : "Áp dụng"}
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
                <ModelFact label="Metadata Drive" value={`Revision ${currentSelectedModel.metadataRevision || 0}`} detail={currentSelectedModel.metadataFileName || "Thiếu metadata"} />
                <ModelFact label="Đồng bộ" value={currentSelectedModel.syncStatus || "missing"} detail={currentSelectedModel.syncError || formatDate(currentSelectedModel.lastDriveScanAt)} />
              </div>

              <section className="marketAdminEditSection">
                <EditSectionTitle
                  icon={ListChecks}
                  title="Metadata trên Drive"
                />
                <div className="marketAdminFieldGrid">
                  <label>
                    <span>Mã model</span>
                    <input value={selectedMetadataForm.sourceModelId} disabled />
                  </label>
                  <label>
                    <span>Tên model</span>
                    <input value={selectedMetadataForm.title} onChange={(event) => updateMetadata(currentSelectedModel, "title", event.target.value)} />
                  </label>
                  <label>
                    <span>Quyền tải</span>
                    <select value={selectedMetadataForm.accessType} onChange={(event) => updateMetadata(currentSelectedModel, "accessType", event.target.value)}>
                      <option value="free">Free</option>
                      <option value="member">Pro</option>
                    </select>
                  </label>
                  <CategorySelect
                    value={selectedMetadataForm.sourceCategoryId}
                    categories={categoryTree}
                    onChange={(value) => updateMetadata(currentSelectedModel, "sourceCategoryId", value)}
                  />
                  <label>
                    <span>Renderer hiển thị</span>
                    <select value={selectedMetadataForm.renderer} onChange={(event) => updateMetadata(currentSelectedModel, "renderer", event.target.value)}>
                      <option value="">Chọn renderer</option>
                      {(filterOptions.render || []).map((option) => (
                        <option key={option.value} value={option.label || option.value}>{optionLabel(option)}</option>
                      ))}
                    </select>
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
                  <button type="button" className="primaryButton" disabled={metadataSavingId === currentSelectedModel._id} onClick={() => saveModelMetadata(currentSelectedModel)}>
                    <Save size={16} /> {metadataSavingId === currentSelectedModel._id ? "Đang ghi Drive..." : "Lưu metadata lên Drive"}
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
                    <span>Slug web</span>
                    <input value={selectedOperationalForm.slug} onChange={(event) => updateModelState(currentSelectedModel, "slug", event.target.value)} />
                  </label>
                  <label>
                    <span>Mong muốn xuất bản</span>
                    <select value={String(selectedOperationalForm.desiredPublished)} onChange={(event) => updateModelState(currentSelectedModel, "desiredPublished", event.target.value === "true")}>
                      <option value="true">Cho phép xuất bản</option>
                      <option value="false">Bản nháp</option>
                    </select>
                  </label>
                  <ModelFact label="Trạng thái thực tế" value={currentSelectedModel.isPublished ? "Đang online" : "Đang offline"} detail={(currentSelectedModel.publicationBlockers || []).join(", ") || "Không có blocker"} />
                </div>
                <div className="marketAdminSyncActions">
                  <button type="button" className="smallButton" onClick={() => rescanDriveFolder(currentSelectedModel)} disabled={!currentSelectedModel.driveFolderId}>
                    <RefreshCw size={16} /> Đồng bộ lại folder này
                  </button>
                  <button type="button" className="primaryButton" onClick={() => saveModelState(currentSelectedModel)}>
                    <Save size={16} /> Lưu trạng thái web
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
                    <span className="marketAdminLogMeta">{item.userId?.email || item.guestKey || "guest"} - {item.clientType} - {item.accessTier}</span>
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
                    <span className="marketAdminLogMeta">{item.userId?.email || item.guestKey || "guest"} - {item.clientType} - {item.accessTier}</span>
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

      {metadataConflict && (
        <div className="marketAdminConflictOverlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setMetadataConflict(null);
        }}>
          <section className="marketAdminConflictDialog" role="dialog" aria-modal="true" aria-labelledby="metadata-conflict-title">
            <header>
              <div>
                <h3 id="metadata-conflict-title"><GitCompareArrows size={18} /> Metadata đã thay đổi trên Drive</h3>
                <p>Bản đang sửa chưa được ghi đè. Hãy nạp bản Drive mới nhất, kiểm tra rồi lưu lại.</p>
              </div>
              <button type="button" className="iconButton" onClick={() => setMetadataConflict(null)} aria-label="Đóng">
                <X size={18} />
              </button>
            </header>
            <div className="marketAdminConflictList">
              {(metadataConflict.diff || []).map((item) => (
                <div key={item.field}>
                  <strong>{item.field}</strong>
                  <span><b>Bản đang sửa</b>{Array.isArray(item.before) ? item.before.join(", ") : String(item.before ?? "")}</span>
                  <span><b>Bản trên Drive</b>{Array.isArray(item.after) ? item.after.join(", ") : String(item.after ?? "")}</span>
                </div>
              ))}
              {!metadataConflict.diff?.length && <p>Drive version đã đổi nhưng các trường metadata hiện không khác.</p>}
            </div>
            <footer>
              <button type="button" className="smallButton" onClick={() => setMetadataConflict(null)}>Giữ form đang sửa</button>
              <button type="button" className="primaryButton" onClick={loadConflictVersion}>Nạp bản mới nhất từ Drive</button>
            </footer>
          </section>
        </div>
      )}

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
