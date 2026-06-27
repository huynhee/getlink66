import React, { useMemo, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { api } from "../api.js";

function triggerBrowserDownload(downloadUrl) {
  if (!downloadUrl) return;
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function formatOptionLabel(option = {}, language = "vi") {
  const detail = [
    option.formatVersion ? `${language === "vi" ? "Phiên bản" : "Version"}: ${option.formatVersion}` : "",
    option.rendererLabel ? `${language === "vi" ? "Renderer" : "Renderer"}: ${option.rendererLabel}` : "",
  ].filter(Boolean).join(" / ");
  return {
    title: option.label || option.fileFormat || (language === "vi" ? "Định dạng file" : "File format"),
    detail,
  };
}

export default function RedownloadFormatModal({ item, language = "vi", onClose, onDone }) {
  const options = Array.isArray(item?.formatOptions) ? item.formatOptions : [];
  const [selectedKey, setSelectedKey] = useState(item?.downloadFormat?.key || options[0]?.key || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const selectedFormat = useMemo(
    () => options.find((option) => option.key === selectedKey) || options[0] || null,
    [options, selectedKey],
  );

  if (!item || !options.length) return null;

  async function submit() {
    if (!selectedFormat || loading) return;
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/getlink/redownload/${item._id}`, {
        method: "POST",
        body: JSON.stringify({ downloadFormat: selectedFormat }),
      });
      onDone?.(item._id, data);
      triggerBrowserDownload(data.downloadUrl || data.url);
      onClose?.();
    } catch (err) {
      setError(err.message || (language === "vi" ? "Không chuẩn bị được link tải lại." : "Cannot prepare redownload."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="redownloadFormatOverlay" role="dialog" aria-modal="true">
      <div className="redownloadFormatCard">
        <div className="redownloadFormatHeader">
          <div>
            <span>{language === "vi" ? "Chọn định dạng tải lại" : "Choose redownload format"}</span>
            <strong>{item.title || item.productId}</strong>
          </div>
          <button type="button" className="iconButton" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="formatOptionGrid">
          {options.map((option) => {
            const label = formatOptionLabel(option, language);
            const active = option.key === selectedFormat?.key;
            return (
              <button
                key={option.key}
                type="button"
                className={`formatOption ${active ? "active" : ""}`}
                onClick={() => setSelectedKey(option.key)}
              >
                <strong>{label.title}</strong>
                {label.detail && <small>{label.detail}</small>}
                {option.size && <em>{option.size}</em>}
              </button>
            );
          })}
        </div>

        {error && <p className="formError">{error}</p>}

        <div className="redownloadFormatActions">
          <button type="button" className="ghostButton" onClick={onClose} disabled={loading}>
            {language === "vi" ? "Hủy" : "Cancel"}
          </button>
          <button type="button" onClick={submit} disabled={loading || !selectedFormat}>
            {loading ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
            {language === "vi" ? "Tải lại" : "Redownload"}
          </button>
        </div>
      </div>
    </div>
  );
}
