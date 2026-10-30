import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { guideTranslations, localizeGuide } from "../src/utils/guideLocalization.js";
import { articleTranslations, translationComplete } from "../../frontend/src/utils/guideArticles.js";

useMemoryDb();
const { default: GuideArticle } = await import("../src/models/GuideArticle.js");
const {
  createAdminArticle, updateAdminArticle, deleteAdminArticle,
  listAdminArticles, listPublishedGuides, getPublishedGuide
} = await import("../src/controllers/guideController.js");

const vi = { title: "Huong dan cai dat", summary: "Mo ta VI", content: "# Cai dat\nNoi dung VI" };
const en = { title: "Installation guide", summary: "EN summary", content: "# Installation\nEN content" };

beforeEach(async () => { await GuideArticle.deleteMany({}); });

async function invoke(handler, input = {}) {
  const res = {
    statusCode: 200, payload: null, error: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  await handler({ body: {}, params: {}, query: {}, ...input }, res, (error) => { res.error = error; });
  return res;
}

async function create(body = {}) {
  const result = await invoke(createAdminArticle, { body: { translations: { vi, en }, ...body } });
  assert.equal(result.error, null);
  assert.equal(result.statusCode, 200);
  return result.payload.article;
}

async function list(language) {
  const result = await invoke(listPublishedGuides, { query: { language } });
  assert.equal(result.error, null);
  return result.payload.articles;
}

test("one bilingual article returns localized text with the same ID, slug and cover", async () => {
  const article = await create({ coverImage: "https://example.test/cover.jpg" });
  for (const language of ["vi", "en"]) {
    const expected = language === "vi" ? vi : en;
    const [localized] = await list(language);
    assert.equal(localized._id, article._id);
    assert.equal(localized.slug, article.slug);
    assert.equal(localized.title, expected.title);
    assert.equal(localized.content, expected.content);
    assert.equal(localized.summary, expected.summary);
    assert.equal(localized.coverImage, article.coverImage);
    assert.equal(localized.language, language);
    assert.deepEqual(localized.availableLanguages, ["vi", "en"]);
    assert.equal(localized.translations, undefined);
    const detail = await invoke(getPublishedGuide, { params: { slug: article.slug }, query: { language } });
    assert.deepEqual(detail.payload.article, localized);
  }
  assert.equal(await GuideArticle.countDocuments(), 1);
});

test("legacy VI and EN articles remain visible together, with per-article fallback", async () => {
  const originalVi = await GuideArticle.create({ ...vi, slug: "legacy-vi", language: "vi", isPublished: true, sortOrder: 1 });
  const originalEn = await GuideArticle.create({ ...en, slug: "legacy-en", language: "en", isPublished: true, sortOrder: 2 });
  await create({ sortOrder: 0 });
  for (const language of ["vi", "en", undefined, "unknown"]) {
    const articles = await list(language);
    assert.equal(articles.length, 3);
    assert.equal(articles[1]._id, originalVi._id);
    assert.equal(articles[1].content, vi.content);
    assert.equal(articles[2]._id, originalEn._id);
    assert.equal(articles[2].content, en.content);
  }
  for (const article of [originalVi, originalEn]) {
    assert.deepEqual(articleTranslations(article), guideTranslations(article));
    assert.equal(translationComplete(articleTranslations(article)[article.language]), true);
  }
});

test("adding EN to a legacy VI article preserves ID, URL, cover, order and original text", async () => {
  const article = await GuideArticle.create({ ...vi, slug: "old-url", language: "vi", coverImage: "https://example.test/a.png", sortOrder: 7, isPublished: true });
  const result = await invoke(updateAdminArticle, { params: { id: article._id }, body: { translations: { en } } });
  assert.equal(result.error, null);
  assert.deepEqual(result.payload.article.translations, { vi, en });
  assert.equal(result.payload.article.slug, "old-url");
  assert.equal(result.payload.article.coverImage, article.coverImage);
  assert.equal(result.payload.article.sortOrder, 7);
  assert.equal((await list("vi"))[0].content, vi.content);
  assert.equal((await list("en"))[0].content, en.content);
});

test("partial localized and legacy-client edits preserve the other language", async () => {
  const article = await create();
  let result = await invoke(updateAdminArticle, {
    params: { id: article._id }, body: { translations: { en: { summary: "Updated EN" } } }
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.payload.article.translations.vi, vi);
  assert.deepEqual(result.payload.article.translations.en, { ...en, summary: "Updated EN" });
  result = await invoke(updateAdminArticle, { params: { id: article._id }, body: { title: "New VI title" } });
  assert.equal(result.error, null);
  assert.equal(result.payload.article.translations.vi.title, "New VI title");
  assert.equal(result.payload.article.translations.en.summary, "Updated EN");
  assert.equal(result.payload.article.title, "New VI title");
  assert.equal(result.payload.article.slug, article.slug);
});

test("EN-only creation and clearing one translation never resurrect deleted legacy text", async () => {
  const single = await create({ translations: { en } });
  assert.equal(single.language, "en");
  assert.equal(single.title, en.title);
  assert.equal((await list("vi"))[0].content, en.content);
  const article = await create();
  const result = await invoke(updateAdminArticle, {
    params: { id: article._id }, body: { translations: { vi: { title: "", summary: "", content: "" } } }
  });
  assert.equal(result.error, null);
  assert.equal(result.payload.article.language, "en");
  assert.equal(result.payload.article.content, en.content);
  const fresh = await GuideArticle.findById(article._id);
  assert.deepEqual(guideTranslations(fresh).vi, { title: "", summary: "", content: "" });
  assert.deepEqual(articleTranslations(fresh), guideTranslations(fresh));
  assert.equal(localizeGuide(fresh, "vi").language, "en");
});

test("reject malformed, unsupported, oversized and incomplete translations without writing", async () => {
  const article = await create();
  const invalid = [null, [], "en", { fr: en }, { en: null }, { en: [] },
    { en: { title: 7 } }, { en: { content: null } }, { en: { extra: "x" } },
    { en: { title: "x".repeat(161) } }, { en: { summary: "x".repeat(501) } },
    { en: { content: "x".repeat(20001) } }, { en: { title: "", content: "still here" } },
    JSON.parse('{"__proto__":{"title":"bad"}}')];
  for (const translations of invalid) {
    const result = await invoke(updateAdminArticle, { params: { id: article._id }, body: { translations } });
    assert.equal(result.error?.status, 400, JSON.stringify(translations)?.slice(0, 100));
    assert.deepEqual((await GuideArticle.findById(article._id)).translations, { vi, en });
  }
  for (const translations of [{ vi: { title: "Title only" } }, { en: { summary: "Summary only" } }]) {
    const result = await invoke(createAdminArticle, { body: { translations } });
    assert.equal(result.error?.status, 400);
  }
  const empty = await invoke(createAdminArticle, { body: { translations: {} } });
  assert.equal(empty.statusCode, 400);
  assert.equal(await GuideArticle.countDocuments(), 1);
});

test("draft visibility, admin reads, unique slugs and deletion apply to both translations", async () => {
  const first = await create({ slug: "shared" });
  const hidden = await create({ slug: "shared", isPublished: false });
  assert.equal(hidden.slug, "shared-2");
  for (const language of ["vi", "en"]) {
    assert.deepEqual((await list(language)).map((article) => article._id), [first._id]);
    const detail = await invoke(getPublishedGuide, { params: { slug: hidden.slug }, query: { language } });
    assert.equal(detail.statusCode, 404);
  }
  const admin = await invoke(listAdminArticles);
  assert.equal(admin.payload.articles.length, 2);
  assert.deepEqual(admin.payload.articles[0].translations, { vi, en });
  assert.equal((await invoke(deleteAdminArticle, { params: { id: first._id } })).payload.ok, true);
  assert.equal((await list("en")).length, 0);
});

test("old create contract still works and shared settings updates preserve translations", async () => {
  const result = await invoke(createAdminArticle, { body: { ...en, language: "en" } });
  assert.equal(result.error, null);
  assert.equal(result.payload.article.language, "en");
  assert.deepEqual(result.payload.article.translations.en, en);
  const update = await invoke(updateAdminArticle, {
    params: { id: result.payload.article._id }, body: { sortOrder: 15, isPublished: false }
  });
  assert.equal(update.error, null);
  assert.deepEqual(update.payload.article.translations.en, en);
  assert.equal(update.payload.article.sortOrder, 15);
  assert.equal(update.payload.article.isPublished, false);
});
