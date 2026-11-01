import assert from "node:assert/strict";
import path from "node:path";

export async function verify3D66ManualHandoff(page, context, { origin, screenshotRoot, viewport }) {
  // All pointer input targets this harmless local fixture, never an upstream challenge.
  const image = await page.evaluate(() => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = 1440; canvas.height = 900;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f5f7fa"; ctx.fillRect(0, 0, 1440, 900);
    ctx.fillStyle = "#132b40"; ctx.font = "32px sans-serif";
    ctx.fillText("Local QA fixture - no CAPTCHA", 50, 65);
    ctx.fillStyle = "#3a768b"; ctx.fillRect(200, 220, 280, 80);
    return canvas.toDataURL("image/png");
  });
  const pattern = `${origin}/api/admin/getlink/verifications**`;
  const eventsPattern = "**/api/account/events";
  const stopEvents = route => route.fulfill({ status: 204, body: "" });
  const fixture = { id: "manual-fixture-session", productId: "ACI896357714629725", status: "pending",
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), claimed: false };
  let present = true;
  let failComplete = true;
  const inputs = [];
  const actions = [];
  const handler = async route => {
    const request = route.request();
    const url = new URL(request.url());
    const action = url.pathname.split("/").at(-1);
    actions.push(action);
    if (action === "verifications") return route.fulfill({ json: { sessions: present ? [fixture] : [] } });
    if (action === "claim") return route.fulfill({ json: { session: fixture, token: "a".repeat(48) } });
    assert.equal(request.postDataJSON().token, "a".repeat(48));
    if (action === "frame") return route.fulfill({ json: { image, viewport: { width: 1440, height: 900 }, title: "Local QA fixture", session: fixture } });
    if (action === "input") inputs.push(request.postDataJSON());
    if (action === "complete" && failComplete) {
      failComplete = false;
      return route.fulfill({ status: 422, json: { message: "Fixture verification not finished" } });
    }
    if (action === "complete") present = false;
    return route.fulfill({ json: { ok: true } });
  };
  await context.route(pattern, handler);
  await context.route(eventsPattern, stopEvents);
  try {
    for (const language of ["vi", "en"]) {
      for (const theme of ["light", "dark"]) {
        present = true; failComplete = true; inputs.length = 0;
        await page.evaluate(({ language, theme }) => {
          globalThis.localStorage.setItem("language", language);
          globalThis.localStorage.setItem("3dipl-theme", theme);
        }, { language, theme });
        await page.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" });
        await page.getByRole("navigation", { name: "Admin sections", exact: true }).getByRole("button", { name: "Getlink", exact: true }).click();
        await page.locator(".threed66SettingsTabs").getByRole("button", { name: "Cookie", exact: true }).click();
        await page.getByRole("button", { name: language === "vi" ? "Mở phiên" : "Open session", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: language === "vi" ? "Xác minh thủ công" : "Manual verification" });
        const frame = dialog.locator(".verificationViewport img");
        await frame.waitFor();
        await frame.evaluate(element => element.decode());
        const bounds = await frame.boundingBox();
        assert.ok(bounds.width > 200 && bounds.height > 100);
        assert.ok(Math.abs(bounds.width / bounds.height - 1.6) < 0.02, "Verification viewport is distorted");
        const response = page.waitForResponse(response => response.url().endsWith("/input") && response.request().postDataJSON().type === "up");
        await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.3);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.3);
        await page.mouse.up();
        await response;
        assert.equal(inputs[0].type, "down");
        assert.equal(inputs.at(-1).type, "up");
        assert.ok(Math.abs(inputs[0].x - 288) < 3 && Math.abs(inputs[0].y - 270) < 3);
        for (let index = 0; index < inputs.length; index++) assert.equal(inputs[index].sequence, index);
        await dialog.getByRole("button", { name: language === "vi" ? "Tải lại trang" : "Reload page", exact: true }).click();
        const save = dialog.getByRole("button", { name: language === "vi" ? "Kiểm tra và lưu phiên" : "Verify and save session", exact: true });
        await save.click();
        await dialog.getByRole("alert").filter({ hasText: "Fixture verification not finished" }).waitFor();
        assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 2), false);
        assert.ok(await dialog.evaluate(element => element.querySelector("header").getBoundingClientRect().top
          >= element.getBoundingClientRect().top), "Verification header was scrolled out of view");
        await dialog.screenshot({ path: path.join(screenshotRoot, `${viewport}-getlink-verification-${theme}-${language}.png`) });
        await save.click();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("status").filter({ hasText: /Đã xác minh và lưu phiên|Session verified and saved/ }).waitFor();
      }
    }
    assert.ok(actions.includes("reload") && actions.includes("complete"));
  } finally {
    await context.unroute(pattern, handler);
    await context.unroute(eventsPattern, stopEvents);
  }
}
