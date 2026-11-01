import assert from "node:assert/strict";
import path from "node:path";

export async function verifyGetlinkAuditLinks(page, context, { origin, screenshotRoot, viewport }) {
  const sourceUrl = "https://3d.3d66.com/reshtmla/model/items/fixture/audit.html?sof=original&sign=fixture";
  const resolvedSourceUrl = "https://3d.3d66.com/reshtmla/model/items/fixture/audit.html?sof=resolved&sign=fixture";
  const base = { user: { email: "audit@example.test", name: "Audit fixture" }, modelPrice: 28,
    priceKnown: true, creditDeducted: 28, redownloadCount: 0, createdAt: "2026-10-01T00:00:00Z" };
  const records = [
    { ...base, _id: "audit-retained", productId: "audit-retained", title: "Retained audit links",
      sourceUrl, resolvedSourceUrl, detailsPurgedAt: "2026-10-05T00:00:00Z" },
    { ...base, _id: "audit-purged", productId: "audit-purged", title: "Previously removed links",
      sourceUrl: "", resolvedSourceUrl: "", detailsPurgedAt: "2026-10-05T00:00:00Z" },
    { ...base, _id: "audit-legacy", productId: "audit-legacy", title: "Legacy record without links",
      sourceUrl: "", resolvedSourceUrl: "", detailsPurgedAt: null }
  ];
  const pattern = `${origin}/api/admin/getlinks*`;
  const handler = (route) => route.fulfill({ json: { getlinks: records,
    pagination: { page: 1, totalPages: 1, total: records.length, pageSize: 10 } } });
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
          .getByRole("button", { name: language === "vi" ? "Lịch sử tải" : "Download history", exact: true }).click();
        const table = page.locator(".getlinkAuditTable");
        const retained = table.locator(".tableRow").filter({ hasText: "audit-retained" });
        const links = retained.locator(".getlinkAuditLinks a");
        await links.nth(1).waitFor();
        assert.equal(await links.nth(0).getAttribute("href"), sourceUrl);
        assert.equal(await links.nth(1).getAttribute("href"), resolvedSourceUrl);
        assert.equal(await retained.locator(".getlinkAuditMissing").count(), 0);
        const purged = table.locator(".tableRow").filter({ hasText: "audit-purged" });
        const legacy = table.locator(".tableRow").filter({ hasText: "audit-legacy" });
        for (const row of [purged, legacy]) {
          assert.equal(await row.locator(".getlinkAuditLinks a").count(), 0);
          assert.ok((await row.locator(".getlinkAuditMissing").innerText()).trim());
        }
        assert.notEqual(await purged.locator(".getlinkAuditMissing").innerText(), await legacy.locator(".getlinkAuditMissing").innerText());
        await retained.locator(".getlinkAuditModel").screenshot({ path: path.join(screenshotRoot, `${viewport}-getlink-audit-links-${language}-${theme}.png`) });
        await purged.locator(".getlinkAuditModel").screenshot({ path: path.join(screenshotRoot, `${viewport}-getlink-audit-purged-${language}-${theme}.png`) });
      }
    }
  } finally { await context.unroute(pattern, handler); }
}
