import React, { useState } from "react";
import { ImageOff } from "lucide-react";
import { buildApiUrl } from "../api.js";

export default function GetlinkHistoryThumbnail({ imageUrl = "", title = "", language = "vi" }) {
  const [failedSource, setFailedSource] = useState("");
  const source = imageUrl.startsWith("/api/") ? buildApiUrl(imageUrl) : imageUrl;
  const unavailable = language === "vi" ? "Chưa có ảnh preview" : "Preview unavailable";
  const label = language === "vi" ? `Xem ảnh: ${title}` : `View preview: ${title}`;

  if (!source || failedSource === source) {
    return (
      <span className="getlinkHistoryThumbnail getlinkHistoryThumbnailEmpty" role="img" aria-label={unavailable} title={unavailable}>
        <ImageOff size={20} aria-hidden="true" />
      </span>
    );
  }

  return (
    <a className="getlinkHistoryThumbnail" href={source} target="_blank" rel="noreferrer" aria-label={label} title={label}>
      <img
        src={source}
        alt={title}
        width="64"
        height="64"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedSource(source)}
      />
    </a>
  );
}
