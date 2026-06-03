import GuideArticle from "../models/GuideArticle.js";
import { isSafeId, limitedString, rejectUnknownKeys } from "../utils/validators.js";

const ARTICLE_FIELDS = ["title", "slug", "summary", "coverImage", "content", "language", "isPublished", "sortOrder"];

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

function articlesForLanguage(articles = [], language = "vi") {
  const exact = articles.filter((article) => article.language === language);
  if (exact.length) return exact;
  const fallback = articles.filter((article) => article.language === "vi");
  return fallback.length ? fallback : articles;
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
  const title = limitedString(body.title ?? existing?.title ?? "", 160);
  const content = limitedString(body.content ?? existing?.content ?? "", 20000);
  const requestedSlug = limitedString(body.slug ?? existing?.slug ?? title, 120);

  return {
    title,
    slugSource: requestedSlug || title,
    summary: limitedString(body.summary ?? existing?.summary ?? "", 500),
    coverImage: normalizeImageUrl(body.coverImage ?? existing?.coverImage ?? ""),
    content,
    language: normalizeLanguage(body.language ?? existing?.language),
    isPublished: body.isPublished !== undefined ? Boolean(body.isPublished) : existing?.isPublished !== false,
    sortOrder: Number.isFinite(Number(body.sortOrder ?? existing?.sortOrder))
      ? Number(body.sortOrder ?? existing?.sortOrder)
      : 0
  };
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
    const filtered = articlesForLanguage(articles, language);
    res.json({ articles: sortArticles(filtered) });
  } catch (error) {
    next(error);
  }
}

export async function getPublishedGuide(req, res, next) {
  try {
    const language = normalizeLanguage(req.query.language);
    const articles = (await GuideArticle.find({ slug: req.params.slug, isPublished: true })).map(toPlain);
    const article =
      articles.find((item) => item.language === language) ||
      articles.find((item) => item.language === "vi") ||
      articles[0];
    if (!article) return res.status(404).json({ message: "Guide article not found" });
    res.json({ article });
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
