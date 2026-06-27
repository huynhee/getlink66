import React, { useMemo, useState } from "react";
import { Check, Download, Loader2, X } from "lucide-react";
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
  return {
    title: option.label || option.fileFormat || (language === "vi" ? "Định dạng file" : "File format"),
    versionLabel: language === "vi" ? "Phiên bản" : "Version",
    rendererLabel: "Renderer",
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

        <div className="formatSelectorHeader">
          <span>{language === "vi" ? "Định dạng file" : "File format"}</span>
          <span>{language === "vi" ? "Dung lượng nén" : "Package size"}</span>
        </div>
        <div className="formatOptionList">
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
                <span className="formatOptionCheck">{active && <Check size={12} />}</span>
                <span className="formatOptionInfo">
                  <strong>{label.title}</strong>
                  <span className="formatOptionMeta">
                    {option.formatVersion && <small>{label.versionLabel}: {option.formatVersion}</small>}
                    {option.rendererLabel && <small>{label.rendererLabel}: {option.rendererLabel}</small>}
                  </span>
                </span>
                {option.size && <em className="formatOptionSize">{option.size}</em>}
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
