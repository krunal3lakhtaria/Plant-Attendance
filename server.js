const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4174);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "attendance.json");

const sampleOperators = [
  ["303408", "Sample Operator", "F/A", "Production", "Assembly-K2", "14-07-2025", "Level 4", "23-04-2026", "22-07-2026"],
  ["OP1001", "Asha Patel", "Welding", "Assembly", "Line 1"],
  ["OP1002", "Ravi Shah", "Fitting", "Assembly", "Line 1"],
  ["OP1003", "Meena Iyer", "Inspection", "Assembly", "Line 1"],
  ["OP1004", "Imran Khan", "Machine", "Machining", "Line 2"],
  ["OP1005", "Nisha Rao", "CNC", "Machining", "Line 2"],
  ["OP1006", "Vikram Singh", "Maintenance", "Machining", "Line 2"],
  ["OP1007", "Pooja Desai", "Packing", "Dispatch", "Line 3"],
  ["OP1008", "Kiran Mehta", "Forklift", "Dispatch", "Line 3"],
  ["OP1009", "Suresh Kumar", "Quality", "Quality", "Line 4"],
  ["OP1010", "Farah Ansari", "Final Audit", "Quality", "Line 4"],
  ["OP1011", "Deepak Joshi", "Press", "Press Shop", "Line 5"],
  ["OP1012", "Leena Nair", "Die Setting", "Press Shop", "Line 5"]
].map(([code, name, skill, department, line, doj = "", skillLevel = "", issuedDate = "", renewDate = ""]) => ({
  code,
  name,
  skill,
  department,
  line,
  doj,
  skillLevel,
  issuedDate,
  renewDate
}));

const defaultUsers = [
];

function defaultState() {
  return { operators: sampleOperators, attendance: [], users: defaultUsers };
}

function ensureDataFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState(), null, 2));
  }
}

function readState() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      operators: Array.isArray(parsed.operators) ? parsed.operators : sampleOperators,
      attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
      users: Array.isArray(parsed.users) ? parsed.users : defaultUsers
    };
  } catch {
    return defaultState();
  }
}

function writeState(state) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 10_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/state" && req.method === "GET") {
      sendJson(res, 200, readState());
      return;
    }

    if (req.url === "/api/state" && req.method === "POST") {
      const state = JSON.parse(await readBody(req));
      writeState({
        operators: Array.isArray(state.operators) ? state.operators : [],
        attendance: Array.isArray(state.attendance) ? state.attendance : [],
        users: Array.isArray(state.users) ? state.users : defaultUsers
      });
      sendJson(res, 200, { ok: true });
      return;
    }

    const requestPath = decodeURIComponent(req.url.split("?")[0]);
    const safePath = requestPath === "/" ? "/index.html" : requestPath;
    const filePath = path.normalize(path.join(ROOT, safePath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(data);
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Plant Attendance app running at http://${HOST}:${PORT}`);
  console.log(`Shared data file: ${DATA_FILE}`);
});
