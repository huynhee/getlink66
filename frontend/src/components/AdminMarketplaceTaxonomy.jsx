import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, KeyRound, Plus, RefreshCw, Save, Search, X } from "lucide-react";
import { api, buildApiUrl } from "../api.js";
import { text } from "../i18n.js";
import MarketplaceFacetIcon, { MARKETPLACE_FACET_ICON_LABELS } from "./MarketplaceFacetIcon.jsx";

const facetNames = {
  style: ["Phong cách", "Style"],
  render: ["Render", "Render"],
  form: ["Hình dạng", "Form"],
  color: ["Màu sắc", "Color"],
  material: ["Vật liệu", "Material"],
  platform: ["Nền tảng", "Platform"],
};

const defaultIconKeyByFacet = {
  form: "round",
  render: "vray",
  platform: "3dsmax",
};

function rowId(type, row) {
  return `${type}:${row._id}`;
}

function makeKey(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function emptyCreateDraft(group) {
  return group === "category"
    ? { title: "", titleEn: "", aliasesVi: "", aliasesEn: "", key: "", parentId: "", position: 0, isActive: true }
    : { labelVi: "", labelEn: "", aliasesVi: "", aliasesEn: "", key: "", position: 0, isActive: true, hex: "#808080", iconKey: defaultIconKeyByFacet[group] || "", iconUrl: "" };
}

export default function AdminMarketplaceTaxonomy({ assetType = "model", language = "vi", onChanged }) {
  const l = (vi, en) => text(language, vi, en);
  const [data, setData] = useState({ categories: [], filterOptions: [], allowedFacets: [], formIconKeys: [], iconKeysByFacet: {} });
  const [group, setGroup] = useState("category");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState(emptyCreateDraft("category"));
  const [createKeyTouched, setCreateKeyTouched] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api(`/api/admin/marketplace/taxonomy?assetType=${encodeURIComponent(assetType)}`);
      setData({
        categories: result.categories || [],
        filterOptions: result.filterOptions || [],
        allowedFacets: result.allowedFacets || [],
        formIconKeys: result.formIconKeys || [],
        iconKeysByFacet: result.iconKeysByFacet || { form: result.formIconKeys || [] },
      });
      setDrafts({});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [assetType]);

  useEffect(() => {
    setGroup("category");
    setCreateOpen(false);
    load();
  }, [load]);

  const groups = useMemo(
    () => ["category", ...(data.allowedFacets.length ? data.allowedFacets : [...new Set(data.filterOptions.map((item) => item.facet))])],
    [data.allowedFacets, data.filterOptions],
  );

  const parentById = useMemo(
    () => new Map(data.categories.map((category) => [String(category._id), category])),
    [data.categories],
  );

  const orderedCategories = useMemo(() => {
    const roots = data.categories.filter((category) => !category.parentId && !category.parentSourceCategoryId);
    const children = data.categories.filter((category) => category.parentId || category.parentSourceCategoryId);
    const result = [];
    for (const root of roots) {
      result.push(root);
      result.push(...children.filter((child) => (
        String(child.parentId || "") === String(root._id)
        || String(child.parentSourceCategoryId || "") === String(root.sourceCategoryId)
      )));
    }
    const included = new Set(result.map((item) => String(item._id)));
    result.push(...children.filter((item) => !included.has(String(item._id))));
    return result;
  }, [data.categories]);

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const source = group === "category"
      ? orderedCategories
      : data.filterOptions.filter((option) => option.facet === group);
    return source.filter((row) => {
      if (statusFilter === "active" && row.isActive === false) return false;
      if (statusFilter === "inactive" && row.isActive !== false) return false;
      if (!normalizedQuery) return true;
      const searchable = group === "category"
        ? [row.sourceCategoryId, row.slug, row.title, row.titleEn, ...(row.aliasesVi || []), ...(row.aliasesEn || [])]
        : [row.value, row.labelVi, row.labelEn, ...(row.aliasesVi || []), ...(row.aliasesEn || [])];
      return searchable.some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [data.filterOptions, group, orderedCategories, query, statusFilter]);

  function currentDraft(type, row) {
    return drafts[rowId(type, row)] || (type === "category"
      ? {
          title: row.title || "",
          titleEn: row.titleEn || "",
          aliasesVi: (row.aliasesVi || []).join(", "),
          aliasesEn: (row.aliasesEn || []).join(", "),
          position: Number(row.position || 0),
          isActive: row.isActive !== false,
        }
      : {
          labelVi: row.labelVi || "",
          labelEn: row.labelEn || "",
          aliasesVi: (row.aliasesVi || []).join(", "),
          aliasesEn: (row.aliasesEn || []).join(", "),
          position: Number(row.position || 0),
          isActive: row.isActive !== false,
          ...(row.facet === "color" ? { hex: row.hex || "#808080" } : {}),
          ...(data.iconKeysByFacet[row.facet]?.length
            ? { iconKey: row.iconKey || defaultIconKeyByFacet[row.facet] || "", iconUrl: row.iconUrl || "" }
            : {}),
        });
  }

  function updateDraft(type, row, field, value) {
    const id = rowId(type, row);
    setDrafts((current) => ({
      ...current,
      [id]: { ...currentDraft(type, row), [field]: value },
    }));
  }

  function openCreate() {
    setCreateDraft(emptyCreateDraft(group));
    setCreateKeyTouched(false);
    setCreateOpen(true);
    setMessage("");
    setError("");
  }

  function updateCreate(field, value) {
    setCreateDraft((current) => {
      const next = { ...current, [field]: value };
      const englishField = group === "category" ? "titleEn" : "labelEn";
      if (field === englishField && !createKeyTouched) next.key = makeKey(value);
      return next;
    });
    if (field === "key") setCreateKeyTouched(true);
  }

  async function createTaxonomy(event) {
    event.preventDefault();
    setCreating(true);
    setMessage("");
    setError("");
    try {
      const isCategory = group === "category";
      const path = isCategory ? "/api/admin/marketplace/categories" : "/api/admin/marketplace/filter-options";
      const body = isCategory
        ? { ...createDraft, assetType }
        : { ...createDraft, assetType, facet: group };
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setCreateOpen(false);
      setMessage(isCategory ? l("Đã tạo danh mục.", "Category created.") : l("Đã tạo lựa chọn bộ lọc.", "Filter option created."));
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function save(type, row) {
    const id = rowId(type, row);
    const draft = currentDraft(type, row);
    if (row.isActive !== false && draft.isActive === false && Number(row.usageCount || 0) > 0) {
      const confirmed = window.confirm(l(
        `Mục này đang được ${row.usageCount} tài nguyên sử dụng. Vô hiệu hóa sẽ ngăn gán mới nhưng không gỡ khỏi dữ liệu cũ. Tiếp tục?`,
        `${row.usageCount} assets use this item. Disabling prevents new assignments but keeps existing data. Continue?`,
      ));
      if (!confirmed) return;
    }
    setSaving(id);
    setMessage("");
    setError("");
    try {
      const path = type === "category"
        ? `/api/admin/marketplace/categories/${row._id}`
        : `/api/admin/marketplace/filter-options/${row._id}`;
      const result = await api(path, { method: "PATCH", body: JSON.stringify(draft) });
      const updated = type === "category" ? result.category : result.filterOption;
      const collection = type === "category" ? "categories" : "filterOptions";
      setData((current) => ({
        ...current,
        [collection]: current[collection].map((item) => item._id === row._id
          ? { ...updated, usageCount: Number(row.usageCount || 0) }
          : item),
      }));
      setDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMessage(l("Đã lưu thay đổi.", "Changes saved."));
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  }

  async function downloadTaxonomy() {
    setMessage("");
    setError("");
    try {
      const response = await fetch(buildApiUrl("/api/admin/marketplace/taxonomy/export?assetType=all&includeInactive=true"), {
        credentials: "include",
      });
      if (!response.ok) throw new Error(l("Không thể xuất taxonomy.", "Cannot export taxonomy."));
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || "3dipl-taxonomy-v1.json";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(l("Đã xuất taxonomy JSON.", "Taxonomy JSON exported."));
    } catch (err) {
      setError(err.message);
    }
  }

  const createParents = data.categories.filter((category) => (
    !category.parentId && !category.parentSourceCategoryId && category.isActive !== false
  ));

  return (
    <section className="marketTaxonomyAdmin">
      <div className="marketTaxonomyToolbar">
        <label className="adminSearchField">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={l("Tìm key hoặc nhãn...", "Search keys or labels...")}
          />
        </label>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label={l("Trạng thái", "Status")}>
          <option value="all">{l("Tất cả trạng thái", "All statuses")}</option>
          <option value="active">{l("Đang bật", "Active")}</option>
          <option value="inactive">{l("Đã tắt", "Disabled")}</option>
        </select>
        <button type="button" className="smallButton" onClick={load} disabled={loading}>
          <RefreshCw size={15} /> {l("Tải lại", "Reload")}
        </button>
        <button type="button" className="smallButton" onClick={downloadTaxonomy}>
          <Download size={15} /> {l("Xuất JSON", "Export JSON")}
        </button>
        <button type="button" className="primaryButton" onClick={openCreate}>
          <Plus size={15} /> {group === "category" ? l("Thêm danh mục", "Add category") : l("Thêm lựa chọn", "Add option")}
        </button>
      </div>

      <div className="adminSubTabs marketTaxonomyGroups" role="tablist" aria-label={l("Nhóm taxonomy", "Taxonomy groups")}>
        {groups.map((item) => (
          <button
            type="button"
            role="tab"
            aria-selected={group === item}
            className={group === item ? "active" : ""}
            key={item}
            onClick={() => setGroup(item)}
          >
            {item === "category" ? l("Danh mục", "Categories") : l(...(facetNames[item] || [item, item]))}
          </button>
        ))}
      </div>

      <div className="marketTaxonomyTable" role="table">
        <div className="marketTaxonomyRow header" role="row">
          <span>{l("Key hệ thống", "System key")}</span>
          <span>{l("Nhãn tiếng Việt", "Vietnamese label")}</span>
          <span>{l("Nhãn tiếng Anh", "English label")}</span>
          <span>{l("Từ khóa VI", "VI aliases")}</span>
          <span>{l("Từ khóa EN", "EN aliases")}</span>
          <span>{group === "category" ? l("Danh mục mẹ", "Parent") : l("Hiển thị", "Visual")}</span>
          <span>{l("Vị trí", "Order")}</span>
          <span>{l("Đang dùng", "Usage")}</span>
          <span>{l("Bật", "Active")}</span>
          <span>{l("Lưu", "Save")}</span>
        </div>
        {rows.map((row) => {
          const type = group === "category" ? "category" : "filter";
          const draft = currentDraft(type, row);
          const id = rowId(type, row);
          const parent = type === "category" && row.parentId ? parentById.get(String(row.parentId)) : null;
          const isChild = Boolean(row.parentId || row.parentSourceCategoryId);
          return (
            <div className={`marketTaxonomyRow ${row.isActive === false ? "disabled" : ""}`} role="row" key={row._id}>
              <div className={`marketTaxonomyKey ${isChild ? "child" : ""}`}>
                <code>{type === "category" ? row.sourceCategoryId : row.value}</code>
                <small><KeyRound size={11} /> {row.isActive === false ? l("Đã tắt", "Disabled") : l("Đã khóa", "Locked")}</small>
              </div>
              <input
                aria-label={l("Nhãn tiếng Việt", "Vietnamese label")}
                value={type === "category" ? draft.title : draft.labelVi}
                onChange={(event) => updateDraft(type, row, type === "category" ? "title" : "labelVi", event.target.value)}
              />
              <input
                aria-label={l("Nhãn tiếng Anh", "English label")}
                value={type === "category" ? draft.titleEn : draft.labelEn}
                onChange={(event) => updateDraft(type, row, type === "category" ? "titleEn" : "labelEn", event.target.value)}
              />
              <input
                aria-label={l("Từ khóa tiếng Việt", "Vietnamese aliases")}
                placeholder={l("Cách nhau bằng dấu phẩy", "Comma separated")}
                value={draft.aliasesVi}
                onChange={(event) => updateDraft(type, row, "aliasesVi", event.target.value)}
              />
              <input
                aria-label={l("Từ khóa tiếng Anh", "English aliases")}
                placeholder={l("Cách nhau bằng dấu phẩy", "Comma separated")}
                value={draft.aliasesEn}
                onChange={(event) => updateDraft(type, row, "aliasesEn", event.target.value)}
              />
              <div className="marketTaxonomyVisual">
                {type === "category" && <span>{parent?.title || parent?.titleEn || (isChild ? row.parentSourceCategoryId : l("Gốc", "Root"))}</span>}
                {type === "filter" && row.facet === "color" && (
                  <label className="marketTaxonomyColor"><input type="color" value={draft.hex} onChange={(event) => updateDraft(type, row, "hex", event.target.value)} /><code>{draft.hex}</code></label>
                )}
                {type === "filter" && data.iconKeysByFacet[row.facet]?.length > 0 && (
                  <div className="marketTaxonomyIconEditor">
                    <div className="marketTaxonomyIconSelect">
                      <MarketplaceFacetIcon iconKey={draft.iconKey} iconUrl={draft.iconUrl} />
                      <select value={draft.iconKey} onChange={(event) => updateDraft(type, row, "iconKey", event.target.value)}>
                        <option value="">{l("Chỉ dùng URL", "URL only")}</option>
                        {data.iconKeysByFacet[row.facet].map((key) => <option value={key} key={key}>{MARKETPLACE_FACET_ICON_LABELS[key] || key}</option>)}
                      </select>
                    </div>
                    <input
                      aria-label={l("Đường dẫn icon", "Icon URL")}
                      value={draft.iconUrl}
                      placeholder="https://... /icons/..."
                      onChange={(event) => updateDraft(type, row, "iconUrl", event.target.value)}
                    />
                  </div>
                )}
                {type === "filter" && row.facet !== "color" && !data.iconKeysByFacet[row.facet]?.length && <span>{l(...(facetNames[row.facet] || [row.facet, row.facet]))}</span>}
              </div>
              <input
                aria-label={l("Vị trí", "Order")}
                type="number"
                min="0"
                max="100000"
                value={draft.position}
                onChange={(event) => updateDraft(type, row, "position", Number(event.target.value || 0))}
              />
              <strong className="marketTaxonomyUsage">{Number(row.usageCount || 0).toLocaleString(language === "vi" ? "vi-VN" : "en-US")}</strong>
              <label className="marketTaxonomyToggle">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => updateDraft(type, row, "isActive", event.target.checked)}
                />
                <span>{draft.isActive ? l("Bật", "On") : l("Tắt", "Off")}</span>
              </label>
              <button
                type="button"
                className="iconButton"
                title={l("Lưu thay đổi", "Save changes")}
                aria-label={l("Lưu thay đổi", "Save changes")}
                disabled={saving === id}
                onClick={() => save(type, row)}
              >
                <Save size={16} />
              </button>
            </div>
          );
        })}
        {!loading && !rows.length && <p className="muted">{l("Không có dữ liệu phù hợp.", "No matching taxonomy.")}</p>}
        {loading && <p className="muted">{l("Đang tải taxonomy...", "Loading taxonomy...")}</p>}
      </div>

      {message && <p className="success">{message}</p>}
      {error && !createOpen && <p className="error">{error}</p>}

      {createOpen && (
        <div className="marketTaxonomyModalBackdrop" role="dialog" aria-modal="true" aria-labelledby="taxonomy-create-title">
          <form className="panel marketTaxonomyModal" onSubmit={createTaxonomy}>
            <div className="marketTaxonomyModalHeader">
              <div>
                <h3 id="taxonomy-create-title">{group === "category" ? l("Thêm danh mục", "Add category") : l("Thêm lựa chọn bộ lọc", "Add filter option")}</h3>
                <span className="badge">{assetType === "scene" ? "SCENE" : "MODEL"}</span>
              </div>
              <button type="button" className="iconButton" onClick={() => setCreateOpen(false)} aria-label={l("Đóng", "Close")}><X size={17} /></button>
            </div>
            <div className="marketTaxonomyCreateGrid">
              <label><span>{l("Nhãn tiếng Việt", "Vietnamese label")}</span><input required value={group === "category" ? createDraft.title : createDraft.labelVi} onChange={(event) => updateCreate(group === "category" ? "title" : "labelVi", event.target.value)} /></label>
              <label><span>{l("Nhãn tiếng Anh", "English label")}</span><input required value={group === "category" ? createDraft.titleEn : createDraft.labelEn} onChange={(event) => updateCreate(group === "category" ? "titleEn" : "labelEn", event.target.value)} /></label>
              <label><span>{l("Từ khóa tiếng Việt", "Vietnamese aliases")}</span><input value={createDraft.aliasesVi} placeholder={l("Tối đa 20, cách nhau bằng dấu phẩy", "Up to 20, comma separated")} onChange={(event) => updateCreate("aliasesVi", event.target.value)} /></label>
              <label><span>{l("Từ khóa tiếng Anh", "English aliases")}</span><input value={createDraft.aliasesEn} placeholder={l("Tối đa 20, cách nhau bằng dấu phẩy", "Up to 20, comma separated")} onChange={(event) => updateCreate("aliasesEn", event.target.value)} /></label>
              <label className="marketTaxonomyKeyField"><span>{l("Key hệ thống", "System key")}</span><input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={createDraft.key} onChange={(event) => updateCreate("key", makeKey(event.target.value))} /><small>{l("Key sẽ bị khóa sau khi tạo.", "The key is locked after creation.")}</small></label>
              {group === "category" && (
                <label><span>{l("Danh mục mẹ", "Parent category")}</span><select value={createDraft.parentId} onChange={(event) => updateCreate("parentId", event.target.value)}><option value="">{l("Danh mục gốc", "Root category")}</option>{createParents.map((category) => <option key={category._id} value={category._id}>{language === "en" ? category.titleEn : category.title}</option>)}</select></label>
              )}
              {group === "color" && (
                <label><span>{l("Mã màu", "Color")}</span><div className="marketTaxonomyColorInput"><input type="color" value={createDraft.hex} onChange={(event) => updateCreate("hex", event.target.value)} /><input required pattern="#[0-9a-fA-F]{6}" value={createDraft.hex} onChange={(event) => updateCreate("hex", event.target.value)} /></div></label>
              )}
              {data.iconKeysByFacet[group]?.length > 0 && (
                <>
                  <label><span>{l("Icon có sẵn", "Icon preset")}</span><div className="marketTaxonomyIconSelect"><MarketplaceFacetIcon iconKey={createDraft.iconKey} iconUrl={createDraft.iconUrl} /><select value={createDraft.iconKey} onChange={(event) => updateCreate("iconKey", event.target.value)}><option value="">{l("Chỉ dùng URL", "URL only")}</option>{data.iconKeysByFacet[group].map((key) => <option value={key} key={key}>{MARKETPLACE_FACET_ICON_LABELS[key] || key}</option>)}</select></div></label>
                  <label className="marketTaxonomyIconUrlField"><span>{l("Icon URL (ưu tiên)", "Icon URL (preferred)")}</span><input type="text" value={createDraft.iconUrl} placeholder="https://... hoặc /icons/..." onChange={(event) => updateCreate("iconUrl", event.target.value)} /><small>{l("Chỉ nhận HTTPS hoặc đường dẫn nội bộ bắt đầu bằng /.", "HTTPS or an internal path starting with / only.")}</small></label>
                </>
              )}
              <label><span>{l("Vị trí", "Order")}</span><input type="number" min="0" max="100000" value={createDraft.position} onChange={(event) => updateCreate("position", Number(event.target.value || 0))} /></label>
              <label className="marketTaxonomyCreateToggle"><input type="checkbox" checked={createDraft.isActive} onChange={(event) => updateCreate("isActive", event.target.checked)} /><span>{l("Bật ngay sau khi tạo", "Activate after creation")}</span></label>
            </div>
            {error && <p className="error marketTaxonomyModalError">{error}</p>}
            <div className="marketTaxonomyModalActions">
              <button type="button" className="smallButton" onClick={() => setCreateOpen(false)}>{l("Hủy", "Cancel")}</button>
              <button type="submit" className="primaryButton" disabled={creating}><Plus size={15} /> {creating ? l("Đang tạo...", "Creating...") : l("Tạo mới", "Create")}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
