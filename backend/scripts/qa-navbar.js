import assert from "node:assert/strict";
import path from "node:path";

export async function verifyCompactNavbar(page, context, { origin, screenshotRoot, viewport }) {
  const account = await context.request.get(`${origin}/api/auth/user`).then((response) => response.json());
  const initialViewport = page.viewportSize();
  const preferences = await page.evaluate(() => ({ language: localStorage.getItem("language"), theme: localStorage.getItem("3dipl-theme") }));
  const userPattern = "**/api/auth/user";
  const eventsPattern = "**/api/account/events";
  const notificationsPattern = /\/api\/notifications(?:\?.*)?$/;
  const fixture = { ...account, user: { ...account.user, credit: 1234, name: "Alex Nguyen",
    email: "alex.nguyen@example.test", avatar: "" } };
  const userHandler = (route) => route.fulfill({ json: fixture });
  const eventsHandler = (route) => route.fulfill({ status: 204, body: "" });
  const notificationsHandler = (route) => route.fulfill({ json: { notifications: [] } });
  await context.route(userPattern, userHandler);
  await context.route(eventsPattern, eventsHandler);
  await context.route(notificationsPattern, notificationsHandler);
  const openMenu = async () => {
    const menu = page.locator(".mobileMenuButton");
    if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true") await menu.click();
  };
  const assertToolbar = async (compact) => {
    const problem = await page.locator(".account").evaluate((root, compact) => {
      if (globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1) return "Page overflow";
      if (root.scrollWidth > root.clientWidth + 1) return "Account overflow";
      const selectors = [".pluginDownloadButton", ".themeToggle", ".languageToggle", ".notificationButton", ".accountCreditPill", ".accountTrigger"];
      const controls = selectors.map((selector) => root.querySelector(selector));
      const boxes = controls.map((control) => control.getBoundingClientRect());
      if (compact) {
        if (boxes.some((box) => Math.abs(box.top - boxes[0].top) > 1)) return "Controls are not on one row";
        if (boxes.some((box) => box.width < 32 || box.height < 38)) return "Control too small";
        if (boxes.some((box, index) => index && box.left < boxes[index - 1].right)) return "Controls overlap";
        if (boxes[0].width > 44) return "Plugin button is not compact";
        if (controls[0].querySelector("span").getClientRects().length) return "Plugin label should collapse to an icon";
      }
      if (controls.some((control) => !(control.querySelector("button") || control).getAttribute("aria-label"))) return "Missing accessible control label";
      return "";
    }, compact);
    assert.equal(problem, "", `${viewport}: ${problem}`);
  };
  try {
    for (const width of viewport === "mobile" ? [320, 390, 767] : [1440]) {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
      for (const language of ["vi", "en"]) for (const theme of ["light", "dark"]) {
        await page.evaluate(({ language, theme }) => {
          localStorage.setItem("language", language);
          localStorage.setItem("3dipl-theme", theme);
        }, { language, theme });
        await page.goto(`${origin}/models`, { waitUntil: "domcontentloaded" });
        const avatar = page.locator(".accountTrigger");
        await avatar.waitFor({ state: "attached" });
        await openMenu();
        assert.equal(await page.locator(".accountMenuContent").count(), 0, "Account details must not mount before the avatar is pressed");
        assert.equal(await avatar.getAttribute("aria-expanded"), "false");
        assert.equal(await page.locator(".pluginDownloadButton").getAttribute("href"), "/plugin");
        await assertToolbar(width <= 767);
        await page.locator(width <= 767 ? ".topbarMenu" : ".topbar").screenshot({
          path: path.join(screenshotRoot, `navbar-${width}-${language}-${theme}-closed.png`),
          animations: "disabled",
        });
        await avatar.click();
        assert.equal(await avatar.getAttribute("aria-expanded"), "true");
        const panel = page.locator(".accountMenuContent");
        await panel.waitFor({ state: "visible" });
        assert.equal(await avatar.getAttribute("aria-controls"), await panel.getAttribute("id"));
        await assertToolbar(width <= 767);
        const bounds = await panel.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, "Account panel must fit the viewport");
        if (width <= 767) {
          const button = await avatar.boundingBox();
          assert.ok(bounds.y >= button.y + button.height, "Account panel must not cover the toolbar");
        }
        await page.locator(width <= 767 ? ".topbarMenu" : ".topbar").screenshot({
          path: path.join(screenshotRoot, `navbar-${width}-${language}-${theme}-open.png`),
          animations: "disabled",
        });
        await avatar.focus();
        await avatar.press("Escape");
        assert.equal(await panel.count(), 0);
        await avatar.press("Enter");
        await panel.waitFor({ state: "visible" });
        await page.locator(".notificationButton").click();
        assert.equal(await panel.count(), 0, "Opening notifications closes account details");
        const notifications = page.locator(".notificationDropdown");
        await notifications.waitFor({ state: "visible" });
        const notificationBounds = await notifications.boundingBox();
        assert.ok(notificationBounds.width > 200 && notificationBounds.x >= 0 && notificationBounds.x + notificationBounds.width <= width + 1);
        await avatar.click();
        assert.equal(await notifications.isVisible(), false);
        if (width <= 767) {
          await page.locator(".mobileMenuButton").click();
          await openMenu();
          assert.equal(await panel.count(), 0, "Reopening mobile navigation must not reopen account details");
          await avatar.click();
        }
        await panel.locator(".accountMenuNavigation button").first().click();
        await page.waitForURL(`${origin}/history`);
        assert.equal(await panel.count(), 0, "Account navigation closes details");
      }
    }
    if (viewport === "mobile") {
      fixture.user.credit = 123456789012345;
      fixture.user.email = "a-long-account-address-for-mobile-layout@example.test";
      await page.setViewportSize({ width: 320, height: 844 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator(".accountTrigger").waitFor({ state: "attached" });
      await openMenu();
      await assertToolbar(true);
      assert.match(await page.locator(".accountCreditPill").getAttribute("aria-label"), /123456789012345/);
      await page.locator(".accountTrigger").click();
      await assertToolbar(true);
    }
  } catch (error) {
    await page.screenshot({ path: path.join(screenshotRoot, `navbar-${viewport}-failure.png`), fullPage: true });
    throw error;
  } finally {
    await context.unroute(userPattern, userHandler);
    await context.unroute(eventsPattern, eventsHandler);
    await context.unroute(notificationsPattern, notificationsHandler);
    await page.setViewportSize(initialViewport);
    await page.evaluate(({ language, theme }) => {
      for (const [key, value] of [["language", language], ["3dipl-theme", theme]]) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }, preferences);
    await page.goto(`${origin}/models`, { waitUntil: "domcontentloaded" });
  }
}
