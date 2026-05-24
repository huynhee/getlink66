import crypto from "crypto";
import { download3D66WithBrowser, fetch3D66PageWithBrowser } from "./3d66BrowserService.js";

const DEFAULT_DOWNLOAD_ENDPOINT = "https://user.3d66.com/api/v1/download/handle";
const DEFAULT_DOWNLOAD_POP_ENDPOINT = "https://user.3d66.com/api/v1/download/pop";
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_HTML_LENGTH = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const DEFAULT_SITE_CONTEXTS = {
  "3d.3d66.com": {
    site: "1",
    pageType: "5",
    accessSourceSite: "1",
    accessSourcePage: "5",
    fileFormat: "1"
  },
  "su.3d66.com": {
    site: "6",
    pageType: "5",
    accessSourceSite: "6",
    accessSourcePage: "5"
  },
  "tietu.3d66.com": {
    site: "11",
    pageType: "5",
    accessSourceSite: "14",
    accessSourcePage: "1"
  },
  "cad.3d66.com": {
    site: "8",
    pageType: "5",
    accessSourceSite: "8",
    accessSourcePage: "5"
  },
  "xiaoguotu.3d66.com": {
    site: "10",
    pageType: "5",
    accessSourceSite: "10",
    accessSourcePage: "5"
  },
  "fanganwenben.3d66.com": {
    site: "12",
    pageType: "5",
    accessSourceSite: "12",
    accessSourcePage: "5"
  },
  "linggantu.3d66.com": {
    site: "6",
    pageType: "5",
    accessSourceSite: "6",
    accessSourcePage: "5"
  },
  "3d66.com": {
    site: "6",
    pageType: "5",
    accessSourceSite: "6",
    accessSourcePage: "5"
  },
  "www.3d66.com": {
    site: "6",
    pageType: "5",
    accessSourceSite: "6",
    accessSourcePage: "5"
  }
};

function httpError(message, status = 502, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function timeoutMs() {
  const value = Number(process.env.THREED66_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function withTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  return { controller, done: () => clearTimeout(timer) };
}

function shouldFallbackToBrowserPage(error) {
  return (
    process.env.THREED66_DISABLE_BROWSER_PAGE_FALLBACK !== "true" &&
    (error.status === 502 || error.status === 504)
  );
}

function isPlaywrightMissing(error) {
  return error?.code === "PLAYWRIGHT_NOT_INSTALLED";
}

function cookieMap(cookieValue = "") {
  return String(cookieValue)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((map, part) => {
      const index = part.indexOf("=");
      if (index <= 0) return map;
      map.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
      return map;
    }, new Map());
}

function requireCookie(cookieValue) {
  if (!cookieValue) {
    throw httpError("3D66 cookie is required", 400);
  }

  const cookies = cookieMap(cookieValue);
  const missing = ["PHPSESSID", "login_token", "login_sign"].filter((key) => !cookies.get(key));
  if (missing.length) {
    throw httpError(`3D66 cookie missing required keys: ${missing.join(", ")}`, 400);
  }

  return cookies;
}

function normalizeModelUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw httpError("Invalid 3D66 URL", 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw httpError("Only HTTP(S) URLs are supported", 400);
  }

  if (!isAllowed3D66Host(parsed.hostname)) {
    throw httpError("Only 3d66.com links are supported", 400);
  }

  return parsed;
}

function isAllowed3D66Host(hostname = "") {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "3d66.com" || normalized.endsWith(".3d66.com");
}

function configuredSiteContexts() {
  const raw = String(process.env.THREED66_SITE_CONTEXTS || "").trim();
  if (!raw) return DEFAULT_SITE_CONTEXTS;

  try {
    return {
      ...DEFAULT_SITE_CONTEXTS,
      ...JSON.parse(raw)
    };
  } catch {
    return DEFAULT_SITE_CONTEXTS;
  }
}

function parseJsonCookie(cookies, key) {
  const value = cookies.get(key);
  if (!value) return null;

  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
}

function siteContext(pageUrl, cookies) {
  const parsed = new URL(pageUrl);
  const origin = process.env.THREED66_ORIGIN || parsed.origin;
  const originHost = new URL(origin).hostname;
  const configured = configuredSiteContexts()[originHost] || {};
  const referrerContext = parseJsonCookie(cookies, "resUrlreferrer") || {};
  const site = String(referrerContext.site || configured.site || "6");
  const pageType = String(referrerContext.page_type || configured.pageType || "5");
  const accessSourceSite = String(referrerContext.access_source_site || configured.accessSourceSite || site);
  const accessSourcePage = String(referrerContext.access_source_page || configured.accessSourcePage || "5");
  const fileFormat = String(configured.fileFormat || "");

  return {
    origin,
    site,
    pageType,
    accessSourceSite,
    accessSourcePage,
    fileFormat
  };
}

function currentUnixSeconds() {
  return String(Math.floor(Date.now() / 1000));
}

function applyFieldsToContext(context, fields = {}) {
  if (fields.site) {
    context.site = String(fields.site);
    context.accessSourceSite = String(fields.site);
  }
  if (fields.pageType) {
    context.pageType = String(fields.pageType);
    context.accessSourcePage = String(fields.pageType);
  }
  if (fields.fileFormat) {
    context.fileFormat = String(fields.fileFormat);
  }
  if (fields.accessSourceSite) context.accessSourceSite = String(fields.accessSourceSite);
  if (fields.accessSourcePage) context.accessSourcePage = String(fields.accessSourcePage);
  if (fields.formatVersion) context.formatVersion = String(fields.formatVersion);
  if (fields.rendererType) context.rendererType = String(fields.rendererType);
  return context;
}

function configuredPaytypeValue() {
  const value = String(process.env.THREED66_PAYTYPE_VALUE || "4").trim();
  return /^[\w-]{1,20}$/.test(value) ? value : "4";
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlAttribute(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absoluteUrl(value = "", baseUrl = "") {
  if (!value) return "";
  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return "";
  }
}

function attrValue(tag = "", attr = "") {
  const match = String(tag).match(new RegExp(`\\s${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] || "";
}

function tagWithAttributeValue(html = "", tagName = "", attr = "", value = "") {
  return String(html).match(
    new RegExp(`<${tagName}\\b(?=[^>]*\\s${attr}\\s*=\\s*["']${value}["'])[^>]*>`, "i")
  )?.[0] || "";
}

function metaContent(html = "", key = "") {
  const tag =
    tagWithAttributeValue(html, "meta", "property", key) ||
    tagWithAttributeValue(html, "meta", "name", key);
  return attrValue(tag, "content");
}

function jsonLdObjects(html = "") {
  const objects = [];
  const pattern = /<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      const parsed = JSON.parse(stripTags(match[1]));
      if (Array.isArray(parsed)) objects.push(...parsed);
      else if (parsed && typeof parsed === "object") objects.push(parsed);
    } catch {
      // ignore invalid embedded schema
    }
  }
  return objects;
}

function firstJsonLdValue(html = "", key = "") {
  for (const item of jsonLdObjects(html)) {
    const value = item?.[key];
    if (Array.isArray(value) && value.length) return value[0];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function stripTags(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " "));
}

function cleanTitle(value = "") {
  let title = stripTags(value)
    .replace(/\s+/g, " ")
    .trim();

  const bracketTitle = title.match(/^【(.+?)】/)?.[1];
  if (bracketTitle) title = bracketTitle;

  title = title
    .replace(/(?:下载|素材下载|3D模型下载|CAD图纸下载)$/i, "")
    .replace(/\s*[-_]\s*(?:3D溜溜网|3d66|3D66).*$/i, "")
    .trim();

  return title;
}

function firstTagWithClass(html = "", tag = "", className = "") {
  const pattern = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>[\\s\\S]*?<\\/${tag}>`, "i");
  return html.match(pattern)?.[0] || "";
}

function firstOpenTagWithClass(html = "", tag = "", className = "") {
  const pattern = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>`, "i");
  return html.match(pattern)?.[0] || "";
}

function firstTagWithAttr(html = "", tag = "", attr = "") {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["'][^"']+["'][^>]*>`, "i");
  return html.match(pattern)?.[0] || "";
}

function firstTagWithAttrValue(html = "", tag = "", attr = "", value = "") {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["']${value}["'][^>]*>`, "i");
  return html.match(pattern)?.[0] || "";
}

function firstImageInBlock(html = "", blockPattern) {
  const block = html.match(blockPattern)?.[0] || "";
  return firstOpenTagWithClass(block, "img", "llimgs") || block.match(/<img\b[^>]*>/i)?.[0] || "";
}

function parseDetailData(html = "") {
  const direct = html.match(/<input\b(?=[^>]*\bid=["']detail_data["'])[^>]*\bvalue=(["'])([\s\S]*?)\1[^>]*>/i);
  const tag = direct?.[0] || firstTagWithAttrValue(html, "input", "id", "detail_data");
  const raw = direct?.[2] || attrValue(tag, "value");
  if (!raw) return null;

  try {
    return JSON.parse(decodeHtmlAttribute(raw).trim());
  } catch {
    return null;
  }
}

function firstAttrFromMatchedTag(html = "", tagPattern, attr = "") {
  const tag = html.match(tagPattern)?.[0] || "";
  return attrValue(tag, attr);
}

function extractModelTitleFromHtml(html = "") {
  const titleMaterial = html.match(/<div\b(?=[^>]*\bclass=["'][^"']*title-material[^"']*["'])[\s\S]*?<h1\b(?=[^>]*\bclass=["'][^"']*model-name[^"']*["'])[^>]*\btitle=(["'])([\s\S]*?)\1/i)?.[2];
  if (titleMaterial) return titleMaterial;

  const titleFromAttr = html.match(/<h1\b(?=[^>]*\bclass=["'][^"']*model-name[^"']*["'])[^>]*\btitle=(["'])([\s\S]*?)\1[^>]*>/i)?.[2];
  if (titleFromAttr) return titleFromAttr;

  const titleFromText = html.match(/<h1\b(?=[^>]*\bclass=["'][^"']*model-name[^"']*["'])[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (titleFromText) return stripTags(titleFromText);

  return (
    metaContent(html, "og:title") ||
    firstJsonLdValue(html, "title") ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    ""
  );
}

function extractPreviewImageFromHtml(html = "", pageUrl = "") {
  const dataTypeOneImage = html.match(/<img\b(?=[^>]*\bdata-img-type=["']1["'])[^>]*\bsrc=(["'])([\s\S]*?)\1/i)?.[2];
  const dataTypeOneUrl = absoluteUrl(String(dataTypeOneImage || "").replaceAll("\\/", "/"), pageUrl);
  if (dataTypeOneUrl) return dataTypeOneUrl;

  const mainGalleryImage = html.match(/<div\b(?=[^>]*\bid=["']swiper_max_html["'])[\s\S]*?<div\b(?=[^>]*\bclass=["'][^"']*swiper-imgs-list[^"']*["'])[\s\S]*?<img\b(?=[^>]*\bclass=["'][^"']*llimgs[^"']*["'])[^>]*\bsrc=(["'])([\s\S]*?)\1/i)?.[2];
  const mainGalleryUrl = absoluteUrl(String(mainGalleryImage || "").replaceAll("\\/", "/"), pageUrl);
  if (mainGalleryUrl) return mainGalleryUrl;

  const directPatterns = [
    /<img\b(?=[^>]*\bdata-img-type=["']1["'])[^>]*>/i,
    /<div\b(?=[^>]*\bclass=["'][^"']*swiper-imgs-list[^"']*["'])[\s\S]*?<img\b[^>]*>/i,
    /<div\b(?=[^>]*\bid=["']swiper_max_html["'])[\s\S]*?<img\b[^>]*>/i,
    /<div\b(?=[^>]*\bclass=["'][^"']*gallery-top[^"']*["'])[\s\S]*?<img\b[^>]*>/i,
    /<img\b(?=[^>]*\bclass=["'][^"']*llimgs[^"']*["'])[^>]*>/i,
    /<meta\b(?=[^>]*\bproperty=["']og:image["'])[^>]*>/i
  ];

  for (const pattern of directPatterns) {
    const raw =
      firstAttrFromMatchedTag(html, pattern, "src") ||
      firstAttrFromMatchedTag(html, pattern, "data-imgurl") ||
      firstAttrFromMatchedTag(html, pattern, "data-src") ||
      firstAttrFromMatchedTag(html, pattern, "data-original") ||
      firstAttrFromMatchedTag(html, pattern, "content");
    const absolute = absoluteUrl(String(raw).replaceAll("\\/", "/"), pageUrl);
    if (absolute) return absolute;
  }

  const metaImage = absoluteUrl(metaContent(html, "og:image") || metaContent(html, "twitter:image"), pageUrl);
  if (metaImage) return metaImage;

  const jsonLdImage = absoluteUrl(firstJsonLdValue(html, "images") || firstJsonLdValue(html, "image"), pageUrl);
  if (jsonLdImage) return jsonLdImage;

  return "";
}

function extractCreditCostFromHtml(html = "") {
  const detailData = parseDetailData(html);
  const detailPrice = Number(detailData?.data?.res?.res_price);
  if (Number.isFinite(detailPrice) && detailPrice > 0) return detailPrice;

  const source = decodeHtml(html);
  const downloadPriceBlock = html.match(/<div\b(?=[^>]*\bclass=["'][^"']*download-price[^"']*["'])[\s\S]*?<\/div>\s*<\/div>/i)?.[0] || "";
  const originalInBlock = downloadPriceBlock.match(/<div\b(?=[^>]*\bclass=["'][^"']*(?:orginal-price|original-price)[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const originalInBlockValue = stripTags(originalInBlock || "").match(/(\d+(?:\.\d+)?)/)?.[1];
  if (originalInBlockValue) {
    const number = Number(originalInBlockValue);
    if (Number.isFinite(number) && number > 0) return number;
  }

  const directPrice = html.match(/<[^>]+\bclass=["'][^"']*(?:orginal-price|original-price)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1];
  const directPriceValue = stripTags(directPrice || "").match(/(\d+(?:\.\d+)?)/)?.[1];
  if (directPriceValue) {
    const number = Number(directPriceValue);
    if (Number.isFinite(number) && number > 0) return number;
  }

  const priceTag =
    firstTagWithClass(html, "div", "orginal-price") ||
    firstTagWithClass(html, "div", "original-price");
  const priceFromTag = stripTags(priceTag).match(/(\d+(?:\.\d+)?)/)?.[1];
  if (priceFromTag) {
    const number = Number(priceFromTag);
    if (Number.isFinite(number) && number > 0) return number;
  }

  const candidates = [
    /<div[^>]+class=["'][^"']*orginal-price[^"']*["'][^>]*>\s*(\d+(?:\.\d+)?)\s*下载币\s*<\/div>/i,
    /<div[^>]+class=["'][^"']*original-price[^"']*["'][^>]*>\s*(\d+(?:\.\d+)?)\s*下载币\s*<\/div>/i,
    /class=["'][^"']*(?:orginal-price|original-price)[^"']*["'][^>]*>[\s\S]{0,80}?(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*下载币/i,
    /res_price["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i,
    /coupon_after_price["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i,
    /["'](?:credit|credits|download_price|need_xzb|xzb|xuan_dian|cost|download_cost)["']\s*:\s*["']?(\d+(?:\.\d+)?)/i,
    /(?:credit|download_price|need_xzb|xzb|xuan_dian|cost|download_cost)\s*=\s*["']?(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:credit|credits|玄点|点)/i
  ];
  const value = firstMatch(source, candidates);
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function parseModelMetadata(html, pageUrl, fields = {}) {
  const detailData = parseDetailData(html);
  const detailRes = detailData?.data?.res || {};
  const detailImages = Array.isArray(detailRes.res_img) ? detailRes.res_img : [];
  const coverItem =
    detailImages.find((item) => Number(item?.img_type) === 1 && item?.is_cover) ||
    detailImages.find((item) => Number(item?.img_type) === 1) ||
    detailImages.find((item) => item?.is_cover) ||
    detailImages[0] ||
    {};
  const directPreviewImage = extractPreviewImageFromHtml(html, pageUrl);
  const previewImageTag =
    firstTagWithAttrValue(html, "img", "data-img-type", "1") ||
    firstImageInBlock(html, /<div[^>]+id=["']swiper_max_html["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/i) ||
    firstImageInBlock(html, /<div[^>]+class=["'][^"']*gallery-top[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/i) ||
    firstImageInBlock(html, /<div[^>]+class=["'][^"']*swiper-imgs-list[^"']*["'][^>]*>[\s\S]*?<\/div>/i) ||
    firstOpenTagWithClass(html, "img", "llimgs") ||
    firstTagWithAttr(html, "img", "data-img-type") ||
    firstTagWithAttr(html, "img", "data-img-id");
  const largeHtmlImage =
    attrValue(previewImageTag, "src") ||
    attrValue(previewImageTag, "data-imgurl") ||
    attrValue(previewImageTag, "data-src") ||
    attrValue(previewImageTag, "data-original");
  const coverImage =
    directPreviewImage ||
    largeHtmlImage ||
    coverItem.img_pic ||
    coverItem.thuimg600 ||
    coverItem.fullimg ||
    coverItem.thuimg88 ||
    coverItem.res_img_dg ||
    detailRes.business_img ||
    detailRes.res_img_dg ||
    detailData?.images?.[0] ||
    "";
  const modelNameTag = firstTagWithClass(html, "h1", "model-name");
  const directTitle = extractModelTitleFromHtml(html);
  const modelTitle =
    detailRes.res_name_txt ||
    detailRes.res_name ||
    directTitle ||
    attrValue(modelNameTag, "title") ||
    stripTags(modelNameTag);
  const title = cleanTitle(
    modelTitle ||
    firstMatch(html, [
      /<h1[^>]+class=["'][^"']*model-name[^"']*["'][^>]+title=["']([^"']+)["'][^>]*>/i,
      /<h1[^>]+title=["']([^"']+)["'][^>]+class=["'][^"']*model-name[^"']*["'][^>]*>/i,
      /<h1[^>]+class=["'][^"']*model-name[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\/h1>/i,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /["']title["']\s*:\s*["']([^"']+)["']/i
    ])
  );

  const rawImage = (
    coverImage ||
    attrValue(previewImageTag, "src") ||
    attrValue(previewImageTag, "data-src") ||
    attrValue(previewImageTag, "data-original") ||
    firstMatch(html, [
    /<img[^>]+class=["'][^"']*llimgs[^"']*["'][^>]+src=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*llimgs[^"']*["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+data-img-type=["']1["'][^>]*>/i,
    /<img[^>]+data-img-type=["']1["'][^>]+src=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+data-img-id=["'][^"']+["'][^>]*>/i,
    /<img[^>]+data-img-id=["'][^"']+["'][^>]+src=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /["'](?:cover|cover_url|thumb|thumb_url|image|img|pic|pic_url)["']\s*:\s*["']([^"']+)["']/i,
    /(https?:\\?\/\\?\/[^"']+\.(?:jpg|jpeg|png|webp)(?:[^"']*)?)/i
  ])).replaceAll("\\/", "/");

  return {
    productId: detailRes.ll_id || fields.llId || "",
    title: title || fields.llId || "3D66 model",
    imageUrl: absoluteUrl(rawImage, pageUrl),
    creditCost: extractCreditCostFromHtml(html),
    sourceUrl: pageUrl
  };
}

function parseDynamicFields(html, pageUrl) {
  const parsed = new URL(pageUrl);
  const source = `${pageUrl}\n${html}`;
  const detailRes = parseDetailData(html)?.data?.res || {};
  const param = (...names) => {
    for (const name of names) {
      const value = parsed.searchParams.get(name);
      if (value) return value;
    }
    return "";
  };
  const firstFileFormat = Array.isArray(detailRes.down_file_format)
    ? detailRes.down_file_format[0] || {}
    : {};

  return {
    llId:
      detailRes.ll_id ||
      firstMatch(source, [
        /\sdata-sof=["']([A-Z0-9_-]{8,})["']/i,
        /<span[^>]+class=["'][^"']*ll-id[^"']*["'][^>]*>\s*([A-Z0-9_-]{8,})\s*<\/span>/i,
        /<div[^>]+class=["'][^"']*slide-ll-id[^"']*["'][^>]*>\s*ID\s*<b>\s*([A-Z0-9_-]{8,})\s*<\/b>/i,
        /["']ll_id["']\s*:\s*["']([^"']+)["']/i,
        /(?:ll_id|llId)\s*=\s*["']([^"']+)["']/i
      ]) ||
      parsed.searchParams.get("sof"),
    sign:
      parsed.searchParams.get("sign") ||
      firstMatch(source, [
        /["'?&]sign=([a-z0-9_-]{8,})/i,
        /["']sign["']\s*:\s*["']([^"']+)["']/i,
        /sign\s*=\s*["']([^"']+)["']/i
      ]),
    token: firstMatch(source, [
      /["']token["']\s*:\s*["']([^"']+)["']/i,
      /(?:download_)?token\s*=\s*["']([^"']+)["']/i,
      /name=["']token["']\s+value=["']([^"']+)["']/i,
      /token["']?\s*,\s*["']([a-f0-9]{16,64})["']/i
    ]),
    upTime: firstMatch(source, [
      /["']up_time["']\s*:\s*["']?(\d{8,})["']?/i,
      /up_time\s*=\s*["']?(\d{8,})["']?/i,
      /["']upTime["']\s*:\s*["']?(\d{8,})["']?/i
    ]),
    site: firstMatch(source, [/<input\b(?=[^>]*\bid=["']site["'])[^>]*\bvalue=["']([^"']+)["']/i]),
    pageType: firstMatch(source, [/<input\b(?=[^>]*\bid=["']page_type["'])[^>]*\bvalue=["']([^"']+)["']/i]),
    actionId:
      detailRes.actionId ||
      param("action_id", "actid", "searchActionId") ||
      firstMatch(source, [
        /["']action_id["']\s*:\s*["']([^"']+)["']/i,
        /["']actionId["']\s*:\s*["']([^"']+)["']/i,
        /(?:action_id|actionId)\s*=\s*["']([^"']+)["']/i
      ]),
    requestId: param("r_id", "request_id"),
    sourceAlg: param("s_alg", "source_alg"),
    position: param("position"),
    llwSourceScene: param("lss", "llw_source_scene"),
    listLayoutType: param("llt", "list_layout_type"),
    ab: param("ab_f", "ab"),
    algorithmType: param("algorithm_type", "gp"),
    algorithmVersion: param("algorithm_version", "a_v"),
    accessSourceSite: param("access_source_site"),
    accessSourcePage: param("access_source_page"),
    fileFormat: firstFileFormat.file_format ? String(firstFileFormat.file_format) : "",
    rendererType: firstFileFormat.renderer_type ? String(firstFileFormat.renderer_type) : "",
    formatVersion:
      firstFileFormat.format_version ||
      firstMatch(source, [
        /["']format_version["']\s*:\s*["']([^"']+)["']/i,
        /format_version\s*=\s*["']([^"']+)["']/i
      ])
  };
}

function buildModelUrls(pageUrl, fields) {
  const resUrl = new URL(pageUrl);
  if (fields.llId && !resUrl.searchParams.get("sof")) resUrl.searchParams.set("sof", fields.llId);
  if (fields.sign && !resUrl.searchParams.get("sign")) resUrl.searchParams.set("sign", fields.sign);
  if (!resUrl.searchParams.get("alichlgref")) resUrl.searchParams.set("alichlgref", "https://user.3d66.com/");

  const referrer = new URL(resUrl);
  referrer.searchParams.delete("alichlgref");

  return {
    resUrl: resUrl.toString(),
    referrer: referrer.toString()
  };
}

async function fetchModelPage(url, cookieValue) {
  const { controller, done } = withTimeout();
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "vi,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6",
        "cache-control": "no-cache",
        cookie: cookieValue,
        pragma: "no-cache",
        referer: url,
        "sec-ch-ua": "\"Chromium\";v=\"148\", \"Google Chrome\";v=\"148\", \"Not/A)Brand\";v=\"99\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "user-agent": DEFAULT_USER_AGENT
      }
    });

    const html = await response.text();
    if (!response.ok) {
      throw httpError(`3D66 model page request failed: HTTP ${response.status}`, 502);
    }

    const safeHtml = html.length > MAX_HTML_LENGTH ? html.slice(0, MAX_HTML_LENGTH) : html;
    return { html: safeHtml, pageUrl: response.url || url };
  } catch (error) {
    if (error.name === "AbortError") {
      throw httpError("3D66 model page request timed out", 504);
    }
    if (error.status) throw error;
    throw httpError(`3D66 model page request failed: ${error.message}`, 502);
  } finally {
    done();
  }
}

function buildDownloadPayload(fields, urls, cookies, context) {
  const payload = new URLSearchParams({
    action: "user_pay_download",
    rartype: "1",
    ll_id: fields.llId,
    needtype: fields.needtype || "1",
    actid: fields.actionId || "",
    action_id: fields.actionId || "",
    token: fields.token,
    sotu_action_id: "",
    kw: "",
    rlai: "",
    collect: "0",
    dl_course: "",
    parentId: "",
    st: "2",
    source: "0",
    click_res_source: "1",
    uid: cookies.get("Hm_lvt_bh_ud") || "",
    uid_front: cookies.get("Hm_lvt_bh_ud_uid_front") || "",
    up_time: fields.upTime,
    coupon_id: fields.couponId || "",
    source_alg: fields.sourceAlg || "",
    model_num: "1",
    resUrl: urls.resUrl,
    referrer: urls.referrer,
    position: fields.position || "1",
    llw_source_scene: fields.llwSourceScene || "0",
    site: context.site,
    page_type: context.pageType,
    access_source_site: context.accessSourceSite,
    access_source_page: context.accessSourcePage,
    experimental_grouping: "2",
    browser: DEFAULT_USER_AGENT,
    search_word: "",
    package_id: fields.packageId || "",
    list_layout_type: fields.listLayoutType || "",
    is_business: "0",
    down_type: "0",
    is_commercial: "false",
    voucher_id: fields.voucherId || "",
    file_format: context.fileFormat,
    renderer_type: process.env.THREED66_RENDERER_TYPE || context.rendererType || "4",
    format_version: process.env.THREED66_FORMAT_VERSION || context.formatVersion || fields.formatVersion || "max2018",
    ab: fields.ab || "",
    algorithm_type: fields.algorithmType || "",
    algorithm_version: fields.algorithmVersion || "",
    request_id: fields.requestId || ""
  });

  if (!context.fileFormat) payload.delete("file_format");
  return payload;
}

function validateDynamicFields(fields) {
  const missing = [];
  if (!fields.llId) missing.push("ll_id/sof");
  if (!fields.token) missing.push("token");
  if (!fields.upTime) missing.push("up_time");

  if (missing.length) {
    throw httpError(`Cannot build 3D66 download request. Missing: ${missing.join(", ")}`, 422);
  }
}

function snippetAround(html = "", pattern, radius = 220) {
  const match = html.match(pattern);
  if (!match) return "";
  const index = Math.max(0, match.index - radius);
  return decodeHtml(html.slice(index, Math.min(html.length, match.index + match[0].length + radius)));
}

function compactTextSample(html = "", length = 1200) {
  return stripTags(html)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
}

function detectUnexpectedPage(html = "") {
  const lower = html.toLowerCase();
  const text = compactTextSample(html, 1600);
  return {
    hasHtmlTag: /<html\b/i.test(html),
    hasTitleTag: /<title\b/i.test(html),
    hasScriptOnlyShell: /<script\b/i.test(html) && !/model-name|detail_data|og:image|swiper_max_html/i.test(html),
    looksLikeChallenge:
      /acw_sc|acw_tc|aliyun|captcha|riddler|security|challenge|verify|验证|安全|访问异常|滑块/i.test(html + text),
    looksLikeLogin:
      /login|登录|请先登录|sign in/i.test(html + text),
    looksLikeNotFound:
      /404|not found|页面不存在|资源不存在|已下架/i.test(html + text)
  };
}

function shouldUseBrowserPage(html = "", metadata = {}, fields = {}, requireDownloadFields = false) {
  if (process.env.THREED66_BROWSER_ALWAYS === "true") return true;
  if (process.env.THREED66_DISABLE_BROWSER_PAGE_FALLBACK === "true") return false;

  const diagnostics = detectUnexpectedPage(html);
  if (diagnostics.looksLikeChallenge || diagnostics.hasScriptOnlyShell) return true;

  if (requireDownloadFields && (!fields.llId || !fields.token || !fields.upTime)) return true;

  const title = String(metadata.title || "").trim();
  return Boolean(!title || title === "3D66 model" || !metadata.imageUrl || Number(metadata.creditCost || 0) <= 1);
}

function isWeakMetadata(metadata = {}) {
  const title = String(metadata.title || "").trim();
  return Boolean(!title || title === "3D66 model" || !metadata.imageUrl || Number(metadata.creditCost || 0) <= 1);
}

async function fetch3D66PageWithBrowserFallback(url, cookieValue, originalError = null) {
  try {
    return await fetch3D66PageWithBrowser(url, cookieValue);
  } catch (error) {
    if (isPlaywrightMissing(error) && originalError) throw originalError;
    if (isPlaywrightMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function download3D66WithBrowserFallback(url, cookieValue, originalError = null) {
  try {
    return await download3D66WithBrowser(url, cookieValue);
  } catch (error) {
    if (isPlaywrightMissing(error) && originalError) throw originalError;
    if (isPlaywrightMissing(error)) {
      return null;
    }
    throw error;
  }
}

function mergeBrowserFields(fields = {}, browserMetadata = {}) {
  const browserFields = browserMetadata.dynamicFields || {};
  return {
    ...fields,
    llId: browserFields.llId || browserMetadata.productId || fields.llId,
    sign: browserFields.sign || fields.sign,
    token: browserFields.token || fields.token,
    upTime: browserFields.upTime || fields.upTime,
    actionId: browserFields.actionId || fields.actionId,
    fileFormat: browserFields.fileFormat || fields.fileFormat,
    site: browserFields.site || fields.site,
    pageType: browserFields.pageType || fields.pageType,
    requestId: browserFields.requestId || fields.requestId,
    sourceAlg: browserFields.sourceAlg || fields.sourceAlg,
    position: browserFields.position || fields.position,
    llwSourceScene: browserFields.llwSourceScene || fields.llwSourceScene,
    listLayoutType: browserFields.listLayoutType || fields.listLayoutType,
    ab: browserFields.ab || fields.ab,
    algorithmType: browserFields.algorithmType || fields.algorithmType,
    algorithmVersion: browserFields.algorithmVersion || fields.algorithmVersion,
    accessSourceSite: browserFields.accessSourceSite || fields.accessSourceSite,
    accessSourcePage: browserFields.accessSourcePage || fields.accessSourcePage,
    rendererType: browserFields.rendererType || fields.rendererType,
    formatVersion: browserFields.formatVersion || fields.formatVersion
  };
}

function mergeBrowserMetadata(metadata = {}, browserMetadata = {}, fields = {}) {
  const browserCost = Number(browserMetadata.creditCost || 0);
  return {
    productId: browserMetadata.productId || metadata.productId || fields.llId || "",
    title: browserMetadata.title || metadata.title || fields.llId || "3D66 model",
    imageUrl: browserMetadata.imageUrl || metadata.imageUrl || "",
    creditCost: browserCost > 0 ? browserCost : metadata.creditCost || 1,
    sourceUrl: browserMetadata.sourceUrl || metadata.sourceUrl || ""
  };
}

async function requestDownloadPop(fields, cookieValue, context) {
  if (!fields.llId) return null;
  const endpoint = process.env.THREED66_DOWNLOAD_POP_ENDPOINT || DEFAULT_DOWNLOAD_POP_ENDPOINT;
  const { controller, done } = withTimeout();
  const payload = new URLSearchParams({
    sof: fields.llId,
    res_type: context.site || "1"
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        cookie: cookieValue,
        origin: context.origin,
        referer: `${context.origin}/`,
        "user-agent": DEFAULT_USER_AGENT,
        "x-requested-with": "XMLHttpRequest"
      },
      body: payload
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw httpError("3D66 download pop returned non-JSON response", 502, { body: text.slice(0, 300) });
    }

    if (!response.ok || Number(json.status || json.code) !== 200) {
      throw httpError(`3D66 download pop failed: ${json.msg || `HTTP ${response.status}`}`, 502, {
        response: json
      });
    }

    return json.data || null;
  } catch (error) {
    if (error.name === "AbortError") {
      throw httpError("3D66 download pop timed out", 504);
    }
    if (error.status) throw error;
    throw httpError(`3D66 download pop request failed: ${error.message}`, 502);
  } finally {
    done();
  }
}

function mergeDownloadPopFields(fields = {}, popData = {}) {
  const resInfo = popData.resInfo || {};
  const priceInfo = popData.user?.priceInfo || {};
  const discount = priceInfo.discount_arr || {};
  const isDirectDownload =
    Number(popData.is_direct_download || 0) === 1 ||
    [3, 4].includes(Number(popData.download_status || 0));
  return {
    ...fields,
    llId: fields.llId || resInfo.sof || "",
    token: fields.token || popData.token || "",
    upTime: fields.upTime || currentUnixSeconds(),
    site: fields.site || resInfo.res_type || "",
    needtype: fields.needtype || (isDirectDownload ? "1" : configuredPaytypeValue()),
    couponId: fields.couponId || discount.coupon_id || "",
    voucherId: fields.voucherId || discount.voucher_id || "",
    packageId: fields.packageId || (discount.package_id ? String(discount.package_id) : "")
  };
}

function mergeDownloadPopMetadata(metadata = {}, popData = {}, pageUrl = "", fields = {}) {
  const resInfo = popData.resInfo || {};
  const popCost = Number(resInfo.res_price || extractCreditCost(popData) || 0);
  return {
    productId: metadata.productId || resInfo.sof || fields.llId || "",
    title: resInfo.res_name || metadata.title || fields.llId || "3D66 model",
    imageUrl: absoluteUrl(resInfo.img, pageUrl) || metadata.imageUrl || "",
    creditCost: popCost > 0 ? popCost : metadata.creditCost || 1,
    sourceUrl: metadata.sourceUrl || pageUrl
  };
}

async function enrichFromDownloadPop(fields, metadata, pageUrl, cookieValue, context) {
  let nextFields = { ...fields };
  let nextMetadata = { ...metadata };
  if (!nextFields.llId) {
    return { fields: nextFields, metadata: nextMetadata };
  }

  if (!nextFields.upTime) {
    nextFields.upTime = currentUnixSeconds();
  }

  if (nextFields.token && !isWeakMetadata(nextMetadata)) {
    return { fields: nextFields, metadata: nextMetadata };
  }

  try {
    const popData = await requestDownloadPop(nextFields, cookieValue, context);
    if (popData) {
      nextFields = mergeDownloadPopFields(nextFields, popData);
      nextMetadata = mergeDownloadPopMetadata(nextMetadata, popData, pageUrl, nextFields);
    }
  } catch {
    // Keep the existing browser fallback path when the lightweight popup API is unavailable.
  }

  return { fields: nextFields, metadata: nextMetadata };
}

async function requestDownloadUrl(payload, cookieValue, origin) {
  const endpoint = process.env.THREED66_DOWNLOAD_ENDPOINT || DEFAULT_DOWNLOAD_ENDPOINT;
  const { controller, done } = withTimeout();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        cookie: cookieValue,
        origin,
        referer: `${origin}/`,
        "user-agent": DEFAULT_USER_AGENT,
        "x-requested-with": "XMLHttpRequest"
      },
      body: payload
    });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw httpError("3D66 download API returned non-JSON response", 502, { body: text.slice(0, 300) });
    }

    if (!response.ok) {
      throw httpError(`3D66 download API failed: HTTP ${response.status}`, 502, { response: json });
    }

    const fileUrl = typeof json.data === "string" ? json.data.replaceAll("\\/", "/") : "";
    if (Number(json.status || json.code) === 200 && /^https:\/\/down\.3d66\.com\//i.test(fileUrl)) {
      return {
        fileUrl,
        creditCost: extractCreditCost(json)
      };
    }

    throw httpError(
      `3D66 download failed: ${json.msg || "missing download URL"}${json.request_id ? ` (${json.request_id})` : ""}`,
      502,
      { response: json }
    );
  } catch (error) {
    if (error.name === "AbortError") {
      throw httpError("3D66 download API timed out", 504);
    }
    if (error.status) throw error;
    throw httpError(`3D66 download API request failed: ${error.message}`, 502);
  } finally {
    done();
  }
}

function extractCreditCost(value) {
  const candidates = [];
  const priceKeys = new Set([
    "credit",
    "credits",
    "price",
    "download_price",
    "need_xzb",
    "xzb",
    "xuan_dian",
    "cost",
    "download_cost"
  ]);

  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, raw] of Object.entries(node)) {
      const normalizedKey = key.toLowerCase();
      if (priceKeys.has(normalizedKey)) {
        const number = Number(String(raw).replace(/[^\d.]/g, ""));
        if (Number.isFinite(number) && number > 0) candidates.push(number);
      }
      if (typeof raw === "object") visit(raw);
    }
  }

  visit(value);
  return candidates.length ? candidates[0] : 1;
}

export async function validate3D66Cookie(cookieValue, modelUrl = "") {
  requireCookie(cookieValue);

  if (!modelUrl) {
    return { ok: true, mode: "cookie-keys" };
  }

  const normalized = normalizeModelUrl(modelUrl);
  const { html, pageUrl } = await fetchModelPage(normalized.toString(), cookieValue);
  const fields = parseDynamicFields(html, pageUrl);
  return {
    ok: true,
    mode: "model-page",
    pageUrl,
    hasLlId: Boolean(fields.llId),
    hasToken: Boolean(fields.token),
    hasUpTime: Boolean(fields.upTime)
  };
}

export async function fetch3D66Preview(url, cookieValue) {
  if (process.env.THREED66_MOCK !== "false") {
    const digest = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
    return {
      productId: digest,
      title: "Mock 3D66 model",
      imageUrl: "",
      creditCost: 1,
      sourceUrl: url
    };
  }

  const cookies = requireCookie(cookieValue);
  const normalized = normalizeModelUrl(url);
  let browserMetadata = null;
  let { html, pageUrl } = await fetchModelPage(normalized.toString(), cookieValue).catch(async (error) => {
    if (!shouldFallbackToBrowserPage(error)) throw error;
    const browserPage = await fetch3D66PageWithBrowserFallback(normalized.toString(), cookieValue, error);
    browserMetadata = browserPage.metadata;
    return { html: browserPage.html, pageUrl: browserPage.pageUrl || normalized.toString() };
  });
  let fields = parseDynamicFields(html, pageUrl);
  let metadata = parseModelMetadata(html, pageUrl, fields);
  if (browserMetadata) {
    fields = mergeBrowserFields(fields, browserMetadata);
    metadata = mergeBrowserMetadata(metadata, browserMetadata, fields);
  }

  if (!browserMetadata && isWeakMetadata(metadata)) {
    const context = applyFieldsToContext(siteContext(pageUrl, cookies), fields);
    ({ fields, metadata } = await enrichFromDownloadPop(fields, metadata, pageUrl, cookieValue, context));
  }

  if (!browserMetadata && shouldUseBrowserPage(html, metadata, fields)) {
    const browserPage = await fetch3D66PageWithBrowserFallback(pageUrl || normalized.toString(), cookieValue);
    if (browserPage) {
      html = browserPage.html;
      pageUrl = browserPage.pageUrl;
      fields = mergeBrowserFields(parseDynamicFields(html, pageUrl), browserPage.metadata);
      metadata = mergeBrowserMetadata(parseModelMetadata(html, pageUrl, fields), browserPage.metadata, fields);
    }
  }

  return metadata;
}

export async function inspect3D66Page(url, cookieValue) {
  requireCookie(cookieValue);
  const normalized = normalizeModelUrl(url);
  let browserMetadata = null;
  let { html, pageUrl } = await fetchModelPage(normalized.toString(), cookieValue).catch(async (error) => {
    if (!shouldFallbackToBrowserPage(error)) throw error;
    const browserPage = await fetch3D66PageWithBrowserFallback(normalized.toString(), cookieValue, error);
    browserMetadata = browserPage.metadata;
    return { html: browserPage.html, pageUrl: browserPage.pageUrl || normalized.toString() };
  });
  let fields = parseDynamicFields(html, pageUrl);
  let metadata = parseModelMetadata(html, pageUrl, fields);
  let usedBrowser = Boolean(browserMetadata);
  if (browserMetadata) {
    fields = mergeBrowserFields(fields, browserMetadata);
    metadata = mergeBrowserMetadata(metadata, browserMetadata, fields);
  }

  if (!browserMetadata && shouldUseBrowserPage(html, metadata, fields)) {
    const browserPage = await fetch3D66PageWithBrowserFallback(pageUrl || normalized.toString(), cookieValue);
    if (browserPage) {
      html = browserPage.html;
      pageUrl = browserPage.pageUrl;
      fields = mergeBrowserFields(parseDynamicFields(html, pageUrl), browserPage.metadata);
      metadata = mergeBrowserMetadata(parseModelMetadata(html, pageUrl, fields), browserPage.metadata, fields);
      usedBrowser = true;
    }
  }

  const detailData = parseDetailData(html);

  return {
    pageUrl,
    htmlLength: html.length,
    metadata,
    dynamicFields: {
      llId: fields.llId || "",
      hasSign: Boolean(fields.sign),
      hasToken: Boolean(fields.token),
      hasUpTime: Boolean(fields.upTime)
    },
    found: {
      detailData: Boolean(detailData),
      modelName: /model-name/i.test(html),
      ogImage: /og:image/i.test(html),
      orginalPrice: /orginal-price|original-price|下载币/i.test(html)
    },
    pageDiagnostics: detectUnexpectedPage(html),
    usedBrowser,
    snippets: {
      title: snippetAround(html, /<title[\s\S]*?<\/title>/i),
      modelName: snippetAround(html, /<h1\b(?=[^>]*model-name)[\s\S]*?<\/h1>/i),
      ogImage: snippetAround(html, /<meta\b(?=[^>]*(?:og:image|twitter:image))[^>]*>/i),
      price: snippetAround(html, /(?:orginal-price|original-price|下载币)/i),
      detailData: snippetAround(html, /id=["']detail_data["']/i),
      htmlStart: decodeHtml(html.slice(0, 1800)),
      textStart: compactTextSample(html, 1800)
    }
  };
}

export async function request3D66File(fileUrl, cookieValue, options = {}) {
  requireCookie(cookieValue);
  const parsedFileUrl = new URL(fileUrl);
  if (!isAllowed3D66Host(parsedFileUrl.hostname)) {
    throw httpError("Only 3d66.com download links are supported", 400);
  }
  const sourceUrl = options.sourceUrl || process.env.THREED66_ORIGIN || "https://3d.3d66.com/";
  const origin = new URL(sourceUrl).origin;
  const headers = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "vi,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6",
    "cache-control": "no-cache",
    cookie: cookieValue,
    pragma: "no-cache",
    referer: sourceUrl,
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": isAllowed3D66Host(parsedFileUrl.hostname) ? "same-site" : "cross-site",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": DEFAULT_USER_AGENT
  };

  if (origin && process.env.THREED66_DOWNLOAD_SEND_ORIGIN === "true") {
    headers.origin = origin;
  }

  if (options.range) headers.range = options.range;

  return fetch(fileUrl, {
    redirect: "follow",
    signal: options.signal,
    headers
  });
}

export async function fetchFrom3D66(url, cookieValue) {
  if (process.env.THREED66_MOCK !== "false") {
    const digest = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
    return {
      fileUrl: `https://download.mock-3d66.local/${digest}.zip`,
      productId: digest,
      sourceUrl: url,
      title: "Mock 3D66 model",
      imageUrl: "",
      creditCost: 1
    };
  }

  const initialCookies = requireCookie(cookieValue);
  const normalized = normalizeModelUrl(url);
  let effectiveCookieValue = cookieValue;
  let browserMetadata = null;
  let { html, pageUrl } = await fetchModelPage(normalized.toString(), cookieValue).catch(async (error) => {
    if (!shouldFallbackToBrowserPage(error)) throw error;
    const browserPage = await fetch3D66PageWithBrowserFallback(normalized.toString(), cookieValue, error);
    browserMetadata = browserPage.metadata;
    effectiveCookieValue = browserPage.cookieValue || cookieValue;
    return { html: browserPage.html, pageUrl: browserPage.pageUrl || normalized.toString() };
  });
  let fields = parseDynamicFields(html, pageUrl);
  let metadata = parseModelMetadata(html, pageUrl, fields);
  if (browserMetadata) {
    fields = mergeBrowserFields(fields, browserMetadata);
    metadata = mergeBrowserMetadata(metadata, browserMetadata, fields);
  }

  let effectiveCookies = initialCookies;
  let context = applyFieldsToContext(siteContext(pageUrl, effectiveCookies), fields);
  if (!browserMetadata) {
    ({ fields, metadata } = await enrichFromDownloadPop(fields, metadata, pageUrl, effectiveCookieValue, context));
    applyFieldsToContext(context, fields);
  }

  if (!browserMetadata && shouldUseBrowserPage(html, metadata, fields, true)) {
    const browserPage = await fetch3D66PageWithBrowserFallback(pageUrl || normalized.toString(), cookieValue);
    if (browserPage) {
      html = browserPage.html;
      pageUrl = browserPage.pageUrl;
      effectiveCookieValue = browserPage.cookieValue || cookieValue;
      fields = mergeBrowserFields(parseDynamicFields(html, pageUrl), browserPage.metadata);
      metadata = mergeBrowserMetadata(parseModelMetadata(html, pageUrl, fields), browserPage.metadata, fields);
      effectiveCookies = requireCookie(effectiveCookieValue);
      context = applyFieldsToContext(siteContext(pageUrl, effectiveCookies), fields);
    }
  }

  if (!fields.llId || !fields.token || !fields.upTime) {
    if (process.env.THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK === "true") {
      validateDynamicFields(fields);
    }
    const browserDownload = await download3D66WithBrowserFallback(pageUrl || normalized.toString(), effectiveCookieValue);
    if (browserDownload) return browserDownload;
    validateDynamicFields(fields);
  }

  const urls = buildModelUrls(pageUrl, fields);
  applyFieldsToContext(context, fields);
  const payload = buildDownloadPayload(fields, urls, effectiveCookies, context);
  let download;
  try {
    download = await requestDownloadUrl(payload, effectiveCookieValue, context.origin);
  } catch (error) {
    if (
      process.env.THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK === "true" &&
      process.env.THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK !== "true"
    ) {
      const browserDownload = await download3D66WithBrowserFallback(pageUrl || normalized.toString(), effectiveCookieValue, error);
      if (browserDownload) return browserDownload;
    }
    throw error;
  }
  return {
    fileUrl: download.fileUrl,
    productId: fields.llId,
    sourceUrl: pageUrl,
    title: metadata.title,
    imageUrl: metadata.imageUrl,
    creditCost: download.creditCost || metadata.creditCost
  };
}
