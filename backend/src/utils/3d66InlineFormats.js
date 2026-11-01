import { parseDocument, DomUtils } from "htmlparser2";

export function parse3D66InlineFormats(html = "") {
  if (!String(html).includes("tp-multi-format-card")) return [];
  const document = parseDocument(String(html));
  const hasClass = (node, name) => String(node.attribs?.class || "").split(/\s+/).includes(name);
  const cards = DomUtils.findAll((node) => hasClass(node, "tp-multi-format-card"), document.children);
  const text = (card, className) => {
    const node = DomUtils.findOne((child) => hasClass(child, className), card.children || []);
    return DomUtils.textContent(node || []).replace(/\s+/g, " ").trim();
  };
  const seen = new Set();
  const options = cards.flatMap((card) => {
    const attrs = card.attribs || {};
    const fileFormat = String(attrs["data-file-format"] || "").trim();
    if (!fileFormat || fileFormat === "0") return [];
    const formatVersion = String(attrs["data-format-version"] || "").trim();
    const rendererType = String(attrs["data-renderer-type"] || "").trim();
    const key = [fileFormat, formatVersion, rendererType].join("|");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      key, fileFormat, formatVersion, rendererType,
      label: text(card, "tp-multi-format-card-title") || attrs.title || "",
      size: text(card, "tp-multi-format-card-size"),
      isDefault: hasClass(card, "active"),
    }];
  });
  const defaultKey = (options.find((option) => option.isDefault) || options[0])?.key;
  return options.map((option) => ({ ...option, isDefault: option.key === defaultKey }));
}
