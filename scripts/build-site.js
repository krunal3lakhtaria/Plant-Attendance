const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");
const serverDir = path.join(dist, "server");
const openaiDir = path.join(dist, ".openai");

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(serverDir, { recursive: true });
fs.mkdirSync(openaiDir, { recursive: true });

const files = ["index.html", "styles.css", "app.js", "operator-master-template.csv"];
for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}
fs.copyFileSync(path.join(root, ".openai", "hosting.json"), path.join(openaiDir, "hosting.json"));

const routes = Object.fromEntries(files.map((file) => [
  file === "index.html" ? "/" : `/${file}`,
  {
    body: fs.readFileSync(path.join(root, file), "utf8"),
    type: contentType(file)
  }
]));
routes["/index.html"] = routes["/"];

const worker = [
  `const routes = ${JSON.stringify(routes)};`,
  ``,
  `export default {`,
  `  async fetch(request) {`,
  `    const url = new URL(request.url);`,
  `    if (url.pathname === "/api/state" && request.method === "GET") {`,
  `      return json({ operators: [], attendance: [], users: [] });`,
  `    }`,
  `    if (url.pathname === "/api/state" && request.method === "POST") {`,
  `      return json({ ok: true });`,
  `    }`,
  `    const route = routes[url.pathname] || routes["/"];`,
  `    return new Response(route.body, { headers: { "Content-Type": route.type } });`,
  `  }`,
  `};`,
  ``,
  `function json(value) {`,
  `  return new Response(JSON.stringify(value), {`,
  `    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }`,
  `  });`,
  `}`
].join("\n");

fs.writeFileSync(path.join(serverDir, "index.js"), worker);

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (file.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}
