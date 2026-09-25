/* 로컬 프리뷰용 정적 서버: node tools/serve.cjs [포트] (기본 8931) */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const T = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };
const port = parseInt(process.argv[2] || "8931", 10) || 8931;
http.createServer((q, s) => {
  let p = decodeURIComponent(new URL(q.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT)) { s.writeHead(403); s.end("forbidden"); return; }
  fs.readFile(f, (e, d) => {
    if (e) { s.writeHead(404); s.end("not found"); }
    else { s.writeHead(200, { "Content-Type": T[path.extname(f)] || "text/plain" }); s.end(d); }
  });
}).listen(port, () => console.log("serve " + ROOT + " at http://127.0.0.1:" + port + "/"));
