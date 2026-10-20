"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createChat } = require("../scripts/chat-store.cjs");
const { createServer } = require("../scripts/dev-server.cjs");

function clock(start = 1_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => (t += ms);
  return now;
}
const msg = (text, id = "a", extra = {}) => ({
  name: "Maya",
  text,
  clientId: id,
  ip: "1.1.1.1",
  ...extra,
});

test("posts are cleaned, shown, and listed", () => {
  const chat = createChat({ now: clock() });
  const r = chat.post(msg("  hello\u202e   Mumbai\u0000 "));
  assert.equal(r.ok, true);
  assert.equal(r.status, "visible");
  const list = chat.list({ clientId: "b" });
  assert.deepEqual(
    list.messages.map((m) => m.text),
    ["hello Mumbai"],
  );
  assert.equal(list.messages[0].clientId, undefined, "client ids never leak");
});

test("empty name or text is rejected", () => {
  const chat = createChat({ now: clock() });
  assert.equal(chat.post(msg("   ")).code, "bad_request");
  assert.equal(chat.post({ ...msg("hi"), name: " " }).code, "bad_request");
  assert.equal(chat.post({ ...msg("hi"), clientId: "" }).code, "bad_request");
});

test("flooding is rate limited per client and recovers", () => {
  const now = clock();
  const chat = createChat({ now });
  for (let i = 0; i < 5; i++) assert.equal(chat.post(msg(`m${i}`)).ok, true);
  const blocked = chat.post(msg("m5"));
  assert.equal(blocked.code, "rate");
  assert.ok(blocked.retryAfterMs > 0);
  now.advance(16000);
  assert.equal(chat.post(msg("again")).ok, true);
});

test("duplicates and character spam are refused", () => {
  const chat = createChat({ now: clock() });
  assert.equal(chat.post(msg("Great set")).ok, true);
  assert.equal(chat.post(msg("great  SET!")).code, "duplicate");
  assert.equal(chat.post(msg("aaaaaaaaaaaaaaaa")).code, "spam");
});

test("links and invites are removed automatically and the rest is posted", () => {
  const chat = createChat({ now: clock() });
  const cases = [
    ["check https://evil.example/claim now", "check [link removed] now"],
    ["join t.me/scam today", "join [link removed] today"],
    ["visit mysite.xyz for more", "visit [link removed] for more"],
  ];
  cases.forEach(([input, expected], i) => {
    const r = chat.post(msg(input, `c${i}`));
    assert.equal(r.ok, true, input);
    assert.equal(r.message.text, expected);
    assert.equal(r.linkRemoved, true);
  });
  assert.equal(
    chat.post(msg("www.phish.com discord.gg/abc", "only")).code,
    "blocked",
    "a message that is only links is refused",
  );
  const texts = chat.list({ clientId: "z" }).messages.map((m) => m.text);
  assert.ok(texts.every((t) => !/https?:|\.xyz|t\.me/.test(t)));
  assert.equal(chat.mod.queue().held.length, 0, "nothing waits for a person");
});

test("wallet-scam phrases are refused outright", () => {
  const chat = createChat({ now: clock() });
  for (const [i, text] of [
    "send your seed phrase to verify",
    "free ETH airdrop",
    "DM me for the giveaway",
  ].entries()) {
    assert.equal(chat.post(msg(text, `s${i}`)).code, "blocked", text);
  }
  assert.equal(chat.list({ clientId: "z" }).messages.length, 0);
});

test("repeated refused messages mute the sender automatically, longer each time", () => {
  const now = clock();
  const chat = createChat({ now, clientLimit: { count: 100, windowMs: 1000 } });
  const bad = (n) => chat.post(msg(`free ETH airdrop ${n}`, "spammer"));
  assert.equal(bad(1).code, "blocked");
  assert.equal(bad(2).code, "blocked");
  assert.match(bad(3).error, /paused for you for 2 minutes/);
  assert.equal(chat.post(msg("sorry", "spammer")).code, "muted");
  now.advance(2 * 60000 + 1);
  assert.equal(chat.post(msg("sorry about that", "spammer")).ok, true);
  bad(4);
  bad(5);
  assert.match(bad(6).error, /10 minutes/);
  assert.equal(
    chat.post(msg("hello", "friend")).ok,
    true,
    "others are unaffected",
  );
});

test("blocklisted phrases are refused, including spaced-out evasions", () => {
  const chat = createChat({ now: clock() });
  assert.equal(chat.post(msg("kill yourself", "a")).code, "blocked");
  assert.equal(chat.post(msg("k i l l  y.o.u.r.s.e.l.f", "b")).code, "blocked");
  assert.equal(chat.post(msg("this is a killer set", "c")).ok, true);
  assert.equal(
    chat.post(msg("skys the limit", "d")).ok,
    true,
    "short terms match whole words only",
  );
});

test("moderators can delete, and deleted messages disappear for everyone", () => {
  const chat = createChat({ now: clock() });
  const { message } = chat.post(msg("rude", "a"));
  assert.equal(chat.mod.remove(message.id, "mod").ok, true);
  assert.equal(chat.list({ clientId: "a" }).messages.length, 0);
  assert.equal(chat.mod.remove(9999, "mod").ok, false);
});

test("mute blocks posting until it expires; unmute lifts it", () => {
  const now = clock();
  const chat = createChat({ now });
  chat.mod.mute("a", 5, "mod");
  assert.equal(chat.post(msg("hi")).code, "muted");
  assert.ok(chat.list({ clientId: "a" }).viewer.mutedUntil > now());
  now.advance(5 * 60000 + 1);
  assert.equal(chat.post(msg("hi")).ok, true);
  chat.mod.mute("a", 5, "mod");
  chat.mod.unmute("a", "mod");
  assert.equal(chat.post(msg("hello again")).ok, true);
});

test("ban removes existing messages and blocks new ones", () => {
  const chat = createChat({ now: clock() });
  chat.post(msg("one", "bad"));
  chat.post(msg("two", "good", { name: "Dev" }));
  chat.mod.ban("bad", "mod");
  assert.deepEqual(
    chat.list({ clientId: "x" }).messages.map((m) => m.text),
    ["two"],
  );
  assert.equal(chat.post(msg("back", "bad")).code, "banned");
  assert.equal(chat.list({ clientId: "bad" }).viewer.banned, true);
});

test("lock pauses everyone but moderators", () => {
  const chat = createChat({ now: clock() });
  chat.mod.settings({ locked: true }, "mod");
  assert.equal(chat.post(msg("hi")).code, "locked");
  assert.equal(chat.post(msg("announcement", "m", { mod: true })).ok, true);
  chat.mod.settings({ locked: false }, "mod");
  assert.equal(chat.post(msg("hi")).ok, true);
});

test("slow mode spaces out a client's messages", () => {
  const now = clock();
  const chat = createChat({ now });
  chat.mod.settings({ slowSeconds: 10 }, "mod");
  assert.equal(chat.post(msg("first")).ok, true);
  now.advance(3000);
  const r = chat.post(msg("second"));
  assert.equal(r.code, "slow");
  assert.ok(r.retryAfterMs <= 7000);
  now.advance(8000);
  assert.equal(chat.post(msg("third")).ok, true);
});

test("enough reports from different people hold a message for review", () => {
  const chat = createChat({ now: clock() });
  const { message } = chat.post(msg("hmm", "author"));
  assert.equal(
    chat.report({ id: message.id, reporterId: "author" }).ok,
    false,
    "no self reports",
  );
  chat.report({ id: message.id, reporterId: "r1" });
  chat.report({ id: message.id, reporterId: "r1" });
  chat.report({ id: message.id, reporterId: "r2" });
  assert.equal(
    chat.list({ clientId: "z" }).messages.length,
    1,
    "two reporters is not enough",
  );
  chat.report({ id: message.id, reporterId: "r3" });
  assert.equal(chat.list({ clientId: "z" }).messages.length, 0);
  assert.deepEqual(chat.mod.queue().held[0].reasons, ["reported"]);
  assert.equal(
    chat.list({ clientId: "author" }).messages.length,
    0,
    "hidden for the author too",
  );
});

test("polling returns no payload when nothing changed", () => {
  const chat = createChat({ now: clock() });
  chat.post(msg("hello"));
  const first = chat.list({ clientId: "z" });
  const again = chat.list({ since: first.rev, clientId: "z" });
  assert.equal(again.changed, false);
  assert.equal(again.messages, undefined);
});

test("state survives a restart and moderation actions are logged", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "devcon-chat-"));
  const one = createChat({ now: clock(), dataDir: dir });
  one.post(msg("persist me"));
  one.mod.ban("evil", "mod");
  one.flush();
  const two = createChat({ now: clock(), dataDir: dir });
  assert.equal(two.list({ clientId: "z" }).messages[0].text, "persist me");
  assert.equal(two.post(msg("x", "evil")).code, "banned");
  const log = fs.readFileSync(path.join(dir, "mod-log.jsonl"), "utf8");
  assert.match(log, /"action":"ban"/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// HTTP layer ---------------------------------------------------------------

async function withServer(fn, options = {}) {
  const server = createServer({ modToken: "secret-token", ...options });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base, server);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const post = (url, body, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

test("http: post then read back; moderator endpoints need the token", async () => {
  await withServer(async (base) => {
    const r = await post(`${base}/api/chat`, {
      name: "Dev",
      text: "hello",
      clientId: "c1",
    });
    assert.equal(r.status, 201);
    const list = await (await fetch(`${base}/api/chat?client=c2`)).json();
    assert.equal(list.messages[0].text, "hello");

    const denied = await fetch(`${base}/api/mod/queue`);
    assert.equal(denied.status, 401);
    const wrong = await fetch(`${base}/api/mod/queue`, {
      headers: { "x-mod-token": "nope" },
    });
    assert.equal(wrong.status, 401);
    const ok = await fetch(`${base}/api/mod/queue`, {
      headers: { "x-mod-token": "secret-token" },
    });
    assert.equal(ok.status, 200);

    const del = await post(
      `${base}/api/mod/delete`,
      { id: list.messages[0].id },
      { "x-mod-token": "secret-token" },
    );
    assert.equal((await del.json()).ok, true);
    const after = await (await fetch(`${base}/api/chat?client=c2`)).json();
    assert.equal(after.messages.length, 0);
  });
});

test("http: moderator endpoints are closed when no token is configured", async () => {
  await withServer(
    async (base) => {
      const r = await fetch(`${base}/api/mod/queue`, {
        headers: { "x-mod-token": "" },
      });
      assert.equal(r.status, 401);
    },
    { modToken: "" },
  );
});

test("http: rate limiting answers 429 with Retry-After", async () => {
  await withServer(async (base) => {
    let last;
    for (let i = 0; i < 6; i++)
      last = await post(`${base}/api/chat`, {
        name: "A",
        text: `m${i}`,
        clientId: "flood",
      });
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers.get("retry-after")) >= 1);
  });
});

test("http: oversized or malformed bodies are rejected", async () => {
  await withServer(async (base) => {
    const big = await post(`${base}/api/chat`, {
      name: "A",
      text: "x".repeat(9000),
      clientId: "c",
    });
    assert.equal(big.status, 413);
    const bad = await fetch(`${base}/api/chat`, {
      method: "POST",
      body: "{nope",
      headers: { "content-type": "application/json" },
    });
    assert.equal(bad.status, 400);
  });
});

test("http: the moderator desk is not indexable and static allowlist still holds", async () => {
  await withServer(async (base) => {
    assert.equal(
      (await fetch(`${base}/mod`)).headers.get("x-robots-tag"),
      "noindex",
    );
    assert.equal((await fetch(`${base}/scripts/chat-store.cjs`)).status, 404);
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
  });
});
