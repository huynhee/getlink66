import React from "react";

const ICON_LABELS = {
  vray: "V-Ray",
  corona: "Corona",
  standard: "Standard",
  "3dsmax": "3ds Max",
  autocad: "AutoCAD",
  sketchup: "SketchUp",
  "fbx-obj": "FBX / OBJ",
};

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

export default function MarketplaceFacetIcon({ iconKey = "", className = "", labelled = false }) {
  const normalized = String(iconKey || "").trim().toLowerCase();
  if (!ICON_LABELS[normalized]) return null;
  return (
    <span
      className={`marketFacetBrandIcon ${className}`.trim()}
      data-icon={normalized}
      aria-hidden={labelled ? undefined : "true"}
      aria-label={labelled ? ICON_LABELS[normalized] : undefined}
      role={labelled ? "img" : undefined}
      title={labelled ? ICON_LABELS[normalized] : undefined}
    >
      <IconGraphic iconKey={normalized} />
    </span>
  );
}

export { ICON_LABELS as MARKETPLACE_FACET_ICON_LABELS };
