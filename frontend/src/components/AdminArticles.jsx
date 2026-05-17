import React, { useState } from "react";
import { FileText, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";
import { api } from "../api.js";

const emptyArticle = {
  title: "",
  slug: "",
  summary: "",
  coverImage: "",
  content: "",
  language: "vi",
  sortOrder: "",
  isPublished: true
};

function fillForm(article) {
  if (!article) return emptyArticle;
  return {
    title: article.title || "",
    slug: article.slug || "",
    summary: article.summary || "",
    coverImage: article.coverImage || "",
    content: article.content || "",
    language: article.language || "vi",
    sortOrder: article.sortOrder ?? "",
    isPublished: article.isPublished !== false
  };
}

export default function AdminArticles({ articles = [], onChanged }) {
  const [form, setForm] = useState(emptyArticle);
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");

  function startEdit(article) {
    setEditingId(article?._id || "");
    setForm(fillForm(article));
    setMessage("");
  }

  async function saveArticle(event) {
    event.preventDefault();
    setMessage("");
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
      setMessage(editingId ? "Đã lưu bài viết." : "Đã tạo bài viết.");
      await onChanged?.();
    } catch (err) {
      setMessage(err.message);
    }
  }

  async function deleteArticle(id) {
    setMessage("");
    try {
      await api(`/api/admin/articles/${id}`, { method: "DELETE" });
      if (editingId === id) {
        setEditingId("");
        setForm(emptyArticle);
      }
      setMessage("Đã xóa bài viết.");
      await onChanged?.();
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <section className="panel">
      <h2>
        <FileText size={20} />
        Quản lý bài viết hướng dẫn
      </h2>

      <form className="articleEditorForm" onSubmit={saveArticle}>
        <div className="inputRow">
          <input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            placeholder="Tiêu đề bài viết"
          />
          <input
            value={form.slug}
            onChange={(event) => setForm({ ...form, slug: event.target.value })}
            placeholder="Slug URL, có thể để trống"
          />
        </div>
        <div className="inputRow">
          <select value={form.language} onChange={(event) => setForm({ ...form, language: event.target.value })}>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
          <input
            type="number"
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            placeholder="Thứ tự"
          />
          <label className="inlineCheck">
            <input
              type="checkbox"
              checked={form.isPublished}
              onChange={(event) => setForm({ ...form, isPublished: event.target.checked })}
            />
            Hiển thị
          </label>
        </div>
        <input
          value={form.summary}
          onChange={(event) => setForm({ ...form, summary: event.target.value })}
          placeholder="Mô tả ngắn"
        />
        <input
          value={form.coverImage}
          onChange={(event) => setForm({ ...form, coverImage: event.target.value })}
          placeholder="Ảnh đầu bài URL, ví dụ: https://.../step-preview.png"
        />
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          Chèn ảnh chỉ dẫn trong nội dung bằng cú pháp: ![Mô tả bước](https://link-anh.png)
        </p>
        <textarea
          value={form.content}
          onChange={(event) => setForm({ ...form, content: event.target.value })}
          rows={10}
          placeholder={"Nội dung bài viết. Hỗ trợ dòng bắt đầu bằng #, ## và - cho danh sách."}
        />
        <div className="articleEditorActions">
          <button className="smallButton" disabled={!form.title || !form.content}>
            {editingId ? <Save size={16} /> : <Plus size={16} />}
            {editingId ? "Lưu bài viết" : "Tạo bài viết"}
          </button>
          {editingId && (
            <button type="button" className="smallButton" onClick={() => startEdit(null)}>
              <RotateCcw size={14} />
              Hủy sửa
            </button>
          )}
        </div>
      </form>

      {message && <p className={message.startsWith("Đã") ? "success" : "error"}>{message}</p>}

      <div className="table articleTable">
        {articles.map((article) => (
          <div className="tableRow" key={article._id}>
            <div>
              <strong>{article.title}</strong>
              <small>{article.slug}</small>
            </div>
            <span>{article.language?.toUpperCase()}</span>
            <span className={article.isPublished ? "badge success" : "badge pending"}>
              {article.isPublished ? "Hiển thị" : "Ẩn"}
            </span>
            <div className="articleRowActions">
              <button type="button" className="smallButton" onClick={() => startEdit(article)}>
                <Pencil size={14} />
                Sửa
              </button>
              <button type="button" className="smallButton" onClick={() => deleteArticle(article._id)} style={{ color: "var(--error)" }}>
                <X size={14} />
                Xóa
              </button>
            </div>
          </div>
        ))}
        {!articles.length && <p className="muted" style={{ textAlign: "center", padding: 16 }}>Chưa có bài viết.</p>}
      </div>
    </section>
  );
}
