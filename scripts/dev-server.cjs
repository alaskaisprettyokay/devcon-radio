const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createChat } = require("./chat-store.cjs");
const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const PAGES = ["index.html", "style.css", "app.js", "mod.html", "mod.js"];
const MAX_BODY = 4096;

function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        // Keep draining so the client can read our 413 instead of a reset.
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge)
        return reject(
          Object.assign(new Error("Payload too large"), { status: 413 }),
        );
      try {
        resolve(
          chunks.length
            ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
            : {},
        );
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function createServer(options = {}) {
  const modToken = options.modToken || process.env.CHAT_MOD_TOKEN || "";
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === "1";
  const allowOrigin =
    options.allowOrigin ?? process.env.CHAT_ALLOW_ORIGIN ?? "";
  const chat =
    options.chat ||
    createChat({
      dataDir: options.dataDir ?? process.env.CHAT_DATA_DIR ?? "",
      blocklistFile: options.blocklistFile ?? process.env.CHAT_BLOCKLIST ?? "",
    });

  const ipOf = (req) => {
    if (trustProxy) {
      const fwd = String(req.headers["x-forwarded-for"] || "")
        .split(",")[0]
        .trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress || "?";
  };

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(allowOrigin
        ? {
            "Access-Control-Allow-Origin": allowOrigin,
            "Access-Control-Allow-Headers": "content-type, x-mod-token",
            Vary: "Origin",
          }
        : {}),
      ...headers,
    });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  async function api(req, res, url) {
    const route = url.pathname;
    if (req.method === "OPTIONS") return send(res, 204);
    const isMod = route.startsWith("/api/mod/");
    if (isMod) {
      const given = req.headers["x-mod-token"] || "";
      if (!modToken || !safeEqual(given, modToken))
        return send(res, 401, { error: "Moderator token required." });
    }
    const actor = isMod ? "mod" : "";
    if (route === "/api/chat" && req.method === "GET") {
      const since = url.searchParams.get("since");
      return send(
        res,
        200,
        chat.list({
          since: since === null ? undefined : Number(since),
          clientId: url.searchParams.get("client") || "",
        }),
      );
    }
    if (route === "/api/mod/queue" && req.method === "GET")
      return send(res, 200, chat.mod.queue());
    if (req.method !== "POST")
      return send(
        res,
        405,
        { error: "Method not allowed." },
        { Allow: "GET, POST" },
      );
    const body = await readJson(req);
    if (route === "/api/chat") {
      const result = chat.post({
        name: body.name,
        text: body.text,
        clientId: body.clientId,
        ip: ipOf(req),
      });
      const status = result.ok
        ? 201
        : result.code === "bad_request"
          ? 400
          : result.code === "rate" || result.code === "slow"
            ? 429
            : 403;
      return send(
        res,
        status,
        result,
        result.retryAfterMs
          ? { "Retry-After": String(Math.ceil(result.retryAfterMs / 1000)) }
          : {},
      );
    }
    if (route === "/api/chat/report")
      return send(
        res,
        200,
        chat.report({ id: Number(body.id), reporterId: body.clientId }),
      );
    if (route === "/api/mod/delete")
      return send(res, 200, chat.mod.remove(body.id, actor));
    if (route === "/api/mod/approve")
      return send(res, 200, chat.mod.approve(body.id, actor));
    if (route === "/api/mod/mute")
      return send(res, 200, chat.mod.mute(body.clientId, body.minutes, actor));
    if (route === "/api/mod/unmute")
      return send(res, 200, chat.mod.unmute(body.clientId, actor));
    if (route === "/api/mod/ban")
      return send(res, 200, chat.mod.ban(body.clientId, actor));
    if (route === "/api/mod/settings")
      return send(res, 200, chat.mod.settings(body, actor));
    return send(res, 404, { error: "Not found." });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname.startsWith("/api/")) return await api(req, res, url);
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      const relative =
        pathname === "/"
          ? "index.html"
          : pathname === "/mod"
            ? "mod.html"
            : pathname.slice(1);
      const asset = /^assets\/[a-zA-Z0-9_-]+\.(webp|woff2|txt|svg)$/.test(
        relative,
      );
      if (!asset && !PAGES.includes(relative)) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const body = await fs.readFile(path.join(ROOT, relative));
      res.writeHead(200, {
        "Content-Type":
          MIME[path.extname(relative)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        ...(relative === "mod.html"
          ? { "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" }
          : {}),
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch (error) {
      if (res.headersSent) return res.end();
      const status = error.status || (error.code === "ENOENT" ? 404 : 500);
      if (req.url.startsWith("/api/"))
        return send(res, status, { error: error.message });
      res.writeHead(status === 500 ? 500 : 404);
      res.end(status === 500 ? "Server error" : "Not found");
    }
  });
  server.chat = chat;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  const host = process.env.HOST || "127.0.0.1";
  let modToken = process.env.CHAT_MOD_TOKEN || "";
  let generated = false;
  if (!modToken) {
    modToken = crypto.randomBytes(18).toString("base64url");
    generated = true;
  }
  const server = createServer({ modToken });
  server.listen(port, host, () => {
    console.log(`Devcon Radio: http://${host}:${port}`);
    console.log(`Moderator desk: http://${host}:${port}/mod`);
    console.log(
      generated
        ? `Moderator token (this run only; set CHAT_MOD_TOKEN to keep one): ${modToken}`
        : "Moderator token: taken from CHAT_MOD_TOKEN",
    );
    if (!process.env.CHAT_DATA_DIR)
      console.log(
        "Chat is held in memory. Set CHAT_DATA_DIR to keep it across restarts.",
      );
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.chat.flush();
      server.close(() => process.exit(0));
    });
}
module.exports = { createServer };
