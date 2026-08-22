import React, { useEffect, useState } from "react";

const ICON_LABELS = {
  vray: "V-Ray",
  corona: "Corona",
  enscape: "Enscape",
  "d5-render": "D5 Render",
  standard: "Standard",
  "3dsmax": "3ds Max",
  autocad: "AutoCAD",
  sketchup: "SketchUp",
  "fbx-obj": "FBX / OBJ",
};

const DEFAULT_ICON_URLS = {
  vray: "/icons/marketplace/vray.svg",
  corona: "/icons/marketplace/corona.svg",
  enscape: "/icons/marketplace/enscape.svg",
  "d5-render": "/icons/marketplace/d5.png",
  "3dsmax": "/icons/marketplace/3dsmax.svg",
  autocad: "/icons/marketplace/autocad.svg",
  sketchup: "/icons/marketplace/sketchup.svg",
};

function safeIconUrl(value) {
  const url = String(value || "").trim();
  if (url.startsWith("/") && !url.startsWith("//") && !url.includes("\\")) return url;
  try {
    return new URL(url).protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

function IconGraphic({ iconKey }) {
  if (iconKey === "3dsmax") return <b>3</b>;
  if (iconKey === "vray") {
    return <svg viewBox="0 0 24 24"><path d="M3 5.5 10.2 19 21 4.5M7.2 5.5h9.4" /></svg>;
  }
  if (iconKey === "corona") {
    return <svg viewBox="0 0 24 24"><path d="M17.8 5.4a8 8 0 1 0 1.5 10.2" /><circle cx="19.1" cy="7.8" r="1.6" /></svg>;
  }
  if (iconKey === "autocad") {
    return <svg viewBox="0 0 24 24"><path d="m12 3-8 17h4.4l1.4-3.6h4.6l1.4 3.6H20L12 3Zm-.9 10 1.1-3.2 1.1 3.2h-2.2Z" /></svg>;
  }
  if (iconKey === "sketchup") {
    return <svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4v9l-8 5-8-5V7Zm3 1.7v5.5l5 2.8v-5.4L7 8.7Zm5-2.3 4.8 2.4-4.8 2.4-4.8-2.4L12 6.4Z" /></svg>;
  }
  return <svg viewBox="0 0 24 24"><path d="m4 7 8-4 8 4v10l-8 4-8-4V7Zm0 0 8 4 8-4M12 11v10" /></svg>;
}

export default function MarketplaceFacetIcon({ iconKey = "", iconUrl = "", className = "", labelled = false }) {
  const normalized = String(iconKey || "").trim().toLowerCase();
  const customUrl = safeIconUrl(iconUrl);
  const [failedUrl, setFailedUrl] = useState("");
  const defaultUrl = DEFAULT_ICON_URLS[normalized] || "";
  const imageUrl = customUrl && failedUrl !== customUrl
    ? customUrl
    : (defaultUrl && failedUrl !== defaultUrl ? defaultUrl : "");
  const label = ICON_LABELS[normalized] || "Icon";

  useEffect(() => setFailedUrl(""), [customUrl, normalized]);

  if (!imageUrl && !ICON_LABELS[normalized]) return null;
  return (
    <span
      className={`marketFacetBrandIcon ${className}`.trim()}
      data-icon={normalized}
      aria-hidden={labelled ? undefined : "true"}
      aria-label={labelled ? label : undefined}
      role={labelled ? "img" : undefined}
      title={labelled ? label : undefined}
    >
      {imageUrl
        ? <img src={imageUrl} alt="" onError={() => setFailedUrl(imageUrl)} />
        : <IconGraphic iconKey={normalized} />}
    </span>
  );
}

export {
  DEFAULT_ICON_URLS as MARKETPLACE_FACET_DEFAULT_URLS,
  ICON_LABELS as MARKETPLACE_FACET_ICON_LABELS,
};
