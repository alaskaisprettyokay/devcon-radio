const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
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

function createServer() {
  return http.createServer(async (req, res) => {
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const asset = /^assets\/[a-zA-Z0-9_-]+\.(webp|woff2|txt|svg)$/.test(
        relative,
      );
      if (!asset && !["index.html", "style.css", "app.js"].includes(relative)) {
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
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  const server = createServer();
  server.listen(port, "127.0.0.1", () =>
    console.log(`Devcon Radio: http://127.0.0.1:${port}`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => server.close(() => process.exit(0)));
}
module.exports = { createServer };
