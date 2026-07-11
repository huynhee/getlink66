import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, ClipboardPaste, Download, Filter, Image as ImageIcon, ImagePlus, Loader2, Package, Search, Upload, X } from "lucide-react";
import { api, buildApiUrl } from "../api.js";

const EMPTY_FILTERS = {
  style: [],
  render: [],
  form: [],
  color: [],
  material: [],
};

const FILTER_TITLES_EN = {
  style: "Style",
  render: "Render",
  form: "Form",
  color: "Color",
  material: "Material",
};

const FILTER_TITLES_VI = {
  style: "Phong cách",
  render: "Render",
  form: "Hình dạng",
  color: "Màu sắc",
  material: "Vật liệu",
};

const FACET_LABELS_VI = {
  style: {
    classic: "Cổ điển",
    modern: "Hiện đại",
    ethnic: "Truyền thống",
  },
  render: {
    vray: "Vray",
    corona: "Corona",
    standard: "Standard",
  },
  form: {
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
    "l-shape": "Angle",
    organic: "Bioform",
  },
  color: {
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
  },
  material: {
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
  },
};

const CATEGORY_LABELS_VI = {
  "3D panel": "Tấm 3D",
  "Air Transport": "Phương tiện hàng không",
  "Architecture": "Kiến trúc",
  "Arm chair": "Ghế bành",
  "Audio tech": "Thiết bị âm thanh",
  "Barbecue and grill": "BBQ và lò nướng",
  "Bathroom": "Phòng tắm",
  "Bathroom accessories": "Phụ kiện phòng tắm",
  "Bathroom furniture": "Nội thất phòng tắm",
  "Bathtub": "Bồn tắm",
  "Beauty salon": "Salon làm đẹp",
  "Bed": "Giường",
  "Billiards": "Bida",
  "Books": "Sách",
  "Bouquet": "Bó hoa",
  "Brick": "Gạch",
  "Building": "Công trình",
  "Bush": "Bụi cây",
  "Carpets": "Thảm",
  "Ceiling lamp": "Đèn trần",
  "Chair": "Ghế",
  "Childroom": "Phòng trẻ em",
  "Clothes and Footwear": "Quần áo và giày dép",
  "Console": "Bàn console",
  "Creature": "Sinh vật",
  "Curtain": "Rèm cửa",
  "Decoration": "Trang trí",
  "Decorative plaster": "Phào chỉ trang trí",
  "Decorative set": "Bộ trang trí",
  "Doors": "Cửa",
  "Dressing table": "Bàn trang điểm",
  "Environment elements": "Yếu tố môi trường",
  "Facade element": "Chi tiết mặt tiền",
  "Fabric": "Vải",
  "Faucet": "Vòi nước",
  "Fence": "Hàng rào",
  "Fireplace": "Lò sưởi",
  "Fitowall": "Tường cây",
  "Floor coverings": "Vật liệu sàn",
  "Floor lamp": "Đèn sàn",
  "Food and drinks": "Đồ ăn và đồ uống",
  "Frame": "Khung tranh",
  "Full furniture set": "Bộ nội thất đầy đủ",
  "Furniture": "Nội thất",
  "Glass": "Kính",
  "Grass": "Cỏ",
  "Ground Transport": "Phương tiện mặt đất",
  "HDRI": "HDRI",
  "Hallway": "Sảnh/hành lang",
  "Headboards": "Đầu giường",
  "Household appliance": "Thiết bị gia dụng",
  "Indoor": "Cây trong nhà",
  "Kitchen": "Bếp",
  "Kitchen appliance": "Thiết bị bếp",
  "Leather": "Da",
  "Lighting": "Đèn",
  "Liquid": "Chất lỏng",
  "Materials": "Vật liệu",
  "Metal": "Kim loại",
  "Mirror": "Gương",
  "Miscellaneous": "Khác",
  "Musical instrument": "Nhạc cụ",
  "Natural materials": "Vật liệu tự nhiên",
  "Neon": "Đèn neon",
  "Office furniture": "Nội thất văn phòng",
  "Other": "Khác",
  "Other Models": "Model khác",
  "Other decorative objects": "Đồ trang trí khác",
  "Other kitchen accessories": "Phụ kiện bếp khác",
  "Other soft seating": "Ghế mềm khác",
  "Outdoor": "Cây ngoài trời",
  "Panorama": "Panorama",
  "PC & other electronics": "PC và điện tử khác",
  "Pendant light": "Đèn thả",
  "Phones": "Điện thoại",
  "Paving": "Lát nền",
  "Pillows": "Gối",
  "Plants": "Cây",
  "Plastic": "Nhựa",
  "Playground": "Sân chơi",
  "Rack": "Kệ",
  "Radiator": "Bộ tản nhiệt",
  "Restaurant": "Nhà hàng",
  "Rug": "Thảm trải",
  "Scripts": "Script",
  "Sculpture": "Tượng",
  "Shower": "Vòi sen",
  "Shop": "Cửa hàng",
  "Sideboard & Chest of drawer": "Tủ thấp và tủ ngăn kéo",
  "Sink": "Bồn rửa",
  "Sofa": "Sofa",
  "Spot light": "Đèn rọi",
  "Sports": "Thể thao",
  "Staircase": "Cầu thang",
  "Stone": "Đá",
  "Street lighting": "Đèn đường",
  "Table": "Bàn",
  "Table + Chair": "Bàn + ghế",
  "Table lamp": "Đèn bàn",
  "Technical lighting": "Đèn kỹ thuật",
  "Technology": "Công nghệ",
  "Textures": "Texture",
  "Tile": "Gạch ốp/lát",
  "Toilet and Bidet": "Bồn cầu và bidet",
  "Towel rail": "Thanh treo khăn",
  "Transport": "Phương tiện",
  "Tree": "Cây thân gỗ",
  "TV": "TV",
  "TV Wall": "Vách TV",
  "Urban environment": "Môi trường đô thị",
  "Vase": "Bình hoa",
  "Wall covering": "Vật liệu tường",
  "Wall light": "Đèn tường",
  "Wardrobe": "Tủ quần áo",
  "Wardrobe & Display cabinets": "Tủ quần áo và tủ trưng bày",
  "Wash basin": "Chậu rửa mặt",
  "Watches & Clocks": "Đồng hồ",
  "Water Transport": "Phương tiện đường thủy",
  "Weapon": "Vũ khí",
  "Windows": "Cửa sổ",
  "Wood": "Gỗ",
};

function cover(model = {}) {
  const image = model.coverImage || model.previewImages?.[0];
  const url = image?.cachedUrl || image?.url || "";
  return url.startsWith("/api/") ? buildApiUrl(url) : url;
}

function previewImageSrc(image = {}) {
  const url = image.cachedUrl || image.url || "";
  return url.startsWith("/api/") ? buildApiUrl(url) : url;
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return "-";
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function modelPath(model = {}) {
  const slugOrId = model.slug || model._id || "";
  return `/models/${encodeURIComponent(slugOrId)}`;
}

function detailSlugFromPath(path = "") {
  const match = String(path).match(/^\/models\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function navigateTo(path, onNavigate, event) {
  if (event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
  }
  if (onNavigate) onNavigate(path);
  else window.location.assign(path);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function accessBadgeClass(accessType) {
  if (accessType === "free") return "success";
  return "pending";
}

function accessLabel(accessType) {
  return accessType === "free" ? "free" : "pro";
}

function statusBadgeClass(fileStatus) {
  if (fileStatus === "ready") return "success";
  if (fileStatus === "failed") return "error";
  return "pending";
}

function labelForCategory(category, language = "vi") {
  const englishLabel = category?.titleEn || category?.title || "";
  if (language !== "vi") return englishLabel;
  return CATEGORY_LABELS_VI[englishLabel] || englishLabel;
}

function findCategoryBySlug(categories = [], slug = "") {
  for (const item of categories) {
    if (item.slug === slug) return item;
    const child = findCategoryBySlug(item.children || [], slug);
    if (child) return child;
  }
  return null;
}

function parentSlugForCategory(categories = [], slug = "") {
  for (const item of categories) {
    if (item.slug === slug) return item.slug;
    if ((item.children || []).some((child) => child.slug === slug)) return item.slug;
    const nested = parentSlugForCategory(item.children || [], slug);
    if (nested) return nested;
  }
  return "";
}

function labelForFacet(filterOptions = {}, facet, value, language = "vi") {
  if (language === "vi" && FACET_LABELS_VI[facet]?.[value]) return FACET_LABELS_VI[facet][value];
  return filterOptions[facet]?.find((item) => item.value === value)?.label || value;
}

function modelCategoryLabel(model = {}, language = "vi") {
  return labelForCategory(model.category, language) || labelForCategory(model.parentCategory, language) || "";
}

function textFor(language, vi, en) {
  return language === "vi" ? vi : en;
}

function CategoryButton({ category, selected, isOpen, onOpen, onSelect, language = "vi" }) {
  const children = category.children || [];
  const hasChildren = children.length > 0;
  const childSelected = children.some((child) => selected === child.slug);
  const parentSelected = selected === category.slug;
  const active = parentSelected || childSelected;

  function selectParent() {
    if (hasChildren) {
      onOpen(isOpen ? "" : category.slug);
      return;
    }
    onSelect(parentSelected ? "" : category.slug);
  }

  return (
    <div className={`marketCategoryGroup ${isOpen ? "open" : ""}`}>
      <button
        type="button"
        className={`marketCategoryRow parent ${active ? "active" : ""}`}
        aria-expanded={hasChildren ? isOpen : undefined}
        onClick={selectParent}
      >
        {!hasChildren && <span className={`marketCategoryCheck ${parentSelected ? "checked" : ""}`} aria-hidden="true" />}
        <span>{labelForCategory(category, language)}</span>
        {hasChildren && <ChevronRight className="marketCategoryArrow" size={15} aria-hidden="true" />}
      </button>
      {hasChildren && isOpen && (
        <div className="marketSubcategoryList">
          {children.map((child) => (
            <button
              type="button"
              key={child._id || child.slug}
              className={`marketCategoryRow child ${selected === child.slug ? "active" : ""}`}
              onClick={() => onSelect(selected === child.slug ? "" : child.slug)}
            >
              <span className={`marketCategoryCheck ${selected === child.slug ? "checked" : ""}`} aria-hidden="true" />
              <span>{labelForCategory(child, language)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function toggleListValue(items, value) {
  return items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
}

function paginationItems(currentPage = 1, totalPages = 1) {
  const total = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(total, Math.max(1, Number(currentPage) || 1));
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (current >= total - 2) {
    pages.add(total - 3);
    pages.add(total - 2);
    pages.add(total - 1);
  }

  const ordered = Array.from(pages)
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => a - b);
  return ordered.flatMap((page, index) => {
    if (index === 0) return [page];
    return page - ordered[index - 1] > 1 ? [`gap-${ordered[index - 1]}-${page}`, page] : [page];
  });
}

function ShapeIcon({ value }) {
  const shape = value === "l-shape" ? "angle" : value === "organic" ? "bioform" : value;
  return (
    <svg className="marketShapeIcon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {shape === "round" && <circle cx="12" cy="12" r="8" />}
      {shape === "oval" && <ellipse cx="12" cy="12" rx="8.6" ry="4.6" />}
      {shape === "square" && <rect x="6" y="6" width="12" height="12" />}
      {shape === "rectangle" && <rect x="4.5" y="8" width="15" height="8" />}
      {shape === "triangle" && <polygon points="12 4.5 21 19 3 19" />}
      {shape === "diamond" && <polygon points="12 4 20 12 12 20 4 12" />}
      {shape === "pentagon" && <polygon points="12 4 20 10.5 17 20 7 20 4 10.5" />}
      {shape === "star" && <polygon points="12 3.5 14.6 8.8 20.5 9.6 16.25 13.75 17.25 19.6 12 16.85 6.75 19.6 7.75 13.75 3.5 9.6 9.4 8.8" />}
      {shape === "angle" && <polyline points="6 5 6 18 18 18" />}
      {shape === "bioform" && <path d="M8.4 7.6c1.4-3.1 5-3 6.1-.2 3.4-.4 5.2 3.5 2.8 5.7 1.4 3.6-2.4 6.2-5.4 4.1-2.7 2.4-6.5.5-5.8-3.1-3.3-1.5-2.2-5.8 1.3-5.7.3-.3.6-.6 1-.8Z" />}
    </svg>
  );
}

function FacetSection({ id, title, options = [], values = [], onToggle, onClear, language = "vi" }) {
  if (!options.length) return null;
  const isColor = id === "color";
  const isShape = id === "form";
  const isCompact = ["render", "form"].includes(id);
  const selectedCount = values.length;
  return (
    <div className={`marketFacetSection ${id} ${selectedCount ? "hasSelection" : ""}`}>
      <div className="marketFacetHeader">
        <h3>{title}</h3>
        {selectedCount > 0 && (
          <button
            type="button"
            className="marketFacetClear"
            onClick={() => onClear(id)}
            aria-label={textFor(language, `Xóa ${title}`, `Clear ${title}`)}
            title={textFor(language, `Xóa ${title}`, `Clear ${title}`)}
          >
            <span>{selectedCount}</span>
            <X size={12} />
          </button>
        )}
      </div>
      <div className={isColor ? "marketColorFacetGrid" : isCompact ? "marketFacetOptions compact" : "marketFacetOptions"}>
        {options.map((option) => {
          const checked = values.includes(option.value);
          const label = labelForFacet({ [id]: options }, id, option.value, language);
          return (
            <button
              type="button"
              key={option.value}
              className={`marketFacetOption ${checked ? "active" : ""} ${isColor ? "color" : ""} ${isShape ? "shape" : ""}`}
              onClick={() => onToggle(id, option.value)}
              aria-label={label}
              title={label}
            >
              {isColor ? (
                <span className="marketColorSwatch" style={{ backgroundColor: option.hex }} aria-hidden="true" />
              ) : isShape ? (
                <ShapeIcon value={option.value} />
              ) : (
                <span className={`marketCategoryCheck ${checked ? "checked" : ""}`} aria-hidden="true" />
              )}
              {!isColor && !isShape && <span>{label}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModelCard({ model, onNavigate }) {
  const image = cover(model);
  const href = modelPath(model);
  const hoverMeta = [
    model.sizeText || formatBytes(model.fileSize),
    model.renderer,
  ].filter(Boolean).join(" / ");
  return (
    <a className="marketModelCard" href={href} onClick={(event) => navigateTo(href, onNavigate, event)}>
      <div className="marketModelThumb">
        {image ? (
          <img src={image} alt={model.title} loading="lazy" referrerPolicy="no-referrer" />
        ) : (
          <Package size={32} />
        )}
        <span className={`badge ${accessBadgeClass(model.accessType)}`}>{accessLabel(model.accessType)}</span>
        {hoverMeta && <span className="marketModelHoverMeta">{hoverMeta}</span>}
      </div>
      <strong>{model.title}</strong>
    </a>
  );
}

function ModelPreview({ model }) {
  const images = model.previewImages || [];
  const firstPreview = previewImageSrc(images[0]) || cover(model);
  const [activeImage, setActiveImage] = useState(firstPreview);

  useEffect(() => {
    setActiveImage(firstPreview);
  }, [firstPreview]);

  return (
    <div className="marketDetailMedia">
      <div className={`marketDetailImage ${activeImage ? "" : "empty"}`}>
        {activeImage ? (
          <img src={activeImage} alt={model.title} referrerPolicy="no-referrer" />
        ) : (
          <Package size={48} />
        )}
      </div>
      {images.length > 1 && (
        <div className="marketPreviewStrip">
          {images.slice(0, 8).map((image, index) => {
            const src = previewImageSrc(image);
            if (!src) return null;
            return (
              <button
                type="button"
                key={`${src}-${index}`}
                className={src === activeImage ? "active" : ""}
                onClick={() => setActiveImage(src)}
                aria-label={`Preview ${index + 1}`}
              >
                <img src={src} alt={image.alt || model.title} loading="lazy" referrerPolicy="no-referrer" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetailFacetList({ facet, values = [], filterOptions = {}, language = "vi", fallback = "" }) {
  const normalizedValues = Array.isArray(values) ? values.filter(Boolean) : [];
  if (!normalizedValues.length && !fallback) return <span className="marketMetaEmpty">-</span>;
  if (!normalizedValues.length) return <span className="marketDetailFacetText">{fallback}</span>;

  const options = filterOptions[facet] || [];
  return (
    <div className={`marketDetailFacetList ${facet}`}>
      {normalizedValues.map((value) => {
        const option = options.find((item) => item.value === value) || { value, label: value };
        const label = labelForFacet({ [facet]: options }, facet, value, language);
        return (
          <span className={`marketDetailFacetChip ${facet}`} key={`${facet}-${value}`} title={label}>
            {facet === "form" && <ShapeIcon value={value} />}
            {facet === "color" && (
              <i
                className="marketColorSwatch"
                style={{ backgroundColor: option.hex || value }}
                aria-hidden="true"
              />
            )}
            <span>{label}</span>
          </span>
        );
      })}
    </div>
  );
}

function ModelMetaRow({ label, value, children }) {
  return (
    <div className="marketMetaRow">
      <span>{label}</span>
      <div className="marketMetaValue">
        {children || <strong>{value || "-"}</strong>}
      </div>
    </div>
  );
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

async function fileToSearchImageData(file) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("File phải là ảnh.");
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(objectUrl);
    const maxSize = 384;
    const ratio = Math.min(1, maxSize / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    const width = Math.max(1, Math.round((image.naturalWidth || 1) * ratio));
    const height = Math.max(1, Math.round((image.naturalHeight || 1) * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);
    const imageData = canvas.toDataURL("image/jpeg", 0.68);
    return { imageData, width, height };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function imageSearchErrorMessage(message, language) {
  const value = String(message || "");
  if (language !== "vi") return value || "Image search failed.";
  if (value.includes("not configured") || value.includes("not available")) {
    return "Hệ thống tìm ảnh chưa được cấu hình.";
  }
  if (value.includes("Login is required")) return "Cần đăng nhập để tìm kiếm bằng hình ảnh.";
  if (value.includes("quota exceeded")) return "Bạn đã hết lượt tìm kiếm hình ảnh hôm nay.";
  if (value.includes("too large")) return "Ảnh tìm kiếm có dung lượng quá lớn.";
  if (value.includes("Invalid image")) return "Ảnh tìm kiếm không hợp lệ.";
  return value || "Không tìm kiếm được bằng hình ảnh.";
}

function ImageSearchDialog({
  open,
  language,
  file,
  preview,
  searching,
  error,
  onSelectFile,
  onError,
  onSearch,
  onClose,
}) {
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();

    function handlePaste(event) {
      const item = Array.from(event.clipboardData?.items || [])
        .find((candidate) => candidate.type?.startsWith("image/"));
      const pastedFile = item?.getAsFile();
      if (!pastedFile) return;
      event.preventDefault();
      onSelectFile(new File(
        [pastedFile],
        pastedFile.name || `clipboard-${Date.now()}.png`,
        { type: pastedFile.type || "image/png" },
      ));
    }

    function handleKeyDown(event) {
      if (event.key === "Escape" && !searching) onClose();
    }

    document.addEventListener("paste", handlePaste);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, onSelectFile, open, searching]);

  if (!open) return null;

  async function readClipboardImage() {
    onError("");
    try {
      if (!navigator.clipboard?.read) throw new Error("Clipboard image reading is not available.");
      const clipboardItems = await navigator.clipboard.read();
      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        onSelectFile(new File([blob], `clipboard-${Date.now()}.${imageType.split("/")[1] || "png"}`, { type: imageType }));
        return;
      }
      throw new Error("Clipboard does not contain an image.");
    } catch (clipboardError) {
      onError(language === "vi"
        ? "Không đọc được ảnh trong clipboard."
        : clipboardError.message || "Cannot read an image from the clipboard.");
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    const droppedFile = Array.from(event.dataTransfer?.files || [])
      .find((candidate) => candidate.type?.startsWith("image/"));
    if (droppedFile) onSelectFile(droppedFile);
  }

  return (
    <div
      className="marketImageSearchOverlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !searching) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="marketImageSearchDialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-image-search-title"
        tabIndex={-1}
      >
        <header className="marketImageSearchDialogHeader">
          <h2 id="market-image-search-title">
            <ImagePlus size={20} />
            {language === "vi" ? "Tìm model bằng ảnh" : "Search models by image"}
          </h2>
          <button
            type="button"
            className="iconButton"
            onClick={onClose}
            disabled={searching}
            aria-label={language === "vi" ? "Đóng" : "Close"}
            title={language === "vi" ? "Đóng" : "Close"}
          >
            <X size={18} />
          </button>
        </header>

        <div
          className={`marketImageSearchDropzone ${preview ? "hasImage" : ""}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {preview ? (
            <img src={preview} alt={file?.name || "Image search preview"} />
          ) : (
            <ImageIcon size={42} />
          )}
        </div>

        {file && (
          <div className="marketImageSearchFileMeta">
            <strong>{file.name || (language === "vi" ? "Ảnh clipboard" : "Clipboard image")}</strong>
            <span>{Math.max(1, Math.ceil(Number(file.size || 0) / 1024)).toLocaleString(language === "vi" ? "vi-VN" : "en-US")} KB</span>
          </div>
        )}

        <div className="marketImageSearchActions">
          <button type="button" className="smallButton" onClick={() => inputRef.current?.click()} disabled={searching}>
            <Upload size={16} />
            {language === "vi" ? "Chọn ảnh" : "Choose image"}
          </button>
          <button type="button" className="smallButton" onClick={readClipboardImage} disabled={searching}>
            <ClipboardPaste size={16} />
            {language === "vi" ? "Dán ảnh" : "Paste image"}
          </button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(event) => {
            const selectedFile = event.target.files?.[0];
            event.target.value = "";
            if (selectedFile) onSelectFile(selectedFile);
          }}
        />

        {error && <p className="error marketImageSearchDialogError">{error}</p>}

        <footer className="marketImageSearchDialogFooter">
          <button type="button" className="smallButton" onClick={onClose} disabled={searching}>
            {language === "vi" ? "Hủy" : "Cancel"}
          </button>
          <button type="button" className="primaryButton" onClick={onSearch} disabled={!file || searching}>
            {searching ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            {searching
              ? (language === "vi" ? "Đang tìm..." : "Searching...")
              : (language === "vi" ? "Tìm model" : "Search models")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ModelListPage({ user, language, onNavigate }) {
  const [categories, setCategories] = useState([]);
  const [filterOptions, setFilterOptions] = useState({});
  const [models, setModels] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [openCategory, setOpenCategory] = useState("");
  const [activeFilters, setActiveFilters] = useState(EMPTY_FILTERS);
  const [accessType, setAccessType] = useState("");
  const [imageSearchMeta, setImageSearchMeta] = useState(null);
  const [imageSearchPreview, setImageSearchPreview] = useState("");
  const [imageSearching, setImageSearching] = useState(false);
  const [imageSearchOpen, setImageSearchOpen] = useState(false);
  const [imageSearchFile, setImageSearchFile] = useState(null);
  const [imageSearchDraftPreview, setImageSearchDraftPreview] = useState("");
  const [imageSearchDialogError, setImageSearchDialogError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadCategories() {
    const data = await api("/api/marketplace/categories");
    setCategories(data.categories || []);
  }

  async function loadFilterOptions() {
    const data = await api("/api/marketplace/filters");
    setFilterOptions(data.filters || {});
  }

  function toggleFacetValue(facet, value) {
    setActiveFilters((current) => ({
      ...current,
      [facet]: toggleListValue(current[facet] || [], value),
    }));
  }

  function clearFacet(facet) {
    setActiveFilters((current) => ({
      ...current,
      [facet]: [],
    }));
  }

  function clearAllFilters() {
    setCategory("");
    setOpenCategory("");
    setActiveFilters(EMPTY_FILTERS);
    setAccessType("");
  }

  const loadModels = useCallback(async (page = 1, options = {}) => {
    const query = new URLSearchParams({ page: String(page), limit: "60" });
    if (search.trim()) query.set("q", search.trim());
    if (category) query.set("category", category);
    if (accessType) query.set("accessType", accessType);
    Object.entries(activeFilters).forEach(([key, values]) => {
      if (values?.length) query.set(key, values.join(","));
    });
    setLoading(true);
    setError("");
    if (options.clearImage !== false) {
      setImageSearchMeta(null);
      setImageSearchPreview("");
    }
    try {
      const data = await api(`/api/marketplace/models?${query.toString()}`);
      setModels(data.models || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [accessType, activeFilters, category, search]);

  async function searchByImage(file) {
    if (!user) {
      setImageSearchDialogError(language === "vi" ? "Cần đăng nhập để tìm kiếm bằng hình ảnh." : "Login is required for image search.");
      return false;
    }
    setImageSearching(true);
    setError("");
    setImageSearchDialogError("");
    try {
      const payload = await fileToSearchImageData(file);
      setImageSearchPreview(payload.imageData);
      const data = await api("/api/marketplace/image-search", {
        method: "POST",
        body: JSON.stringify({
          imageData: payload.imageData,
          fileName: file.name,
          accessType,
          category,
          ...activeFilters,
          limit: 60,
        }),
      });
      setModels(data.models || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
      setImageSearchMeta(data.imageSearch || null);
      return true;
    } catch (err) {
      setImageSearchDialogError(imageSearchErrorMessage(err.message, language));
      return false;
    } finally {
      setImageSearching(false);
    }
  }

  function selectImageSearchFile(file) {
    setImageSearchDialogError("");
    if (!file?.type?.startsWith("image/")) {
      setImageSearchDialogError(language === "vi" ? "File phải là ảnh." : "The selected file must be an image.");
      return;
    }
    if (Number(file.size || 0) > 20 * 1024 * 1024) {
      setImageSearchDialogError(language === "vi" ? "Ảnh không được lớn hơn 20 MB." : "The image must not exceed 20 MB.");
      return;
    }
    setImageSearchFile(file);
    setImageSearchDraftPreview(URL.createObjectURL(file));
  }

  function closeImageSearchDialog() {
    if (imageSearching) return;
    setImageSearchOpen(false);
    setImageSearchFile(null);
    setImageSearchDraftPreview("");
    setImageSearchDialogError("");
  }

  async function submitImageSearch() {
    if (!imageSearchFile) return;
    const searched = await searchByImage(imageSearchFile);
    if (searched) closeImageSearchDialog();
  }

  useEffect(() => () => {
    if (imageSearchDraftPreview.startsWith("blob:")) URL.revokeObjectURL(imageSearchDraftPreview);
  }, [imageSearchDraftPreview]);

  useEffect(() => {
    loadCategories().catch(() => { });
    loadFilterOptions().catch(() => { });
  }, []);

  useEffect(() => {
    if (!category || openCategory) return;
    const parentSlug = parentSlugForCategory(categories, category);
    if (parentSlug) setOpenCategory(parentSlug);
  }, [categories, category, openCategory]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadModels(1);
    }, 200);
    return () => window.clearTimeout(timer);
  }, [loadModels]);

  const activeFilterCount = useMemo(
    () => Object.values(activeFilters).reduce((total, values) => total + (values?.length || 0), 0),
    [activeFilters],
  );
  const totalFilterCount = activeFilterCount + (category ? 1 : 0) + (accessType ? 1 : 0);
  const pageItems = useMemo(
    () => paginationItems(pagination.page, pagination.totalPages),
    [pagination.page, pagination.totalPages],
  );
  const filterChips = useMemo(() => {
    const chips = [];
    if (category) {
      chips.push({
        key: `category:${category}`,
        label: labelForCategory(findCategoryBySlug(categories, category), language) || category,
        onRemove: () => setCategory(""),
      });
    }
    if (accessType) {
      chips.push({
        key: `access:${accessType}`,
        label: accessType === "pro" ? "PRO" : "FREE",
        onRemove: () => setAccessType(""),
      });
    }
    Object.entries(activeFilters).forEach(([facet, values]) => {
      (values || []).forEach((value) => {
        chips.push({
          key: `${facet}:${value}`,
          label: labelForFacet(filterOptions, facet, value, language),
          onRemove: () => toggleFacetValue(facet, value),
        });
      });
    });
    return chips;
  }, [activeFilters, accessType, categories, category, filterOptions, language]);

  function goToPage(page) {
    const target = Math.min(Math.max(1, Number(page) || 1), Math.max(1, pagination.totalPages || 1));
    if (target === pagination.page || loading) return;
    loadModels(target).then(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  return (
    <>
      <div className="marketLayout">
      <aside className="marketSidebar panel">
        <h2>
          <Filter size={20} />
          {textFor(language, "Bộ lọc", "Filters")}
          <span className={`marketFilterCount ${totalFilterCount ? "active" : ""}`}>{totalFilterCount}</span>
        </h2>
        <div className="marketSidebarActions">
          <button
            type="button"
            className={!totalFilterCount ? "active smallButton" : "smallButton"}
            onClick={clearAllFilters}
          >
            {language === "vi" ? "Tất cả" : "All"}
          </button>
          {totalFilterCount > 0 && (
            <button type="button" className="smallButton" onClick={clearAllFilters}>
              <X size={15} />
              {textFor(language, "Xóa", "Clear")}
            </button>
          )}
        </div>
        <div className={`marketFilterBlock ${category ? "hasSelection" : ""}`}>
          <div className="marketFilterBlockTitle">
            <span>{textFor(language, "Danh mục", "Category")}</span>
            {category && (
              <button
                type="button"
                className="marketFacetClear"
                onClick={() => setCategory("")}
                aria-label={textFor(language, "Xóa danh mục", "Clear category")}
                title={textFor(language, "Xóa danh mục", "Clear category")}
              >
                <span>1</span>
                <X size={12} />
              </button>
            )}
          </div>
          <div className="marketCategoryList">
            {categories.map((item) => (
              <CategoryButton
                key={item._id || item.slug}
                category={item}
                selected={category}
                isOpen={openCategory === item.slug}
                onOpen={setOpenCategory}
                onSelect={setCategory}
                language={language}
              />
            ))}
          </div>
        </div>
        <div className="marketFilterBlock">
          <div className="marketFacetList">
            {Object.keys(FILTER_TITLES_EN).map((facet) => (
              <FacetSection
                key={facet}
                id={facet}
                title={(language === "vi" ? FILTER_TITLES_VI : FILTER_TITLES_EN)[facet]}
                options={filterOptions[facet] || []}
                values={activeFilters[facet] || []}
                onToggle={toggleFacetValue}
                onClear={clearFacet}
                language={language}
              />
            ))}
          </div>
        </div>
      </aside>

      <section className="marketContent">
        <div className="panel marketSearchPanel">
          <div className="marketSearchCenter">
            <label className="marketSearchField">
              <Search size={18} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={language === "vi" ? "Tìm kiếm model..." : "Search model..."}
              />
              <button
                type="button"
                className="marketImageSearchButton"
                disabled={imageSearching}
                onClick={() => {
                  setImageSearchDialogError("");
                  setImageSearchOpen(true);
                }}
                aria-label={language === "vi" ? "Tìm bằng hình ảnh" : "Search by image"}
                title={language === "vi" ? "Tìm bằng hình ảnh" : "Search by image"}
              >
                <ImagePlus size={17} />
              </button>
            </label>
            <div className="marketAccessToggle" role="group" aria-label="Access filter">
              {["pro", "free"].map((value) => (
                <button
                  type="button"
                  key={value}
                  className={accessType === value ? "active" : ""}
                  onClick={() => setAccessType(accessType === value ? "" : value)}
                >
                  {value === "pro" ? "Pro" : "Free"}
                </button>
              ))}
            </div>
          </div>
          <div className="marketResultBar">
            <span>{pagination.total || 0} {textFor(language, "model", "models found")}</span>
            {filterChips.length > 0 && (
              <div className="marketFilterChips">
                {filterChips.map((chip) => (
                  <button type="button" key={chip.key} className="marketFilterChip" onClick={chip.onRemove}>
                    {chip.label}
                    <X size={12} />
                  </button>
                ))}
                <button type="button" className="marketClearLink" onClick={clearAllFilters}>
                  {textFor(language, "Xóa bộ lọc", "Clear filters")}
                </button>
              </div>
            )}
          </div>
          {imageSearchMeta && (
            <div className="marketImageSearchMeta">
              {imageSearchPreview && <img src={imageSearchPreview} alt="Image search preview" />}
              <span>{language === "vi" ? "Kết quả tìm bằng hình ảnh" : "Image search results"}</span>
              <button type="button" className="smallButton" onClick={() => loadModels(1)}>
                <X size={15} />
                {textFor(language, "Xóa", "Clear")}
              </button>
            </div>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        {loading && <p className="success">{language === "vi" ? "Đang tải..." : "Loading..."}</p>}
        <div className="marketGrid">
          {models.map((model) => <ModelCard key={model._id} model={model} onNavigate={onNavigate} />)}
        </div>
        {!loading && !models.length && (
          <section className="panel emptyState">
            <p>{language === "vi" ? "Chưa có model phù hợp." : "No matching models yet."}</p>
          </section>
        )}
        <nav className="marketPagination" aria-label={textFor(language, "Phân trang model", "Model pagination")}>
          <span>{pagination.page}/{pagination.totalPages}</span>
          <button type="button" disabled={pagination.page <= 1 || loading} onClick={() => goToPage(1)}>{textFor(language, "Đầu", "First")}</button>
          <button type="button" disabled={pagination.page <= 1 || loading} onClick={() => goToPage(pagination.page - 1)}>{textFor(language, "Trước", "Prev")}</button>
          <div className="marketPageNumbers">
            {pageItems.map((item) => (
              typeof item === "number" ? (
                <button
                  type="button"
                  key={item}
                  className={item === pagination.page ? "active" : ""}
                  disabled={loading}
                  onClick={() => goToPage(item)}
                >
                  {item}
                </button>
              ) : (
                <span key={item}>...</span>
              )
            ))}
          </div>
          <button type="button" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => goToPage(pagination.page + 1)}>{textFor(language, "Sau", "Next")}</button>
          <button type="button" disabled={pagination.page >= pagination.totalPages || loading} onClick={() => goToPage(pagination.totalPages)}>{textFor(language, "Cuối", "Last")}</button>
        </nav>
        </section>
      </div>
      <ImageSearchDialog
        open={imageSearchOpen}
        language={language}
        file={imageSearchFile}
        preview={imageSearchDraftPreview}
        searching={imageSearching}
        error={imageSearchDialogError}
        onSelectFile={selectImageSearchFile}
        onError={setImageSearchDialogError}
        onSearch={submitImageSearch}
        onClose={closeImageSearchDialog}
      />
    </>
  );
}

function ModelDetailPage({ slug, user, language, onNavigate, onUserChange }) {
  const [model, setModel] = useState(null);
  const [recommendedModels, setRecommendedModels] = useState([]);
  const [filterOptions, setFilterOptions] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage("");
    setError("");
    Promise.all([
      api(`/api/marketplace/models/${encodeURIComponent(slug)}`),
      api("/api/marketplace/filters").catch(() => ({ filters: EMPTY_FILTERS })),
    ])
      .then(([data, filterData]) => {
        if (!active) return;
        setModel(data.model || null);
        setRecommendedModels(data.recommendedModels || []);
        setFilterOptions(filterData.filters || EMPTY_FILTERS);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug]);

  async function downloadModel() {
    if (!model) return;
    setDownloading(true);
    setMessage("");
    setError("");
    try {
      const data = await api(`/api/marketplace/models/${model._id}/download-session`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage(
        language === "vi"
          ? `Đã tạo phiên tải. Còn ${data.remaining ?? "-"} lượt hôm nay.`
          : `Download session created. ${data.remaining ?? "-"} downloads remaining today.`,
      );
      api("/api/auth/user")
        .then((current) => {
          if (current.user) onUserChange?.(current.user);
        })
        .catch(() => { });
      window.open(buildApiUrl(data.downloadUrl), "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <section className="panel emptyState">
        <p>{language === "vi" ? "Đang tải model..." : "Loading model..."}</p>
      </section>
    );
  }

  if (!model) {
    return (
      <section className="panel emptyState">
        <button type="button" className="smallButton" onClick={() => navigateTo("/models", onNavigate)}>
          <ArrowLeft size={16} />
          {textFor(language, "Model", "Models")}
        </button>
        <p className="error">{error || (language === "vi" ? "Không tìm thấy model." : "Model not found.")}</p>
      </section>
    );
  }

  const canDownload = model.fileStatus === "ready";

  return (
    <div className="marketDetailPage">
      <div className="marketDetailTopbar">
        <button type="button" className="smallButton" onClick={() => navigateTo("/models", onNavigate)}>
          <ArrowLeft size={16} />
          {textFor(language, "Model", "Models")}
        </button>
        <span className="badge">{user?.isPro ? "Member" : user ? "Free" : "Guest"}</span>
      </div>

      <section className="marketDetailHero">
        <ModelPreview model={model} />
        <div className="marketDetailInfo panel">
          <div className="marketDetailBadges">
            <span className={`badge ${accessBadgeClass(model.accessType)}`}>{accessLabel(model.accessType)}</span>
            <span className={`badge ${statusBadgeClass(model.fileStatus)}`}>{model.fileStatus || "missing"}</span>
          </div>
          <h1>{model.title}</h1>

          <div className="marketDetailActions">
            <button className="primaryButton" type="button" disabled={downloading || !canDownload} onClick={downloadModel}>
              <Download size={18} />
              {downloading ? (language === "vi" ? "Đang tạo..." : "Creating...") : language === "vi" ? "Tải model" : "Download model"}
            </button>
          </div>

          {!canDownload && (
            <p className="error">
              {language === "vi" ? "Model này chưa gắn file sẵn sàng tải." : "This model does not have a ready file yet."}
            </p>
          )}
          {message && <p className="success">{message}</p>}
          {error && <p className="error">{error}</p>}

          <div className="marketDetailMeta">
            <ModelMetaRow label={textFor(language, "Danh mục", "Category")} value={modelCategoryLabel(model, language)} />
            <ModelMetaRow label="Renderer">
              <DetailFacetList
                facet="render"
                values={model.renderers}
                filterOptions={filterOptions}
                language={language}
                fallback={model.renderer}
              />
            </ModelMetaRow>
            <ModelMetaRow label={textFor(language, "Phong cách", "Style")}>
              <DetailFacetList facet="style" values={model.styles} filterOptions={filterOptions} language={language} />
            </ModelMetaRow>
            <ModelMetaRow label={textFor(language, "Hình dạng", "Form")}>
              <DetailFacetList facet="form" values={model.forms} filterOptions={filterOptions} language={language} />
            </ModelMetaRow>
            <ModelMetaRow label={textFor(language, "Màu sắc", "Color")}>
              <DetailFacetList facet="color" values={model.colors} filterOptions={filterOptions} language={language} />
            </ModelMetaRow>
            <ModelMetaRow label={textFor(language, "Vật liệu", "Material")}>
              <DetailFacetList facet="material" values={model.materials} filterOptions={filterOptions} language={language} />
            </ModelMetaRow>
            <ModelMetaRow label={textFor(language, "Dung lượng", "Size")} value={model.sizeText || formatBytes(model.fileSize)} />
          </div>
        </div>
      </section>

      <section className="marketRecommendations">
        <div className="marketSectionHeader">
          <div>
            <h2>{language === "vi" ? "Model đề xuất" : "Recommended models"}</h2>
            <p>{language === "vi" ? "Cùng danh mục, quyền tải hoặc renderer liên quan." : "Matched by category, access type, or renderer."}</p>
          </div>
          <span>{recommendedModels.length}</span>
        </div>
        {recommendedModels.length > 0 ? (
          <div className="marketGrid">
            {recommendedModels.map((item) => (
              <ModelCard key={item._id} model={item} onNavigate={onNavigate} />
            ))}
          </div>
        ) : (
          <section className="panel emptyState">
            <p>{language === "vi" ? "Chưa có model đề xuất." : "No recommendations yet."}</p>
          </section>
        )}
      </section>
    </div>
  );
}

export default function Models({ user, language = "vi", path = "/models", onNavigate, onUserChange }) {
  const slug = detailSlugFromPath(path);
  if (slug) {
    return <ModelDetailPage slug={slug} user={user} language={language} onNavigate={onNavigate} onUserChange={onUserChange} />;
  }
  return <ModelListPage user={user} language={language} onNavigate={onNavigate} />;
}
