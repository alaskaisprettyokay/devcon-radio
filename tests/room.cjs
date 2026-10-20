"use strict";
// End to end: two visitors and a moderator in real browsers against the real server.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createServer } = require("../scripts/dev-server.cjs");
const out = path.resolve(__dirname, "../.test-results");
fs.mkdirSync(out, { recursive: true });

const TOKEN = "test-token-1234";
const until = async (fn, label, ms = 9000) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out: ${label} (${last?.message || last})`);
};

(async () => {
  const server = createServer({ modToken: TOKEN, chatangoRoom: "off" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const results = [];
  const guard = (context) =>
    context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base) return route.continue();
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html>",
      });
    });
  const visitor = async (viewport = { width: 1280, height: 900 }) => {
    const context = await browser.newContext({ viewport });
    await guard(context);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base, { waitUntil: "networkidle" });
    await until(
      async () => (await page.locator("#chat-state").textContent()) === "Live",
      "chat goes live",
    );
    return { context, page, errors };
  };
  const say = async (page, name, text) => {
    await page.fill("#chat-name", name);
    await page.fill("#chat-input", text);
    await page.press("#chat-input", "Enter");
  };
  const texts = (page) =>
    page.locator(".chat-message p:not(.chat-held)").allTextContents();

  try {
    const a = await visitor();
    const b = await visitor();
    const modContext = await browser.newContext({
      viewport: { width: 1000, height: 900 },
    });
    const mod = await modContext.newPage();
    await mod.goto(`${base}/mod`);
    await mod.fill("#token", "wrong");
    await mod.click("#login button");
    await until(
      async () =>
        (await mod.locator("#status").textContent()).includes("not accepted"),
      "bad token refused",
    );
    await mod.fill("#token", TOKEN);
    await mod.click("#login button");
    await mod.waitForSelector("#desk:not([hidden])");

    // 1. Messages are shared between visitors.
    await say(a.page, "Maya", "Mumbai needs a soundtrack");
    await until(
      async () => (await texts(b.page)).includes("Mumbai needs a soundtrack"),
      "B sees A",
    );
    results.push({ test: "a message reaches another visitor", ok: true });

    // 2. Links are removed automatically; nobody has to approve anything.
    await say(a.page, "Maya", "claim at https://evil.example now");
    await until(
      async () => (await texts(b.page)).includes("claim at [link removed] now"),
      "link removed and posted",
    );
    assert.ok(
      !(await texts(b.page)).some((t) => t.includes("evil.example")),
      "link leaked",
    );
    assert.match(
      await a.page.locator("#chat-status").textContent(),
      /Links are removed/,
    );
    results.push({ test: "links are removed automatically", ok: true });

    // 2b. Scam phrases are refused with a clear reason.
    await say(a.page, "Maya", "free ETH airdrop for all");
    await until(
      async () =>
        /scam/i.test(await a.page.locator("#chat-status").textContent()),
      "scam refused",
    );
    assert.ok(
      !(await texts(b.page)).some((t) => t.includes("airdrop")),
      "scam leaked",
    );
    results.push({ test: "scam phrases are refused", ok: true });

    // 3. Optional override: an organizer can still delete.
    await mod
      .locator('#recent .item:has-text("link removed") [data-act="delete"]')
      .click();
    await until(
      async () =>
        !(await texts(b.page)).includes("claim at [link removed] now"),
      "deleted hides",
    );
    results.push({ test: "optional organizer delete", ok: true });

    // 4. Pause chat stops the other visitor; resume restores.
    await mod.click("#lock");
    await until(
      async () => await b.page.locator("#chat-input").isDisabled(),
      "B composer locked",
    );
    assert.match(await b.page.locator("#chat-notice").textContent(), /paused/i);
    await mod.click("#lock");
    await until(
      async () => !(await b.page.locator("#chat-input").isDisabled()),
      "B composer restored",
    );
    results.push({ test: "pause and resume chat", ok: true });

    // 5. Report: three different visitors hide a message pending review.
    const reporters = [b, await visitor(), await visitor()];
    await say(a.page, "Maya", "something questionable");
    for (const r of reporters)
      await until(
        async () => (await texts(r.page)).includes("something questionable"),
        "reporter sees",
      );
    for (const r of reporters) {
      await r.page
        .locator('.chat-message:has-text("something questionable")')
        .hover();
      await r.page
        .locator(
          '.chat-message:has-text("something questionable") .chat-report',
        )
        .click();
    }
    await until(
      async () => !(await texts(b.page)).includes("something questionable"),
      "reported message hidden",
      12000,
    );
    await until(
      async () =>
        (await mod
          .locator('#held .item:has-text("something questionable")')
          .count()) === 1,
      "mod sees reported",
    );
    results.push({ test: "reports hold a message for review", ok: true });

    // 6. Ban cuts off the sender and removes their messages.
    mod.once("dialog", (d) => d.accept());
    await mod
      .locator('#recent .item:has-text("Mumbai needs") [data-act="ban"]')
      .click();
    await until(
      async () =>
        (await a.page.locator("#chat-notice").textContent()).includes(
          "no longer post",
        ),
      "A sees ban",
    );
    assert.equal(await a.page.locator("#chat-input").isDisabled(), true);
    await until(
      async () => !(await texts(b.page)).includes("Mumbai needs a soundtrack"),
      "banned history removed",
    );
    results.push({ test: "ban", ok: true });

    // 7. Rate limit surfaces a readable message and keeps the draft.
    const c = await visitor();
    for (let i = 0; i < 6; i++) {
      await c.page.fill("#chat-name", "Flood");
      await c.page.fill("#chat-input", `burst ${i}`);
      await c.page.press("#chat-input", "Enter");
      await new Promise((r) => setTimeout(r, 120));
    }
    await until(
      async () =>
        /slow down|Try again/i.test(
          await c.page.locator("#chat-status").textContent(),
        ),
      "rate message",
    );
    results.push({ test: "rate limit message", ok: true });

    // 8. Visual states for review.
    await modContext.setDefaultTimeout(5000);
    await mod.screenshot({
      path: path.join(out, "mod-desk.png"),
      fullPage: true,
    });
    await b.page.screenshot({ path: path.join(out, "room-live-desktop.png") });
    const phone = await visitor({ width: 390, height: 844 });
    await say(phone.page, "Anika", "Charanjit Singh. Acid before acid.");
    await until(
      async () => (await texts(phone.page)).length > 0,
      "phone sees chat",
    );
    await phone.page.locator("#chat").scrollIntoViewIfNeeded();
    await phone.page.screenshot({
      path: path.join(out, "room-live-mobile.png"),
      fullPage: true,
    });
    for (const v of [a, b, c, phone, ...reporters.slice(1)])
      assert.deepEqual(v.errors, [], "page errors");
    results.push({ test: "no page errors in any visitor", ok: true });

    // 9. Without a room server the page falls back to the local preview.
    const lone = await browser.newContext();
    await guard(lone);
    await lone.route("**/api/**", (r) =>
      r.fulfill({ status: 404, body: "no" }),
    );
    const lp = await lone.newPage();
    await lp.goto(base, { waitUntil: "networkidle" });
    assert.equal(await lp.locator("#chat-state").textContent(), "Preview");
    await say(lp, "Solo", "works offline");
    await until(
      async () => (await texts(lp)).includes("works offline"),
      "preview message",
    );
    results.push({ test: "falls back to browser-only preview", ok: true });
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
  fs.writeFileSync(
    path.join(out, "room-results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
