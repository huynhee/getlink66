import assert from "node:assert/strict";
import path from "node:path";

export async function verifyModelLogin(page, context, { origin, screenshotRoot, viewport }) {
  const account = await context.request.get(`${origin}/api/auth/user`).then((response) => response.json());
  assert.ok(account.user?._id);
  const preferences = await page.evaluate(() => ({ language: localStorage.getItem("language"), theme: localStorage.getItem("3dipl-theme") }));
  let signedIn = false;
  let holdAccount;
  let releaseAccount;
  const modelRequests = [];
  const oauthRequests = [];
  const userPattern = "**/api/auth/user";
  const eventsPattern = "**/api/account/events";
  const oauthPattern = /\/api\/auth\/google\?/;
  const userHandler = async (route) => {
    if (holdAccount) await holdAccount;
    await route.fulfill({ json: signedIn ? account : { user: null, defaultLanguage: "en" } });
  };
  const eventsHandler = (route) => route.fulfill({ status: 204, body: "" });
  const oauthHandler = (route) => {
    oauthRequests.push(new URL(route.request().url()));
    return route.fulfill({ contentType: "text/html", body: "<title>OAuth fixture</title>Sign-in fixture; no Google request" });
  };
  const trackModels = (request) => {
    const url = new URL(request.url());
    if (!signedIn && url.pathname.startsWith("/api/marketplace/models")) modelRequests.push(url.pathname);
  };
  await context.route(userPattern, userHandler);
  await context.route(eventsPattern, eventsHandler);
  await context.route(oauthPattern, oauthHandler);
  page.on("request", trackModels);
  const assertGate = async (returnTo, language) => {
    const gate = page.locator(".modelLoginGate");
    await gate.waitFor({ state: "visible" });
    assert.equal(await page.locator(".marketSortControl, .marketDetailHero").count(), 0);
    const href = new URL(await gate.locator("a").getAttribute("href"), origin);
    assert.equal(href.pathname, "/api/auth/google");
    assert.equal(href.searchParams.get("returnTo"), returnTo);
    assert.match(await gate.locator("h2").innerText(), language === "vi" ? /Đăng nhập/ : /Sign in/);
    assert.equal(await gate.evaluate((root) => root.scrollWidth > root.clientWidth + 1), false);
    assert.deepEqual(modelRequests, [], "Guests must not mount or prefetch the model catalog/detail");
  };
  try {
    for (const language of ["vi", "en"]) for (const theme of ["light", "dark"]) {
      await page.evaluate(({ language, theme }) => {
        localStorage.setItem("language", language);
        localStorage.setItem("3dipl-theme", theme);
      }, { language, theme });
      const returnTo = "/models?q=desk&category=furniture-table-chair&sort=newest&ref=qa-login";
      await page.goto(origin + returnTo, { waitUntil: "domcontentloaded" });
      await assertGate(returnTo, language);
      const link = new URL(await page.locator(".modelLoginGate a").getAttribute("href"), origin);
      assert.equal(link.searchParams.get("ref"), "qa-login");
      await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-model-login-${language}-${theme}.png`), animations: "disabled" });
      await page.locator(".modelLoginGate a").click();
      await page.waitForURL((url) => url.pathname === "/api/auth/google");
      assert.equal(oauthRequests.at(-1).searchParams.get("returnTo"), returnTo);

      const detail = "/models/qa-login-model?variant=corona";
      await page.goto(origin + detail, { waitUntil: "domcontentloaded" });
      await assertGate(detail, language);

      await page.goto(`${origin}/plugin?ref=qa-menu`, { waitUntil: "domcontentloaded" });
      const menu = page.locator(".mobileMenuButton");
      if (await menu.isVisible() && await menu.getAttribute("aria-expanded") !== "true") await menu.click();
      await page.locator(".tabs button").first().click();
      await page.waitForURL((url) => url.pathname === "/api/auth/google");
      assert.equal(oauthRequests.at(-1).searchParams.get("returnTo"), "/models");
      assert.equal(oauthRequests.at(-1).searchParams.get("ref"), "qa-menu");
      assert.deepEqual(modelRequests, []);
    }

    signedIn = true;
    holdAccount = new Promise((resolve) => { releaseAccount = resolve; });
    const catalog = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/marketplace/models");
    await page.goto(`${origin}/models`, { waitUntil: "domcontentloaded" });
    await page.locator("main.center").waitFor({ state: "visible" });
    assert.equal(await page.locator(".modelLoginGate").count(), 0, "Do not show a login prompt before account bootstrap finishes");
    holdAccount = null;
    releaseAccount();
    assert.equal((await catalog).ok(), true);
    await page.locator(".marketSortControl").waitFor({ state: "visible" });
    assert.equal(await page.locator(".marketSortControl select").inputValue(), "newest");
    assert.equal(await page.locator(".modelLoginGate").count(), 0);

    signedIn = false;
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertGate("/models", await page.locator("html").getAttribute("lang"));
  } catch (error) {
    await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-model-login-failure.png`), fullPage: true });
    throw error;
  } finally {
    holdAccount = null;
    releaseAccount?.();
    page.off("request", trackModels);
    await context.unroute(userPattern, userHandler);
    await context.unroute(eventsPattern, eventsHandler);
    await context.unroute(oauthPattern, oauthHandler);
    await page.evaluate(({ language, theme }) => {
      for (const [key, value] of [["language", language], ["3dipl-theme", theme]]) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }, preferences);
    await page.goto(`${origin}/models`, { waitUntil: "domcontentloaded" });
  }
}
