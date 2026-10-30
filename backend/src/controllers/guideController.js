import GuideArticle from "../models/GuideArticle.js";
import { isSafeId, limitedString, rejectUnknownKeys } from "../utils/validators.js";
import { GUIDE_LANGUAGES, GUIDE_TEXT_LIMITS, guideTranslations, hasGuideTranslation, localizeGuide } from "../utils/guideLocalization.js";

const ARTICLE_FIELDS = ["title", "slug", "summary", "coverImage", "content", "language", "translations", "isPublished", "sortOrder"];

function toPlain(article) {
  if (!article) return null;
  return typeof article.toObject === "function" ? article.toObject() : article;
}

function normalizeLanguage(value) {
  return value === "en" ? "en" : "vi";
}

function slugify(value = "") {
  const slug = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `bai-viet-${Date.now()}`;
}

function sortArticles(articles = []) {
  return [...articles].sort((a, b) => {
    const orderDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
    if (orderDiff !== 0) return orderDiff;
    return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
  });
}

async function uniqueSlug(baseSlug, ignoreId = "") {
  let candidate = slugify(baseSlug);
  let suffix = 2;

  while (true) {
    const articles = await GuideArticle.find({ slug: candidate });
    const conflict = articles.find((item) => String(item._id) !== String(ignoreId));
    if (!conflict) return candidate;
    candidate = `${slugify(baseSlug)}-${suffix}`;
    suffix += 1;
  }
}

function normalizePayload(body = {}, existing = null) {
  const translations = guideTranslations(existing || {});
  let language = normalizeLanguage(body.language ?? existing?.language);
  for (const [key, limit] of Object.entries(GUIDE_TEXT_LIMITS)) {
    if (body[key] !== undefined) translations[language][key] = limitedString(body[key], limit);
  }
  if (body.translations !== undefined) {
    if (!isObject(body.translations) || rejectUnknownKeys(body.translations, GUIDE_LANGUAGES)) {
      throw Object.assign(new Error("Invalid article translations"), { status: 400 });
    }
    for (const [locale, fields] of Object.entries(body.translations)) {
      if (!isObject(fields) || rejectUnknownKeys(fields, Object.keys(GUIDE_TEXT_LIMITS))) {
        throw Object.assign(new Error("Invalid article translation fields"), { status: 400 });
      }
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value !== "string" || value.length > GUIDE_TEXT_LIMITS[key]) {
          throw Object.assign(new Error(`Invalid ${locale} article ${key}`), { status: 400 });
        }
        translations[locale][key] = value.trim();
      }
    }
  }
  for (const locale of GUIDE_LANGUAGES) {
    const translation = translations[locale];
    if (Object.values(translation).some(Boolean) && !hasGuideTranslation(translation)) {
      throw Object.assign(new Error(`Title and content are required for ${locale.toUpperCase()}`), { status: 400 });
    }
  }
  if (!hasGuideTranslation(translations[language])) {
    language = GUIDE_LANGUAGES.find((locale) => hasGuideTranslation(translations[locale])) || language;
  }
  const { title, summary, content } = translations[language];
  const requestedSlug = limitedString(body.slug ?? existing?.slug ?? title, 120);

  return {
    title,
    slugSource: requestedSlug || title,
    summary,
    coverImage: normalizeImageUrl(body.coverImage ?? existing?.coverImage ?? ""),
    content,
    language,
    translations,
    isPublished: body.isPublished !== undefined ? Boolean(body.isPublished) : existing?.isPublished !== false,
    sortOrder: Number.isFinite(Number(body.sortOrder ?? existing?.sortOrder))
      ? Number(body.sortOrder ?? existing?.sortOrder)
      : 0
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeImageUrl(value = "") {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) return "";
  try {
    const parsed = new URL(imageUrl);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export async function listPublishedGuides(req, res, next) {
  try {
    const language = normalizeLanguage(req.query.language);
    const articles = (await GuideArticle.find({ isPublished: true })).map(toPlain);
    res.json({ articles: sortArticles(articles).map((article) => localizeGuide(article, language)) });
  } catch (error) {
    next(error);
  }
}

export async function getPublishedGuide(req, res, next) {
  try {
    const language = normalizeLanguage(req.query.language);
    const articles = (await GuideArticle.find({ slug: req.params.slug, isPublished: true })).map(toPlain);
    const article = articles[0];
    if (!article) return res.status(404).json({ message: "Guide article not found" });
    res.json({ article: localizeGuide(article, language) });
  } catch (error) {
    next(error);
  }
}

export async function listAdminArticles(_req, res, next) {
  try {
    const articles = (await GuideArticle.find()).map(toPlain);
    res.json({ articles: sortArticles(articles) });
  } catch (error) {
    next(error);
  }
}

export async function createAdminArticle(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ARTICLE_FIELDS);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid article request" });
    }

    const payload = normalizePayload(req.body);
    if (!payload.title || !payload.content) {
      return res.status(400).json({ message: "Title and content are required" });
    }

    const article = await GuideArticle.create({
      title: payload.title,
      slug: await uniqueSlug(payload.slugSource),
      summary: payload.summary,
      coverImage: payload.coverImage,
      content: payload.content,
      language: payload.language,
      translations: payload.translations,
      isPublished: payload.isPublished,
      sortOrder: payload.sortOrder
    });

    res.json({ article });
  } catch (error) {
    next(error);
  }
}

export async function updateAdminArticle(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ARTICLE_FIELDS);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid article request" });
    }
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid article id" });
    }

    const existing = toPlain(await GuideArticle.findById(req.params.id));
    if (!existing) return res.status(404).json({ message: "Guide article not found" });

    const payload = normalizePayload(req.body, existing);
    if (!payload.title || !payload.content) {
      return res.status(400).json({ message: "Title and content are required" });
    }

    const article = await GuideArticle.findByIdAndUpdate(
      req.params.id,
      {
        title: payload.title,
        slug: await uniqueSlug(payload.slugSource, req.params.id),
        summary: payload.summary,
        coverImage: payload.coverImage,
        content: payload.content,
        language: payload.language,
        translations: payload.translations,
        isPublished: payload.isPublished,
        sortOrder: payload.sortOrder
      },
      { new: true }
    );

    res.json({ article });
  } catch (error) {
    next(error);
  }
}

export async function deleteAdminArticle(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid article id" });
    }

    await GuideArticle.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}
