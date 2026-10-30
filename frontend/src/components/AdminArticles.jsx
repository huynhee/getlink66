import React, { useState } from "react";
import { Check, FileText, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";
import { api } from "../api.js";
import { text } from "../i18n.js";
import { articleTranslations, translationComplete } from "../utils/guideArticles.js";

const emptyArticle = {
  slug: "",
  coverImage: "",
  translations: articleTranslations(),
  language: "vi",
  sortOrder: "",
  isPublished: true
};

function fillForm(article) {
  if (!article) return emptyArticle;
  return {
    slug: article.slug || "",
    coverImage: article.coverImage || "",
    translations: articleTranslations(article),
    language: article.language || "vi",
    sortOrder: article.sortOrder ?? "",
    isPublished: article.isPublished !== false
  };
}

export default function AdminArticles({ articles = [], onChanged, language = "vi" }) {
  const l = (vi, en) => text(language, vi, en);
  const [form, setForm] = useState(emptyArticle);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const [editLanguage, setEditLanguage] = useState(language);
  const [busy, setBusy] = useState(false);
  const translation = form.translations[editLanguage];
  const successMessages = new Set([
    l("Đã lưu bài viết.", "Article saved."),
    l("Đã tạo bài viết.", "Article created."),
    l("Đã xóa bài viết.", "Article deleted.")
  ]);

  function startEdit(article) {
    setEditingId(article?._id || "");
    setForm(fillForm(article));
    const translations = articleTranslations(article || {});
    setEditLanguage(!article || translationComplete(translations[language]) ? language : article.language || "vi");
    setMessage("");
  }

  function updateTranslation(key, value) {
    setForm((current) => ({ ...current, translations: {
      ...current.translations,
      [editLanguage]: { ...current.translations[editLanguage], [key]: value }
    } }));
  }

  async function saveArticle(event) {
    event.preventDefault();
    if (busy) return;
    setMessage("");
    for (const locale of ["vi", "en"]) {
      const fields = form.translations[locale];
      if (Object.values(fields).some((value) => value.trim()) && !translationComplete(fields)) {
        setEditLanguage(locale);
        setMessage(l(`Cần nhập tiêu đề và nội dung cho bản ${locale.toUpperCase()}.`, `Title and content are required for ${locale.toUpperCase()}.`));
        return;
      }
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        sortOrder: Number(form.sortOrder || 0)
      };
      await api(editingId ? `/api/admin/articles/${editingId}` : "/api/admin/articles", {
        method: editingId ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });
      setForm(emptyArticle);
      setEditingId("");
      setMessage(editingId ? l("Đã lưu bài viết.", "Article saved.") : l("Đã tạo bài viết.", "Article created."));
      await onChanged?.();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteArticle(id) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/admin/articles/${id}`, { method: "DELETE" });
      if (editingId === id) {
        setEditingId("");
        setForm(emptyArticle);
      }
      setMessage(l("Đã xóa bài viết.", "Article deleted."));
      await onChanged?.();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel adminArticles">
      <h2>
        <FileText size={20} />
        {l("Quản lý bài viết hướng dẫn", "Manage guide articles")}
      </h2>

      <form className="articleEditorForm" onSubmit={saveArticle}>
        <div className="inputRow">
          <input
            value={form.slug}
            onChange={(event) => setForm({ ...form, slug: event.target.value })}
            placeholder={l("Slug URL, có thể để trống", "URL slug, optional")}
            aria-label={l("Slug URL", "URL slug")}
          />
        </div>
        <div className="inputRow">
          <input
            className="articleSortInput"
            type="number"
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            placeholder={l("Thứ tự", "Sort order")}
            aria-label={l("Thứ tự", "Sort order")}
          />
          <label className="inlineCheck">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(event) => setForm({ ...form, isPublished: event.target.checked })}
            />
            {l("Hiển thị", "Published")}
          </label>
        </div>
        <input
          value={form.coverImage}
          onChange={(event) => setForm({ ...form, coverImage: event.target.value })}
          placeholder={l("Ảnh đầu bài URL, ví dụ: https://.../step-preview.png", "Cover image URL, e.g. https://.../step-preview.png")}
          aria-label={l("Ảnh đầu bài URL", "Cover image URL")}
        />
        <div className="articleLanguageTabs" role="tablist" aria-label={l("Ngôn ngữ bài viết", "Article language")}>
          {["vi", "en"].map((locale) => (
            <button key={locale} type="button" role="tab" id={`article-tab-${locale}`}
              aria-controls="article-translation" aria-selected={editLanguage === locale}
              tabIndex={editLanguage === locale ? 0 : -1}
              onClick={() => setEditLanguage(locale)}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? "vi" : event.key === "End" ? "en" : locale === "vi" ? "en" : "vi";
                setEditLanguage(next);
                document.getElementById(`article-tab-${next}`)?.focus();
              }}>
              {locale === "vi" ? "Tiếng Việt" : "English"}
              {translationComplete(form.translations[locale]) && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="articleTranslationFields" role="tabpanel" id="article-translation" aria-labelledby={`article-tab-${editLanguage}`}>
          <label htmlFor="article-title">{l("Tiêu đề bài viết", "Article title")} ({editLanguage.toUpperCase()})</label>
          <input id="article-title" lang={editLanguage} value={translation.title} maxLength={160}
            onChange={(event) => updateTranslation("title", event.target.value)} />
          <label htmlFor="article-summary">{l("Mô tả ngắn", "Short summary")}</label>
          <input id="article-summary" lang={editLanguage} value={translation.summary} maxLength={500}
            onChange={(event) => updateTranslation("summary", event.target.value)} />
          <label htmlFor="article-content">{l("Nội dung", "Content")} ({editLanguage.toUpperCase()})</label>
          <textarea id="article-content" lang={editLanguage} value={translation.content} maxLength={20000} rows={10}
            onChange={(event) => updateTranslation("content", event.target.value)} />
        </div>
        <div className="articleEditorActions">
          <button className="smallButton" disabled={busy || !Object.values(form.translations).some(translationComplete)}>
            {editingId ? <Save size={16} /> : <Plus size={16} />}
            {editingId ? l("Lưu bài viết", "Save article") : l("Tạo bài viết", "Create article")}
          </button>
          {editingId && (
            <button type="button" className="smallButton" disabled={busy} onClick={() => startEdit(null)}>
              <RotateCcw size={14} />
              {l("Hủy sửa", "Cancel edit")}
            </button>
          )}
        </div>
      </form>

      {message && <p role={successMessages.has(message) ? "status" : "alert"} className={successMessages.has(message) ? "success" : "error"}>{message}</p>}

      <div className="table articleTable">
        {articles.map((article) => (
          <div className="tableRow" key={article._id}>
            <div>
              <strong>{articleTranslations(article)[language].title || article.title}</strong>
              <small>{article.slug}</small>
            </div>
            <span className="articleSortBadge">#{article.sortOrder ?? 0}</span>
            <span>{Object.entries(articleTranslations(article)).filter(([, fields]) => translationComplete(fields)).map(([locale]) => locale.toUpperCase()).join(" / ")}</span>
            <span className={article.isPublished ? "badge success" : "badge pending"}>
              {article.isPublished ? l("Hiển thị", "Published") : l("Ẩn", "Hidden")}
            </span>
            <div className="articleRowActions">
              <button type="button" className="smallButton" disabled={busy} onClick={() => startEdit(article)}>
                <Pencil size={14} />
                {l("Sửa", "Edit")}
              </button>
              <button type="button" className="smallButton" disabled={busy} onClick={() => deleteArticle(article._id)} style={{ color: "var(--error)" }}>
                <X size={14} />
                {l("Xóa", "Delete")}
              </button>
            </div>
          </div>
        ))}
        {!articles.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>{l("Chưa có bài viết.", "No articles yet.")}</p>}
      </div>
    </section>
  );
}
