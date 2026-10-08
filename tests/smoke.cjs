const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createServer } = require("../scripts/dev-server.cjs");
const out = path.resolve(__dirname, "../.test-results");
fs.mkdirSync(out, { recursive: true });

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext();
  // No requests leave this test browser. Provider audio is a separate manual check.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (url.hostname === "noembed.com") {
      const track = url.searchParams.get("url") || "";
      let data = { error: "Metadata unavailable (fixture)" };
      if (track.includes("9bZkp7q19f0"))
        data = {
          title: "PSY - GANGNAM STYLE",
          author_name: "officialpsy",
          thumbnail_url: "assets/yaeji.webp",
        };
      if (track.includes("jNQXAC9IVRw"))
        data = {
          title: "Me at the zoo",
          author_name: "jawed",
          thumbnail_url: "assets/charanjit.webp",
        };
      return route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(data),
      });
    }
    return route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Player fixture</title>",
    });
  });
  const results = [];
  try {
    for (const width of [360, 390, 768, 1024, 1440]) {
      const page = await context.newPage();
      await page.setViewportSize({ width, height: 900 });
      const errors = [],
        requests = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => requests.push(r.url()));
      await page.goto(base, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => ({
        width: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        font: document.fonts.check("500 14px Poppins"),
        bytes: performance
          .getEntriesByType("resource")
          .reduce((s, r) => s + r.encodedBodySize, 0),
        paint: performance
          .getEntriesByType("paint")
          .map((x) => ({ name: x.name, ms: x.startTime })),
        images: [...document.images].every(
          (i) => i.complete && i.naturalWidth > 0,
        ),
        player: document
          .querySelector("#player")
          .getBoundingClientRect()
          .toJSON(),
        chat: document.querySelector("#chat").getBoundingClientRect().toJSON(),
      }));
      assert(metrics.scrollWidth <= width, `overflow at ${width}`);
      assert(metrics.font && metrics.images);
      assert(!errors.length);
      assert(
        requests.every((u) => u.startsWith(base)),
        "third party loaded before Play",
      );
      assert(metrics.player.top < 300);
      if (width > 760)
        assert(metrics.player.right <= metrics.chat.left, "panel overlap");
      assert.equal(
        await page.locator(".brand").getAttribute("href"),
        "https://devcon.org/en/",
      );
      assert.equal(await page.locator(".edition").count(), 0);
      if (width === 390 || width === 1440)
        await page.screenshot({
          path: `${out}/astra-${width}.png`,
          fullPage: true,
        });
      results.push({
        test: "layout and idle load",
        width,
        ...metrics,
        requests: requests.length,
        errors,
      });
      await page.close();
    }
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "networkidle" });
    await page.fill("#chat-name", "QA");
    await page.fill("#chat-input", "<img src=x onerror=alert(1)> Great tune.");
    await page.press("#chat-input", "Enter");
    assert(
      (await page.locator(".chat-message").last().textContent()).includes(
        "<img",
      ),
    );
    assert.equal(
      await page.locator(".chat-message").last().locator("img").count(),
      0,
    );
    await page.reload({ waitUntil: "networkidle" });
    assert(
      (await page.locator(".chat-message").last().textContent()).includes(
        "Great tune",
      ),
    );
    results.push({
      test: "normal chat, escaping and reload persistence",
      ok: true,
    });
    await page.fill("#url", "javascript:alert(1)");
    assert((await page.textContent("#form-message")).includes("Use a"));
    await page.fill("#url", "https://youtube.com.evil.test/watch?v=dQw4w9WgXc");
    assert((await page.textContent("#form-message")).includes("Use a"));
    results.push({ test: "unsafe URL / host spoof rejection", ok: true });
    await page.fill("#url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.waitForSelector("#manual-fields:not([hidden])");
    results.push({
      test: "unavailable metadata reveals usable manual fallback (error fixture)",
      ok: true,
    });
    await page.fill("#url", "https://www.youtube.com/watch?v=9bZkp7q19f0");
    await page.waitForFunction(
      () => document.querySelector("#title").value.length > 0,
      { timeout: 15000 },
    );
    const discovered = await page.inputValue("#title");
    await page.click("#submit");
    await page.waitForFunction(
      () => document.querySelectorAll(".track").length === 4,
    );
    assert((await page.textContent("#tracks")).includes(discovered));
    await page.fill("#url", "https://www.youtube.com/watch?v=9bZkp7q19f0");
    await page.click("#submit");
    assert.equal(await page.locator(".track").count(), 4);
    assert(
      (await page.textContent("#form-message")).includes(
        "Already in the queue",
      ),
    );
    await page.fill("#url", "https://www.youtube.com/watch?v=jNQXAC9IVRw");
    await page.waitForFunction(
      () => document.querySelector("#title").value.length > 0,
      { timeout: 15000 },
    );
    await page.click("#submit");
    await page.waitForFunction(
      () => document.querySelectorAll(".track").length === 5,
    );
    assert(await page.locator("#submit").isDisabled());
    assert.equal(await page.textContent("#remaining"), "0 left");
    results.push({
      test: "metadata fixture discovery, two adds, cap",
      discovered,
      ok: true,
    });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator(".track").count(), 5);
    assert(await page.locator("#submit").isDisabled());
    const download = page.waitForEvent("download");
    await page.click("#export");
    const file = await download;
    assert.equal(file.suggestedFilename(), "devcon-playlist.json");
    results.push({ test: "track persistence and playlist export", ok: true });
    // Deterministic provider API mechanics; deliberately not an assertion of real remote audio.
    await page.addInitScript(() => {
      window.__players = [];
      window.__spotify = [];
      window.YT = {
        PlayerState: { ENDED: 0, PLAYING: 1 },
        Player: function (id, opts) {
          const p = {
            id,
            opts,
            destroy() {
              document.getElementById(id)?.remove();
            },
            playVideo() {},
          };
          window.__players.push(p);
          return p;
        },
      };
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.click("#main-play");
    await page.waitForFunction(() => window.__players.length === 1);
    assert(
      (await page.locator("#player-frame iframe").getAttribute("src")).includes(
        "_3T8KznhThQ",
      ),
    );
    await page.evaluate(() =>
      window.__players[0].opts.events.onStateChange({ data: 0 }),
    );
    await page.waitForFunction(() => window.__players.length === 2);
    assert(
      (await page.locator("#player-frame iframe").getAttribute("src")).includes(
        "BN8M2irJVJA",
      ),
    );
    await page.locator(".play-track").first().click();
    await page.waitForFunction(() => window.__players.length === 3);
    assert.equal(await page.locator("#player-frame iframe").count(), 1);
    await page.evaluate(() =>
      window.__players[0].opts.events.onStateChange({ data: 0 }),
    );
    assert(
      (await page.locator("#player-frame iframe").getAttribute("src")).includes(
        "_3T8KznhThQ",
      ),
    );
    results.push({
      test: "YouTube next, switch cleanup, stale ended-event rejection (API stub)",
      ok: true,
    });
    await page.route("https://open.spotify.com/embed/iframe-api/v1", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: `window.onSpotifyIframeApiReady({createController(el,o,cb){const f=document.createElement('iframe');f.src='https://open.spotify.com/embed/track/'+new URL(o.url).pathname.split('/').pop();el.replaceWith(f);const c={events:{},play(){this.playRequested=true},destroy(){f.remove()},addListener(n,fn){this.events[n]=fn}};window.__spotify.push(c);cb(c);c.events.ready()}});`,
      }),
    );
    await page.locator(".play-track").nth(2).click();
    await page.waitForFunction(() => window.__spotify.length === 1);
    assert(await page.evaluate(() => window.__spotify[0].playRequested));
    await page.evaluate(() => {
      const c = window.__spotify[0];
      c.events.playback_started({ data: {} });
      c.events.playback_update({
        data: {
          duration: 200000,
          position: 200000,
          isPaused: false,
          isBuffering: false,
        },
      });
    });
    await page.waitForFunction(() => window.__players.length === 4);
    assert(
      (await page.locator("#player-frame iframe").getAttribute("src")).includes(
        "9bZkp7q19f0",
      ),
    );
    results.push({
      test: "Spotify Play request and completed playback advances (API stub)",
      ok: true,
    });
    await page.route("https://w.soundcloud.com/player/api.js", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: `window.SC={Widget:Object.assign(function(){const widget={events:{},bind(n,f){this.events[n]=f;if(n==='ready')f()},unbind(n){delete this.events[n]},pause(){},play(){this.playRequested=true}};window.__sc=widget;return widget},{Events:{READY:'ready',FINISH:'finish'}})}`,
      }),
    );
    await page.evaluate(() => {
      tracks.push({
        name: "Fixture",
        title: "SoundCloud fixture",
        artist: "Forss",
        url: "https://soundcloud.com/forss/flickermood",
        createdAt: "fixture",
      });
      render();
    });
    await page.locator(".play-track").last().click();
    await page.waitForFunction(() => window.__sc?.playRequested);
    await page.evaluate(() => window.__sc.events.finish());
    await page.waitForFunction(() => window.__players.length === 5);
    assert(
      (await page.locator("#player-frame iframe").getAttribute("src")).includes(
        "_3T8KznhThQ",
      ),
    );
    results.push({
      test: "SoundCloud Play and finish advances (API stub)",
      ok: true,
    });
    await page.close();
    const migrated = await context.newPage();
    await migrated.addInitScript(() =>
      localStorage.setItem(
        "subcult-devcon-playlist-v2",
        JSON.stringify([
          {
            name: "Old",
            artist: "Ritviz",
            title: "Udd Gaye",
            url: "https://open.spotify.com/track/0sdav1a7jmfGZg1VMnU3Qk",
            createdAt: "old",
          },
        ]),
      ),
    );
    await migrated.goto(base, { waitUntil: "networkidle" });
    assert.equal(await migrated.locator(".track").count(), 1);
    assert.equal(await migrated.textContent("#player-title"), "Udd Gaye");
    assert.equal(
      await migrated.evaluate(() => tracks[0].url),
      "https://open.spotify.com/track/5ZsAhuQ24mWHiduaxJqnhW",
    );
    await migrated.close();
    results.push({ test: "legacy localStorage Ritviz migration", ok: true });
    fs.writeFileSync(
      `${out}/design-verification.json`,
      JSON.stringify(
        { ok: true, base, checkedAt: new Date().toISOString(), results },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ ok: true, checks: results.length, results }, null, 2),
    );
  } catch (e) {
    fs.writeFileSync(
      `${out}/design-verification-failure.json`,
      JSON.stringify({ error: e.stack, results }, null, 2),
    );
    throw e;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})();
