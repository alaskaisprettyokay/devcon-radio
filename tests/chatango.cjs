"use strict";
// With a Chatango room configured the page hands chat to Chatango and stops
// using the built-in room. The Chatango script itself is stubbed: no request
// leaves this test, and a real room still needs a manual check.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createServer } = require("../scripts/dev-server.cjs");
const out = path.resolve(__dirname, "../.test-results");
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = createServer({
    modToken: "x",
    chatangoRoom: "devcon-radio-test",
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const requests = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.origin === base) return route.continue();
    if (url.hostname === "st.chatango.com")
      return route.fulfill({
        contentType: "text/javascript",
        body: "window.__chatangoLoaded = true;",
      });
    return route.fulfill({ contentType: "text/html", body: "<!doctype html>" });
  });
  const results = [];
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base, { waitUntil: "networkidle" });
    const embed = await page.evaluate(() => {
      const s = document.querySelector(
        '#chatango-mount script[src*="chatango"]',
      );
      return (
        s && {
          id: s.id,
          src: s.src,
          async: s.async,
          config: JSON.parse(s.textContent),
        }
      );
    });
    assert.ok(embed, "embed script was added");
    assert.match(embed.id, /^cid0020000\d+$/);
    assert.equal(embed.src, "https://st.chatango.com/js/gz/emb.js");
    assert.equal(embed.config.handle, "devcon-radio-test");
    assert.equal(embed.config.arch, "js");
    assert.equal(await page.locator("#chat-state").textContent(), "Chatango");
    for (const sel of ["#chat-log", "#chat-form", "#chat-notice"])
      assert.equal(await page.locator(sel).isHidden(), true, `${sel} hidden`);
    assert.equal(await page.locator("#chatango-mount").isVisible(), true);
    assert.ok(
      !requests.some((u) => u.includes("/api/chat")),
      "built-in room is not polled",
    );
    assert.deepEqual(errors, []);
    results.push({
      test: "Chatango room replaces the built-in chat",
      ok: true,
    });
    await page.screenshot({ path: path.join(out, "chatango-desktop.png") });

    // Track list and player are unaffected.
    assert.ok((await page.locator("#tracks li").count()) >= 3);
    results.push({ test: "tracks and player still render", ok: true });

    // A bad room name is ignored: the page keeps its configured default room.
    const bad = createServer({
      modToken: "x",
      chatangoRoom: '"><script>x</script>',
    });
    await new Promise((r) => bad.listen(0, "127.0.0.1", r));
    const ctx2 = await browser.newContext();
    await ctx2.route("**/st.chatango.com/**", (r) =>
      r.fulfill({ contentType: "text/javascript", body: "" }),
    );
    const p2 = await ctx2.newPage();
    await p2.goto(`http://127.0.0.1:${bad.address().port}`, {
      waitUntil: "domcontentloaded",
    });
    const handle = await p2.evaluate(
      () =>
        JSON.parse(document.querySelector("#chatango-mount script").textContent)
          .handle,
    );
    assert.equal(handle, "devcon");
    assert.equal(
      await p2.locator("script", { hasText: "<script>" }).count(),
      0,
    );
    await new Promise((r) => bad.close(r));
    results.push({ test: "invalid room name is rejected", ok: true });

    // "off" forces the built-in room even though the page names a Chatango room.
    const off = createServer({ modToken: "x", chatangoRoom: "off" });
    await new Promise((r) => off.listen(0, "127.0.0.1", r));
    const ctx3 = await browser.newContext();
    const p3 = await ctx3.newPage();
    await p3.goto(`http://127.0.0.1:${off.address().port}`, {
      waitUntil: "networkidle",
    });
    await p3.waitForFunction(
      () => document.querySelector("#chat-state")?.textContent === "Live",
    );
    assert.equal(await p3.locator("#chatango-mount script").count(), 0);
    await new Promise((r) => off.close(r));
    results.push({
      test: "CHATANGO_ROOM=off forces the built-in room",
      ok: true,
    });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
