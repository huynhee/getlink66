import assert from "node:assert/strict";
import path from "node:path";

export async function verifyBilingualGuides(page, context, { origin, screenshotRoot, viewport }) {
  const editor = page.locator(".adminArticles");
  const translations = {
    vi: { title: `Huong dan song ngu ${viewport}`, summary: "Mo ta tieng Viet", content: "# Cai dat\nNoi dung tieng Viet" },
    en: { title: `Bilingual guide ${viewport}`, summary: "English summary", content: "# Installation\nEnglish content" }
  };
  const slug = `bilingual-guide-${viewport}`;
  let articleId;
  const csrf = await (await context.request.get(`${origin}/api/auth/csrf`)).json();
  const headers = { "x-csrf-token": csrf.csrfToken, origin };

  async function setLanguage(language) {
    const toggle = page.locator(".languageToggleSingle button");
    await toggle.waitFor({ state: "attached" });
    if (await page.locator("html").getAttribute("lang") === language) return;
    const menu = page.locator(".mobileMenuButton");
    if (!await toggle.isVisible() && await menu.isVisible()) await menu.click();
    await toggle.waitFor({ state: "visible" });
    await toggle.click();
    await page.waitForFunction((locale) => globalThis.document.documentElement.lang === locale, language);
    if (await page.locator(".mobileMenuButton").getAttribute("aria-expanded") === "true") await page.locator(".mobileMenuButton").click();
  }

  async function openEditor() {
    await page.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", { name: "Admin sections", exact: true }).getByRole("button", { name: "Website", exact: true }).click();
    await page.getByRole("navigation", { name: "Admin subsections", exact: true }).getByRole("button", { name: /^(Bài viết|Articles)\b/ }).click();
    await editor.waitFor();
  }

  async function assertPublic(language) {
    const expected = translations[language];
    const article = page.locator(".guideArticle");
    await page.waitForFunction(({ title, content }) => {
      const element = globalThis.document.querySelector(".guideArticle");
      return element?.textContent.includes(title) && element?.textContent.includes(content);
    }, { title: expected.title, content: expected.content.split("\n")[1] });
    assert.equal(await article.getAttribute("lang"), language);
    assert.equal((await page.locator(".guideNav button.active span").textContent()).trim(), expected.title);
  }

  try {
    await openEditor();
    await setLanguage("vi");
    await editor.getByLabel("Slug URL", { exact: true }).fill(slug);
    for (const language of ["vi", "en"]) {
      await editor.getByRole("tab", { name: language === "vi" ? "Tiếng Việt" : "English", exact: true }).click();
      await editor.locator("#article-title").fill(translations[language].title);
      await editor.locator("#article-summary").fill(translations[language].summary);
      await editor.locator("#article-content").fill(translations[language].content);
    }
    // Switching tabs must not discard unsaved text.
    await editor.getByRole("tab", { name: "Tiếng Việt", exact: true }).click();
    assert.equal(await editor.locator("#article-title").inputValue(), translations.vi.title);
    const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/articles" && response.request().method() === "POST");
    await editor.getByRole("button", { name: "Tạo bài viết", exact: true }).click();
    const response = await created;
    assert.equal(response.status(), 200, await response.text());
    const data = await response.json();
    articleId = data.article._id;
    assert.deepEqual(data.article.translations, translations);
    await editor.getByRole("status").waitFor();

    const row = editor.locator(".tableRow").filter({ hasText: slug });
    await row.getByRole("button", { name: "Sửa", exact: true }).click();
    for (const language of ["vi", "en"]) {
      await setLanguage(language);
      await editor.getByRole("tab", { name: language === "vi" ? "Tiếng Việt" : "English", exact: true }).click();
      assert.equal(await editor.locator("#article-content").inputValue(), translations[language].content);
      for (const theme of ["light", "dark"]) {
        if (await page.locator("html").getAttribute("data-theme") !== theme) {
          if (!await page.locator(".themeToggle").isVisible()) await page.locator(".mobileMenuButton").click();
          await page.locator(".themeToggle").click();
          if (await page.locator(".mobileMenuButton").getAttribute("aria-expanded") === "true") await page.locator(".mobileMenuButton").click();
        }
        assert.equal(await editor.locator(".articleTranslationFields").evaluate((element) => element.scrollWidth <= element.clientWidth + 2), true);
        if (viewport === "mobile") {
          assert.equal(await editor.locator(".articleTable").evaluate((element) => element.scrollWidth <= element.clientWidth + 2), true);
        }
        await editor.screenshot({ path: path.join(screenshotRoot, `${viewport}-article-editor-${theme}-${language}.png`) });
      }
    }
    translations.en.summary = "Updated English summary";
    await editor.locator("#article-summary").fill(translations.en.summary);
    const updated = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/admin/articles/${articleId}` && candidate.request().method() === "PUT");
    await editor.getByRole("button", { name: "Save article", exact: true }).click();
    const updateResponse = await updated;
    assert.equal(updateResponse.status(), 200, await updateResponse.text());
    assert.deepEqual((await updateResponse.json()).article.translations, translations);

    for (const route of ["/guide", "/"]) {
      await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
      await setLanguage("vi");
      await page.locator(".guideNav").getByRole("button", { name: translations.vi.title, exact: true }).click();
      await assertPublic("vi");
      await setLanguage("en");
      await assertPublic("en");
      await setLanguage("vi");
      await assertPublic("vi");
      await page.locator(".guideLayout").screenshot({ path: path.join(screenshotRoot, `${viewport}-bilingual-${route === "/" ? "home" : "guide"}.png`) });
    }
  } finally {
    if (articleId) {
      const result = await context.request.delete(`${origin}/api/admin/articles/${articleId}`, { headers });
      assert.equal(result.status(), 200);
    }
  }
}
