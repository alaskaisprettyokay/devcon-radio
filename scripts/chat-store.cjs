"use strict";
// Shared chat state and moderation rules. No dependencies, no network calls.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// Starter list only. Organizers should extend it through CHAT_BLOCKLIST.
const DEFAULT_BLOCKLIST = ["kill yourself", "kys"];
// Fully automatic rules. Links and invites are removed from the message (the
// rest is posted); wallet-scam phrases are refused. Nothing waits for a person.
const LINK_RE =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|xyz|org|net|app|co|me|link|gg|fm|ly|to|eth|dev|ai|music|radio)\b(?:\/\S*)?/gi;
const SCAM_RE =
  /\b(?:seed|recovery|secret)\s+phrase\b|\bprivate\s+key\b|\bwallet\s*connect\b|\bairdrop\b|\bgiveaway\b|\bfree\s+(?:eth|usdc|tokens?)\b|\bdm\s+me\b/i;
const LINK_MARK = "[link removed]";

const DEFAULTS = {
  maxMessages: 500,
  visibleCount: 100,
  maxText: 500,
  maxName: 30,
  clientLimit: { count: 5, windowMs: 15000 },
  // Many attendees can share one venue IP, so this only stops floods.
  ipLimit: { count: 60, windowMs: 60000 },
  duplicateWindowMs: 30000,
  reportThreshold: 3,
  // Automatic escalation: this many refused messages inside the window mutes
  // the sender, for longer each time.
  strikeLimit: 3,
  strikeWindowMs: 10 * 60000,
  muteLadderMinutes: [2, 10, 30, 60],
  persistDelayMs: 400,
};

function clean(value, max) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function loadBlocklist(file) {
  const terms = [...DEFAULT_BLOCKLIST];
  if (file) {
    try {
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const term = line.trim();
        if (term && !term.startsWith("#")) terms.push(term);
      }
    } catch {
      /* A missing file means the starter list only. */
    }
  }
  return terms;
}

function createChat(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const now = cfg.now || Date.now;
  const blocklist = loadBlocklist(cfg.blocklistFile).map((t) => ({
    raw: t.toLowerCase(),
    squashed: squash(t),
  }));
  const dataFile = cfg.dataDir ? path.join(cfg.dataDir, "chat.json") : null;
  const logFile = cfg.dataDir ? path.join(cfg.dataDir, "mod-log.jsonl") : null;

  let state = {
    nextId: 1,
    rev: 1,
    settings: { locked: false, slowSeconds: 0 },
    messages: [],
    mutes: {},
    bans: {},
  };
  if (dataFile) {
    try {
      const saved = JSON.parse(fs.readFileSync(dataFile, "utf8"));
      state = {
        ...state,
        ...saved,
        settings: { ...state.settings, ...saved.settings },
      };
    } catch {
      /* First run or unreadable file: start empty. */
    }
  }

  const buckets = new Map();
  const strikes = new Map();
  const lastSent = new Map();
  let timer = null;

  function writeNow() {
    try {
      fs.mkdirSync(cfg.dataDir, { recursive: true });
      const tmp = `${dataFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, dataFile);
    } catch {
      /* Chat keeps working from memory if the disk is unavailable. */
    }
  }

  function persist() {
    if (!dataFile || timer) return;
    timer = setTimeout(() => {
      timer = null;
      writeNow();
    }, cfg.persistDelayMs);
    timer.unref?.();
  }

  function flush() {
    if (!dataFile) return;
    if (timer) clearTimeout(timer);
    timer = null;
    writeNow();
  }

  function touch() {
    state.rev += 1;
    persist();
  }

  function audit(actor, action, detail) {
    if (!logFile) return;
    try {
      fs.mkdirSync(cfg.dataDir, { recursive: true });
      fs.appendFileSync(
        logFile,
        JSON.stringify({
          at: new Date(now()).toISOString(),
          actor,
          action,
          ...detail,
        }) + "\n",
      );
    } catch {
      /* Auditing must never take chat down. */
    }
  }

  function limited(key, limit) {
    const t = now();
    const list = (buckets.get(key) || []).filter((x) => t - x < limit.windowMs);
    if (list.length >= limit.count) {
      buckets.set(key, list);
      return Math.max(1, limit.windowMs - (t - list[0]));
    }
    list.push(t);
    buckets.set(key, list);
    return 0;
  }

  function viewerState(clientId) {
    const until = state.mutes[clientId] || 0;
    return {
      banned: Boolean(state.bans[clientId]),
      mutedUntil: until > now() ? until : 0,
    };
  }

  function strike(id, base) {
    const t = now();
    const rec = strikes.get(id) || { hits: [], mutes: 0 };
    rec.hits = rec.hits.filter((x) => t - x < cfg.strikeWindowMs);
    rec.hits.push(t);
    if (rec.hits.length < cfg.strikeLimit) {
      strikes.set(id, rec);
      return base;
    }
    const minutes =
      cfg.muteLadderMinutes[
        Math.min(rec.mutes, cfg.muteLadderMinutes.length - 1)
      ];
    rec.mutes += 1;
    rec.hits = [];
    strikes.set(id, rec);
    state.mutes[id] = t + minutes * 60000;
    touch();
    audit("auto", "mute", {
      clientId: id,
      minutes,
      reason: "repeated refused messages",
    });
    return {
      ...base,
      error: `${base.error} Chat is paused for you for ${minutes} minute${minutes > 1 ? "s" : ""}.`,
    };
  }

  function post({ name, text, clientId, ip, mod = false }) {
    const id = clean(clientId, 64);
    if (!id) return fail("bad_request", "Missing client id.");
    const who = clean(name, cfg.maxName);
    const body = clean(text, cfg.maxText);
    if (!who) return fail("bad_request", "Add a display name.");
    if (!body) return fail("bad_request", "Write a message first.");
    if (!mod) {
      if (state.bans[id])
        return fail("banned", "You can no longer post in this room.");
      const until = state.mutes[id] || 0;
      if (until > now())
        return fail(
          "muted",
          "Your messages are paused for now.",
          until - now(),
        );
      if (state.settings.locked)
        return fail("locked", "Chat is paused by the organizers right now.");
      const ipWait = limited(`ip:${ip || "?"}`, cfg.ipLimit);
      if (ipWait)
        return fail(
          "rate",
          "Too many messages from this network. Try again shortly.",
          ipWait,
        );
      const wait = limited(`c:${id}`, cfg.clientLimit);
      if (wait) return fail("rate", "Slow down a little.", wait);
      const slow = state.settings.slowSeconds * 1000;
      const last = lastSent.get(id) || 0;
      if (slow && now() - last < slow)
        return fail("slow", "Slow mode is on.", slow - (now() - last));
      const key = squash(body);
      const dup = state.messages.some(
        (m) =>
          m.clientId === id &&
          squash(m.text) === key &&
          now() - m.ts < cfg.duplicateWindowMs,
      );
      if (dup) return fail("duplicate", "You already sent that.");
      if (/(.)\1{9,}/.test(body))
        return strike(id, fail("spam", "That looks like spam."));
      const lower = body.toLowerCase();
      const hit = blocklist.find((t) =>
        t.raw.length <= 4
          ? new RegExp(
              `\\b${t.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
            ).test(lower)
          : squash(body).includes(t.squashed),
      );
      if (hit)
        return strike(
          id,
          fail("blocked", "That message can't be posted here."),
        );
      if (SCAM_RE.test(body))
        return strike(
          id,
          fail(
            "blocked",
            "That looks like a scam message, so it wasn't posted.",
          ),
        );
    }
    let shown = body;
    const reasons = [];
    if (!mod) {
      shown = body
        .replace(LINK_RE, LINK_MARK)
        .replace(/(\[link removed\]\s*){2,}/g, LINK_MARK + " ")
        .trim();
      if (shown !== body) {
        reasons.push("link");
        if (!/[\p{L}\p{N}]/u.test(shown.split(LINK_MARK).join("")))
          return fail("blocked", "Links aren't allowed in chat.");
      }
    }
    const message = {
      id: state.nextId++,
      name: who,
      text: shown,
      ts: now(),
      status: "visible",
      reasons,
      clientId: id,
      mod: Boolean(mod),
      reports: [],
    };
    state.messages.push(message);
    if (state.messages.length > cfg.maxMessages)
      state.messages.splice(0, state.messages.length - cfg.maxMessages);
    lastSent.set(id, now());
    touch();
    return {
      ok: true,
      status: message.status,
      linkRemoved: reasons.includes("link") || undefined,
      message: view(message),
    };
  }

  function fail(code, error, retryAfterMs = 0) {
    return { ok: false, code, error, retryAfterMs: Math.ceil(retryAfterMs) };
  }

  function view(m, own = false) {
    return {
      id: m.id,
      name: m.name,
      text: m.text,
      ts: m.ts,
      mod: m.mod || undefined,
      held: m.status === "held" ? true : undefined,
      own: own || undefined,
    };
  }

  function list({ since, clientId } = {}) {
    const id = clean(clientId, 64);
    const viewer = viewerState(id);
    if (since === state.rev)
      return {
        rev: state.rev,
        changed: false,
        settings: state.settings,
        viewer,
      };
    const shown = state.messages
      .filter((m) => m.status === "visible")
      .slice(-cfg.visibleCount)
      .map((m) => view(m, m.clientId === id));
    return {
      rev: state.rev,
      changed: true,
      messages: shown,
      settings: state.settings,
      viewer,
    };
  }

  function report({ id, reporterId }) {
    const m = state.messages.find((x) => x.id === id);
    const reporter = clean(reporterId, 64);
    if (!m || m.status !== "visible" || !reporter || m.clientId === reporter)
      return { ok: false };
    if (!m.reports.includes(reporter)) m.reports.push(reporter);
    if (m.reports.length >= cfg.reportThreshold) {
      m.status = "held";
      m.reasons = [...new Set([...m.reasons, "reported"])];
      strike(m.clientId, { ok: false });
    }
    touch();
    return { ok: true };
  }

  const find = (id) => state.messages.find((m) => m.id === Number(id));

  const mod = {
    queue() {
      const t = now();
      return {
        rev: state.rev,
        settings: state.settings,
        held: state.messages.filter((m) => m.status === "held").map(modView),
        recent: state.messages
          .filter((m) => m.status === "visible")
          .slice(-60)
          .reverse()
          .map(modView),
        mutes: Object.entries(state.mutes)
          .filter(([, until]) => until > t)
          .map(([clientId, until]) => ({ clientId, until })),
        bans: Object.keys(state.bans),
      };
    },
    remove(id, actor) {
      const m = find(id);
      if (!m) return { ok: false };
      m.status = "deleted";
      touch();
      audit(actor, "delete", { id: m.id, clientId: m.clientId, text: m.text });
      return { ok: true };
    },
    approve(id, actor) {
      const m = find(id);
      if (!m || m.status !== "held") return { ok: false };
      m.status = "visible";
      m.reports = [];
      touch();
      audit(actor, "approve", { id: m.id });
      return { ok: true };
    },
    mute(clientId, minutes, actor) {
      const id = clean(clientId, 64);
      if (!id) return { ok: false };
      state.mutes[id] =
        now() + Math.min(Math.max(Number(minutes) || 10, 1), 1440) * 60000;
      touch();
      audit(actor, "mute", { clientId: id, minutes });
      return { ok: true };
    },
    unmute(clientId, actor) {
      const id = clean(clientId, 64);
      delete state.mutes[id];
      delete state.bans[id];
      touch();
      audit(actor, "unmute", { clientId: id });
      return { ok: true };
    },
    ban(clientId, actor) {
      const id = clean(clientId, 64);
      if (!id) return { ok: false };
      state.bans[id] = now();
      for (const m of state.messages)
        if (m.clientId === id && m.status !== "deleted") m.status = "deleted";
      touch();
      audit(actor, "ban", { clientId: id });
      return { ok: true };
    },
    settings(next, actor) {
      if (typeof next.locked === "boolean") state.settings.locked = next.locked;
      if (next.slowSeconds !== undefined)
        state.settings.slowSeconds = Math.min(
          Math.max(Number(next.slowSeconds) || 0, 0),
          300,
        );
      touch();
      audit(actor, "settings", { ...state.settings });
      return { ok: true, settings: state.settings };
    },
  };

  function modView(m) {
    return {
      ...view(m),
      clientId: m.clientId,
      reasons: m.reasons,
      reports: m.reports.length,
    };
  }

  return { post, list, report, mod, flush, _state: () => state };
}

module.exports = { createChat, clean, DEFAULTS };
