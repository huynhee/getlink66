import React, { useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, RefreshCw, Save, Search } from "lucide-react";
import { api } from "../api.js";
import { text } from "../i18n.js";

const facetNames = {
  style: ["Phong cách", "Style"],
  render: ["Render", "Render"],
  form: ["Hình dạng", "Form"],
  color: ["Màu sắc", "Color"],
  material: ["Vật liệu", "Material"],
};

function rowId(type, row) {
  return `${type}:${row._id}`;
}

export default function AdminMarketplaceTaxonomy({ assetType = "model", language = "vi", onChanged }) {
  const l = (vi, en) => text(language, vi, en);
  const [data, setData] = useState({ categories: [], filterOptions: [] });
  const [group, setGroup] = useState("category");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api(`/api/admin/marketplace/taxonomy?assetType=${encodeURIComponent(assetType)}`);
      setData({ categories: result.categories || [], filterOptions: result.filterOptions || [] });
      setDrafts({});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [assetType]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const values = [...new Set(data.filterOptions.map((item) => item.facet))];
    return ["category", ...values];
  }, [data.filterOptions]);

  const parentById = useMemo(
    () => new Map(data.categories.map((category) => [String(category._id), category])),
    [data.categories],
  );

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const source = group === "category"
      ? data.categories
      : data.filterOptions.filter((option) => option.facet === group);
    return source.filter((row) => {
      if (!normalizedQuery) return true;
      const searchable = group === "category"
        ? [row.sourceCategoryId, row.slug, row.title, row.titleEn]
        : [row.value, row.labelVi, row.labelEn];
      return searchable.some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [data, group, query]);

  function currentDraft(type, row) {
    return drafts[rowId(type, row)] || (type === "category"
      ? {
          title: row.title || "",
          titleEn: row.titleEn || "",
          position: Number(row.position || 0),
          isActive: row.isActive !== false,
        }
      : {
          labelVi: row.labelVi || "",
          labelEn: row.labelEn || "",
          position: Number(row.position || 0),
          isActive: row.isActive !== false,
        });
  }

  function updateDraft(type, row, field, value) {
    const id = rowId(type, row);
    setDrafts((current) => ({
      ...current,
      [id]: { ...currentDraft(type, row), [field]: value },
    }));
  }

  async function save(type, row) {
    const id = rowId(type, row);
    const draft = currentDraft(type, row);
    setSaving(id);
    setMessage("");
    setError("");
    try {
      const path = type === "category"
        ? `/api/admin/marketplace/categories/${row._id}`
        : `/api/admin/marketplace/filter-options/${row._id}`;
      const result = await api(path, { method: "PATCH", body: JSON.stringify(draft) });
      const updated = type === "category" ? result.category : result.filterOption;
      setData((current) => ({
        ...current,
        [type === "category" ? "categories" : "filterOptions"]: current[type === "category" ? "categories" : "filterOptions"]
          .map((item) => item._id === row._id ? updated : item),
      }));
      setDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setMessage(l("Đã lưu taxonomy.", "Taxonomy saved."));
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving("");
    }
  }

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
        <button type="button" className="smallButton" onClick={load} disabled={loading}>
          <RefreshCw size={15} /> {l("Tải lại", "Reload")}
        </button>
        <span className="badge pending"><KeyRound size={13} /> {l("Key bị khóa", "Keys locked")}</span>
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
          <span>{l("Vị trí", "Order")}</span>
          <span>{l("Bật", "Active")}</span>
          <span>{l("Lưu", "Save")}</span>
        </div>
        {rows.map((row) => {
          const type = group === "category" ? "category" : "filter";
          const draft = currentDraft(type, row);
          const id = rowId(type, row);
          const parent = type === "category" && row.parentId ? parentById.get(String(row.parentId)) : null;
          return (
            <div className="marketTaxonomyRow" role="row" key={row._id}>
              <div className="marketTaxonomyKey">
                <code>{type === "category" ? row.sourceCategoryId : row.value}</code>
                {parent && <small>{l("Mẹ", "Parent")}: {parent.title || parent.titleEn}</small>}
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
                aria-label={l("Vị trí", "Order")}
                type="number"
                min="0"
                max="100000"
                value={draft.position}
                onChange={(event) => updateDraft(type, row, "position", Number(event.target.value || 0))}
              />
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
        {!loading && !rows.length && <p className="muted">{l("Không có taxonomy phù hợp.", "No matching taxonomy.")}</p>}
        {loading && <p className="muted">{l("Đang tải taxonomy...", "Loading taxonomy...")}</p>}
      </div>

      {message && <p className="success">{message}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
