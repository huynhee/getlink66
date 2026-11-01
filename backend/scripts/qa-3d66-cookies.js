import assert from "node:assert/strict";
import path from "node:path";

export async function verify3D66CookieCompatibility(page, context, { origin, screenshotRoot, viewport }) {
  let verified = false;
  const cookie = () => ({ _id: "cookie-compatibility-fixture", label: "Session without login_token", preview: "[stored]",
    keyCount: 2, hasRequiredKeys: true, missingKeys: [], status: "active", failureCount: 0, useCount: 0,
    lastTestOk: verified, lastTestAt: verified ? "2026-11-01T00:00:00Z" : null });
  const pattern = `${origin}/api/admin/cookie**`;
  const handler = (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/test")) {
      verified = true;
      return route.fulfill({ json: { ok: true, mode: "account-session", authenticated: true, accountMarker: "89635771", cookie: cookie() } });
    }
    if (url.pathname.endsWith("/status")) return route.fulfill({ json: { pool: {
      stats: { total: 1, active: 1, warning: 0, disabled: 0, cooldown: 0, invalid: 0 }, cookies: [cookie()], queue: {} } } });
    return route.fulfill({ json: { cookies: [cookie()] } });
  };
  await context.route(pattern, handler);
  try {
    for (const language of ["vi", "en"]) {
      for (const theme of ["light", "dark"]) {
        await page.evaluate(({ language, theme }) => {
          globalThis.localStorage.setItem("language", language);
          globalThis.localStorage.setItem("3dipl-theme", theme);
        }, { language, theme });
        await page.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(({ language, theme }) => globalThis.document.documentElement.lang === language
          && globalThis.document.documentElement.dataset.theme === theme, { language, theme });
        await page.getByRole("navigation", { name: "Admin sections", exact: true })
          .getByRole("button", { name: language === "vi" ? "Chung" : "General", exact: true }).click();
        await page.getByRole("navigation", { name: "Admin subsections", exact: true })
          .getByRole("button", { name: /^Cookie(?:\s|$)/ }).click();
        const panel = page.locator("section.panel").filter({ has: page.getByRole("heading", { name: /Quản lý Cookie|Cookie management/ }) });
        const row = panel.locator(".tableRow").filter({ hasText: "Session without login_token" });
        await row.getByText(language === "vi" ? "Đủ key" : "Keys OK", { exact: true }).waitFor();
        assert.ok(!(await row.innerText()).includes(language === "vi" ? "Thiếu:" : "Missing:"));
        await row.getByRole("button", { name: "Test", exact: true }).click();
        const message = panel.locator("p.success").filter({ hasText: /Đã xác minh đăng nhập|Login verified/ });
        await message.waitFor();
        assert.ok((await message.innerText()).includes("89635771"));
        await panel.getByRole("button", { name: language === "vi" ? "Kiểm tra" : "Check", exact: true }).click();
        await message.waitFor();
        assert.equal(await message.evaluate((element) => element.scrollWidth > element.clientWidth + 2), false);
        await panel.screenshot({ path: path.join(screenshotRoot, `${viewport}-cookie-compatibility-${theme}-${language}.png`) });
      }
    }
  } finally { await context.unroute(pattern, handler); }
}
