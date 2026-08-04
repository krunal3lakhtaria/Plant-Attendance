const STORAGE_KEY = "plant-attendance-v2";
const SESSION_KEY = "plant-attendance-current-user";
const SYNC_PENDING_KEY = "plant-attendance-sync-pending";
const PRODUCTION_ORIGIN = "https://backend-krunal3lakhtaria-3113s-projects.vercel.app";
const API_BASE = location.protocol === "file:" ? PRODUCTION_ORIGIN : "";

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

let state = loadState();
let currentUser = loadCurrentUser();
let stream = null;
let detector = null;
let scanning = false;
let serverBacked = false;
let serverLoaded = false;
let pendingSync = loadPendingSync();
let saveVersion = 0;
let syncInFlight = false;
let lastScanValue = "";
let lastScanAt = 0;

const $ = (id) => document.getElementById(id);
const today = localDate();

$("attendanceDate").value = today;
$("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric"
});

function localDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function normalizeState(parsed = {}) {
  return {
    operators: Array.isArray(parsed.operators) ? parsed.operators : sampleOperators,
    attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
    users: Array.isArray(parsed.users) ? parsed.users : defaultUsers,
    deletedAttendanceIds: Array.isArray(parsed.deletedAttendanceIds) ? parsed.deletedAttendanceIds : [],
    deletedUserIds: Array.isArray(parsed.deletedUserIds) ? parsed.deletedUserIds : [],
    deletedOperatorIds: Array.isArray(parsed.deletedOperatorIds) ? parsed.deletedOperatorIds : []
  };
}

function loadState() {
  try {
    return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
  } catch {
    return normalizeState();
  }
}

function loadPendingSync() {
  try {
    return localStorage.getItem(SYNC_PENDING_KEY) === "1";
  } catch {
    return false;
  }
}

function setPendingSync(value) {
  pendingSync = value;
  try {
    if (value) {
      localStorage.setItem(SYNC_PENDING_KEY, "1");
    } else {
      localStorage.removeItem(SYNC_PENDING_KEY);
    }
  } catch {
    pendingSync = true;
  }
}

function loadCurrentUser() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function writeLocalState(nextState = state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
}

function saveState() {
  saveVersion += 1;
  writeLocalState();
  setPendingSync(true);
  syncStateToServer();
}

async function syncStateToServer() {
  if (!serverBacked || syncInFlight) return;
  syncInFlight = true;
  const version = saveVersion;
  const body = JSON.stringify(state);

  try {
    const response = await fetch(apiUrl("/api/state"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body
    });
    if (!response.ok) throw new Error("Sync failed");
    if (version === saveVersion) setPendingSync(false);
  } catch {
    serverBacked = false;
    showToast("Server sync paused. Data is still saved in this browser.");
  } finally {
    syncInFlight = false;
    if (serverBacked && pendingSync && version !== saveVersion) syncStateToServer();
  }
}

async function loadServerState() {
  try {
    const response = await fetch(apiUrl("/api/state"), { cache: "no-store" });
    if (!response.ok) return;
    const serverState = normalizeState(await response.json());
    serverBacked = true;
    state = pendingSync ? mergeState(serverState, state) : serverState;
    writeLocalState();
    reconcileCurrentUser();
    if (pendingSync) syncStateToServer();
    applyLoginState();
    renderAll();
  } catch {
    serverBacked = false;
  } finally {
    serverLoaded = true;
    applyLoginState();
  }
}

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function reconcileCurrentUser() {
  if (!currentUser) return;
  const freshUser = state.users.find((user) => user.id === currentUser.id);
  if (!freshUser) {
    currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  currentUser = freshUser;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(currentUser));
}

function mergeState(existing, incoming) {
  const deletedAttendanceIds = new Set([
    ...existing.deletedAttendanceIds,
    ...incoming.deletedAttendanceIds
  ]);
  const deletedUserIds = new Set([
    ...existing.deletedUserIds,
    ...incoming.deletedUserIds
  ]);
  const deletedOperatorIds = new Set([
    ...existing.deletedOperatorIds,
    ...incoming.deletedOperatorIds
  ].map((id) => String(id).toLowerCase()));

  incoming.operators.forEach((operator) => {
    if (operator.code) deletedOperatorIds.delete(String(operator.code).toLowerCase());
  });

  return {
    operators: upsertBy(existing.operators, incoming.operators, (item) => item.code)
      .filter((operator) => !deletedOperatorIds.has(String(operator.code).toLowerCase())),
    users: upsertBy(existing.users, incoming.users, (item) => item.id)
      .filter((user) => !deletedUserIds.has(user.id) || user.id === "admin"),
    attendance: upsertBy(existing.attendance, incoming.attendance, (item) => item.id)
      .filter((record) => !deletedAttendanceIds.has(record.id)),
    deletedAttendanceIds: [...deletedAttendanceIds],
    deletedUserIds: [...deletedUserIds],
    deletedOperatorIds: [...deletedOperatorIds]
  };
}

function upsertBy(existing, incoming, keyFn) {
  const map = new Map();
  for (const item of existing) {
    const key = keyFn(item);
    if (key) map.set(String(key).toLowerCase(), item);
  }
  for (const item of incoming) {
    const key = keyFn(item);
    if (key) map.set(String(key).toLowerCase(), { ...map.get(String(key).toLowerCase()), ...item });
  }
  return [...map.values()];
}

function groupKey(record) {
  return [record.date, record.department, record.line, record.shift].join("::");
}

function userCan(view) {
  if (!currentUser) return false;
  if (currentUser.role === "admin") return true;
  return view === "supervisor" || view === "blacklist";
}

function selectedContext() {
  if (currentUser?.role === "supervisor") {
    return {
      date: $("attendanceDate").value || today,
      department: currentUser.department,
      line: currentUser.line,
      shift: $("shiftSelect").value,
      supervisor: currentUser.name,
      leaderId: currentUser.id
    };
  }

  return {
    date: $("attendanceDate").value || today,
    department: $("departmentSelect").value,
    line: $("lineSelect").value,
    shift: $("shiftSelect").value,
    supervisor: $("supervisorName").value.trim() || currentUser?.name || "Supervisor",
    leaderId: currentUser?.id || "unknown"
  };
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2400);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function fillSelect(select, values) {
  const previous = select.value;
  select.innerHTML = "";
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if (values.includes(previous)) select.value = previous;
}

function refreshFilters() {
  const departments = currentUser?.role === "supervisor"
    ? [currentUser.department]
    : unique(state.operators.map((op) => op.department));
  fillSelect($("departmentSelect"), departments);
  refreshLines();
}

function refreshLines() {
  const dept = $("departmentSelect").value;
  const lines = currentUser?.role === "supervisor"
    ? [currentUser.line]
    : unique(state.operators.filter((op) => !dept || op.department === dept).map((op) => op.line));
  fillSelect($("lineSelect"), lines);
  renderAll();
}

function parseCardText(text) {
  const clean = text.trim();
  if (!clean) return null;
  const parts = clean.split("|").map((part) => part.trim());

  if (parts.length >= 5) {
    const [code, name, skill, department, line, doj = "", skillLevel = "", issuedDate = "", renewDate = ""] = parts;
    const operator = { code, name, skill, department, line, doj, skillLevel, issuedDate, renewDate };
    upsertOperator(operator);
    return operator;
  }

  return state.operators.find((op) => op.code.toLowerCase() === clean.toLowerCase()) || null;
}

function upsertOperator(operator) {
  state.deletedOperatorIds = state.deletedOperatorIds.filter((id) => id.toLowerCase() !== operator.code.toLowerCase());
  const index = state.operators.findIndex((op) => op.code.toLowerCase() === operator.code.toLowerCase());
  if (index >= 0) {
    state.operators[index] = { ...state.operators[index], ...operator };
  } else {
    state.operators.push(operator);
  }
}

function replaceOperators(operators) {
  const nextCodes = new Set(operators.map((operator) => operator.code.toLowerCase()));
  const removedCodes = state.operators
    .map((operator) => operator.code)
    .filter((code) => code && !nextCodes.has(code.toLowerCase()));

  state.deletedOperatorIds = unique([
    ...state.deletedOperatorIds,
    ...removedCodes
  ]);
  state.operators = operators;
}

function scanAttendance(text, source = "Skill Card") {
  const now = Date.now();
  const clean = text.trim();
  if (!clean) return;
  if (clean === lastScanValue && now - lastScanAt < 1200) return;
  lastScanValue = clean;
  lastScanAt = now;

  const operator = parseCardText(clean);
  if (!operator) {
    showToast("ID not found in master. Ask admin to add/import this operator first.");
    return;
  }

  const context = selectedContext();
  if (currentUser?.role === "supervisor" && (operator.department !== context.department || operator.line !== context.line)) {
    showToast(`${operator.name} belongs to ${operator.department} / ${operator.line}. Not saved for this login.`);
    return;
  }

  const duplicate = state.attendance.find((record) =>
    record.date === context.date &&
    record.shift === context.shift &&
    record.code.toLowerCase() === operator.code.toLowerCase()
  );
  if (duplicate) {
    $("lastScan").innerHTML = `<strong>${escapeHtml(operator.name)}</strong><br>Already scanned today for shift ${escapeHtml(context.shift)}.`;
    showToast("Already scanned. Duplicate not saved.");
    return;
  }

  const record = {
    id: crypto.randomUUID(),
    date: context.date,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    code: operator.code,
    name: operator.name,
    skill: operator.skill,
    currentProcess: operator.skill,
    doj: operator.doj || "",
    skillLevel: operator.skillLevel || "",
    issuedDate: operator.issuedDate || "",
    renewDate: operator.renewDate || "",
    department: operator.department || context.department,
    line: operator.line || context.line,
    shift: context.shift,
    supervisor: context.supervisor,
    leaderId: context.leaderId,
    source,
    status: "Present"
  };

  state.attendance.push(record);
  saveState();
  $("lastScan").innerHTML = `<strong>${escapeHtml(operator.name)}</strong><br>${escapeHtml(operator.code)} · ${escapeHtml(operator.skill)} · saved automatically`;
  $("scanInput").value = "";
  refreshFilters();
  renderAll();
}

async function toggleCamera() {
  if (stream) {
    stopCamera();
    return;
  }

  if (!("BarcodeDetector" in window)) {
    showToast("Camera scanning is not supported here. Use a USB scanner or ID entry.");
    return;
  }

  try {
    detector = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    $("scannerVideo").srcObject = stream;
    await $("scannerVideo").play();
    $("cameraEmpty").classList.add("hidden");
    $("cameraBtn").textContent = "Stop Camera";
    scanning = true;
    scanLoop();
  } catch {
    showToast("Camera permission was blocked or no camera is available.");
  }
}

function stopCamera() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  scanning = false;
  $("scannerVideo").srcObject = null;
  $("cameraEmpty").classList.remove("hidden");
  $("cameraBtn").textContent = "Start Camera";
}

async function scanLoop() {
  if (!scanning || !detector) return;
  try {
    const codes = await detector.detect($("scannerVideo"));
    if (codes.length) {
      scanAttendance(codes[0].rawValue, "Camera Scan");
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
  } catch {
    // Some frames are not readable while the camera warms up.
  }
  requestAnimationFrame(scanLoop);
}

function scopedAttendance(records = state.attendance) {
  if (currentUser?.role !== "supervisor") return records;
  return records.filter((record) => record.department === currentUser.department && record.line === currentUser.line);
}

function currentLineRecords() {
  const context = selectedContext();
  return state.attendance.filter((record) =>
    record.date === context.date &&
    record.department === context.department &&
    record.line === context.line &&
    record.shift === context.shift
  );
}

function renderAttendance() {
  const records = currentLineRecords();
  const required = state.operators.filter((op) =>
    op.department === $("departmentSelect").value && op.line === $("lineSelect").value
  ).length;

  $("presentCount").textContent = records.length;
  $("requiredCount").textContent = required;
  $("gapCount").textContent = Math.max(required - records.length, 0);

  const skillCounts = records.reduce((acc, record) => {
    acc[record.skill] = (acc[record.skill] || 0) + 1;
    return acc;
  }, {});
  $("skillSummary").innerHTML = Object.entries(skillCounts)
    .map(([skill, count]) => `<div class="pill-row"><span>${escapeHtml(skill)}</span><strong>${count}</strong></div>`)
    .join("") || `<div class="pill-row"><span>No skill count yet</span><strong>0</strong></div>`;

  $("attendanceRows").innerHTML = records.map((record) => `
    <tr>
      <td>${escapeHtml(record.time)}</td>
      <td>${escapeHtml(record.code)}</td>
      <td>${escapeHtml(record.name)}</td>
      <td>${escapeHtml(record.skill)}</td>
      <td>${escapeHtml(record.department)}</td>
      <td>${escapeHtml(record.line)}</td>
      <td><span class="status present">${escapeHtml(record.source || record.status)}</span></td>
      <td><button class="mini-btn" data-remove="${record.id}">Remove</button></td>
    </tr>
  `).join("") || `<tr><td colspan="8">No attendance marked for this line yet.</td></tr>`;
}

function attendanceGroups() {
  const groups = new Map();
  scopedAttendance().forEach((record) => {
    const key = groupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  return [...groups.entries()].map(([key, records]) => ({ key, records, first: records[0] }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function lineSessionsFor(operator, shift = "all") {
  const sessions = new Set();
  state.attendance.forEach((record) => {
    const sameLine = record.department === operator.department && record.line === operator.line;
    const sameShift = shift === "all" || record.shift === shift;
    if (sameLine && sameShift) sessions.add(`${record.date}::${record.shift}`);
  });
  return [...sessions].sort();
}

function absenteeismFor(operator, shift = "all") {
  const sessions = lineSessionsFor(operator, shift);
  const present = new Set(
    state.attendance
      .filter((record) => record.code.toLowerCase() === operator.code.toLowerCase())
      .filter((record) => shift === "all" || record.shift === shift)
      .map((record) => `${record.date}::${record.shift}`)
  );
  const absentSessions = sessions.filter((session) => !present.has(session));
  const absentPercent = sessions.length ? Math.round((absentSessions.length / sessions.length) * 1000) / 10 : 0;
  return {
    operator,
    workingSessions: sessions.length,
    presentSessions: present.size,
    absentSessions,
    absentCount: absentSessions.length,
    absentPercent
  };
}

function scopedOperators() {
  if (currentUser?.role !== "supervisor") return state.operators;
  return state.operators.filter((op) => op.department === currentUser.department && op.line === currentUser.line);
}

function absentSessionLabel(session) {
  const [date, shift] = session.split("::");
  return `${date} (${shift})`;
}

function blacklistRows() {
  return scopedOperators()
    .map((operator) => absenteeismFor(operator, "all"))
    .filter((item) => item.workingSessions > 0 && item.absentPercent > 20)
    .sort((a, b) => b.absentPercent - a.absentPercent || b.absentCount - a.absentCount);
}

function renderQueryResult(operatorCode = $("queryInput").value.trim()) {
  const code = operatorCode.trim();
  if (!code) {
    $("queryResult").innerHTML = `<span>Enter an Emp. ID to check attendance history.</span>`;
    return;
  }

  const operator = state.operators.find((op) => op.code.toLowerCase() === code.toLowerCase());
  if (!operator) {
    $("queryResult").innerHTML = `<strong>Emp. ID not found</strong><br><span>${escapeHtml(code)} is not available in master data.</span>`;
    return;
  }

  if (currentUser?.role === "supervisor" && (operator.department !== currentUser.department || operator.line !== currentUser.line)) {
    $("queryResult").innerHTML = `<strong>Outside this login</strong><br><span>${escapeHtml(operator.name)} belongs to ${escapeHtml(operator.department)} / ${escapeHtml(operator.line)}.</span>`;
    return;
  }

  const stats = absenteeismFor(operator, $("queryShift").value);
  const absentList = stats.absentSessions.map(absentSessionLabel).join(", ") || "No absent days in recorded attendance sessions.";
  $("queryResult").innerHTML = `
    <div class="query-person">
      <strong>${escapeHtml(operator.name)}</strong>
      <span>${escapeHtml(operator.code)} · ${escapeHtml(operator.department)} / ${escapeHtml(operator.line)}</span>
    </div>
    <div class="metrics compact-metrics">
      <div class="metric"><span>Working Sessions</span><strong>${stats.workingSessions}</strong></div>
      <div class="metric"><span>Absent</span><strong>${stats.absentCount}</strong></div>
      <div class="metric"><span>Absent %</span><strong>${stats.absentPercent}%</strong></div>
    </div>
    <div class="absent-list"><strong>Absent days:</strong> ${escapeHtml(absentList)}</div>
  `;
}

function renderAdmin() {
  const records = scopedAttendance();
  const groups = attendanceGroups();
  $("adminTotal").textContent = records.length;
  $("adminLines").textContent = groups.length;
  $("adminOperators").textContent = state.operators.length;

  const deptCounts = records.reduce((acc, record) => {
    acc[record.department] = (acc[record.department] || 0) + 1;
    return acc;
  }, {});
  const max = Math.max(...Object.values(deptCounts), 1);
  $("deptBars").innerHTML = Object.entries(deptCounts).map(([dept, count]) => `
    <div class="bar-row">
      <span>${escapeHtml(dept)}</span>
      <progress max="${max}" value="${count}"></progress>
      <strong>${count}</strong>
    </div>
  `).join("") || `<div class="bar-row"><span>No attendance yet</span><strong>0</strong></div>`;

  $("adminRows").innerHTML = groups.map(({ key, records: groupRecords, first }) => {
    const skills = summarize(groupRecords.map((record) => record.skill));
    const names = groupRecords.map((record) => record.name).join(", ");
    return `
      <tr>
        <td>${escapeHtml(first.date)}</td>
        <td>${escapeHtml(first.department)}</td>
        <td>${escapeHtml(first.line)}</td>
        <td>${escapeHtml(first.shift)}</td>
        <td>${groupRecords.length}</td>
        <td>${escapeHtml(skills)}</td>
        <td>${escapeHtml(names)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="8">No compiled data yet.</td></tr>`;
}

function renderBlacklist() {
  const rows = blacklistRows();
  $("blacklistRows").innerHTML = rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.operator.code)}</td>
      <td>${escapeHtml(item.operator.name)}</td>
      <td>${escapeHtml(item.operator.department)}</td>
      <td>${escapeHtml(item.operator.line)}</td>
      <td>${item.workingSessions}</td>
      <td>${item.absentCount}</td>
      <td><span class="status risk">${item.absentPercent}%</span></td>
      <td>${escapeHtml(item.absentSessions.map(absentSessionLabel).join(", "))}</td>
    </tr>
  `).join("") || `<tr><td colspan="8">No one is above 20% absenteeism for recorded line sessions.</td></tr>`;
}

function renderMaster() {
  $("masterRows").innerHTML = state.operators.map((op) => `
    <tr>
      <td>${escapeHtml(op.code)}</td>
      <td>${escapeHtml(op.name)}</td>
      <td>${escapeHtml(op.skill)}</td>
      <td>${escapeHtml(op.department)}</td>
      <td>${escapeHtml(op.line)}</td>
      <td>${escapeHtml(op.doj || "")}</td>
      <td>${escapeHtml(op.skillLevel || "")}</td>
    </tr>
  `).join("");
}

function renderUsers() {
  const adminCount = state.users.filter((user) => user.role === "admin").length;
  $("userRows").innerHTML = state.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.id)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>${escapeHtml(user.department || "All")}</td>
      <td>${escapeHtml(user.line || "All")}</td>
      <td>${canRemoveUser(user, adminCount) ? `<button class="mini-btn" data-remove-user="${escapeHtml(user.id)}">Remove</button>` : ""}</td>
    </tr>
  `).join("");
}

function canRemoveUser(user, adminCount = state.users.filter((item) => item.role === "admin").length) {
  if (currentUser?.id === user.id) return false;
  if (user.role === "admin" && adminCount <= 1) return false;
  return true;
}

function renderAll() {
  renderAttendance();
  renderAdmin();
  renderBlacklist();
  renderMaster();
  renderUsers();
}

function summarize(values) {
  const counts = values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([value, count]) => `${value}: ${count}`).join("; ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function exportExcel() {
  const rows = [
    ["Date", "Time", "Emp. ID", "Name", "Dept.", "Current Process", "Skill Level", "DOJ", "Issued Date", "Renew Date", "Line", "Shift", "Line Leader", "Leader Login", "Entry Source"]
  ];
  scopedAttendance().forEach((record) => {
    rows.push([
      record.date,
      record.time,
      record.code,
      record.name,
      record.department,
      record.currentProcess || record.skill,
      record.skillLevel || "",
      record.doj || "",
      record.issuedDate || "",
      record.renewDate || "",
      record.line,
      record.shift,
      record.supervisor,
      record.leaderId || "",
      record.source || "Skill Card"
    ]);
  });

  const html = `
    <html><head><meta charset="utf-8"></head><body>
      <table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</table>
    </body></html>
  `;
  download(`plant-attendance-${today}.xls`, html, "application/vnd.ms-excel");
}

function exportBackup() {
  const backup = {
    ...state,
    users: state.users.map(({ password, ...user }) => ({
      ...user,
      hasPassword: Boolean(password)
    }))
  };
  download(`plant-attendance-backup-${today}.json`, JSON.stringify(backup, null, 2), "application/json");
}

function exportBlacklist() {
  const rows = [
    ["Emp. ID", "Name", "Department", "Line", "Working Sessions", "Absent", "Absent %", "Absent Days"]
  ];
  blacklistRows().forEach((item) => {
    rows.push([
      item.operator.code,
      item.operator.name,
      item.operator.department,
      item.operator.line,
      item.workingSessions,
      item.absentCount,
      `${item.absentPercent}%`,
      item.absentSessions.map(absentSessionLabel).join(", ")
    ]);
  });
  const html = `
    <html><head><meta charset="utf-8"></head><body>
      <table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</table>
    </body></html>
  `;
  download(`plant-blacklist-${today}.xls`, html, "application/vnd.ms-excel");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows.filter((item) => item.length >= 5 && item[0]);
}

function setActiveView(view) {
  if (!userCan(view)) {
    view = "supervisor";
  }
  document.querySelectorAll(".nav-tab").forEach((tab) => {
    const allowed = userCan(tab.dataset.view);
    tab.hidden = !allowed;
    tab.classList.toggle("active", tab.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => section.classList.remove("active"));
  $(`${view}View`).classList.add("active");
  $("viewTitle").textContent = document.querySelector(`[data-view="${view}"]`)?.textContent.trim() || "Attendance";
}

function applyLoginState() {
  const loggedIn = Boolean(currentUser);
  $("loginScreen").classList.toggle("hidden", loggedIn);
  document.querySelector(".app-shell").classList.toggle("locked", !loggedIn);
  if (!loggedIn) {
    const firstAdminMode = serverLoaded && state.users.length === 0;
    $("loginBtn").textContent = firstAdminMode ? "Create First Admin" : "Login";
    $("loginHint").textContent = firstAdminMode
      ? "No production login exists yet. Create the first admin before sharing the app link."
      : "Production logins are loaded from the Postgres database. Import existing users before plant use.";
    return;
  }

  $("currentUserLabel").textContent = `${currentUser.name} (${currentUser.role})`;
  $("currentScopeLabel").textContent = currentUser.role === "supervisor"
    ? `${currentUser.department} / ${currentUser.line}`
    : "All plant departments";
  $("departmentSelect").disabled = currentUser.role === "supervisor";
  $("lineSelect").disabled = currentUser.role === "supervisor";
  $("supervisorName").value = currentUser.name;
  const activeView = document.querySelector(".nav-tab.active")?.dataset.view || "supervisor";
  refreshFilters();
  setActiveView(activeView);
}

function login() {
  const id = $("loginUser").value.trim();
  const password = $("loginPass").value;
  if (!serverLoaded) {
    showToast("Loading production login data. Try again in a moment.");
    loadServerState();
    return;
  }
  if (!state.users.length) {
    if (!id || !password) {
      showToast("Enter first admin user ID and password.");
      return;
    }
    const user = {
      name: id,
      id,
      password,
      role: "admin",
      department: "All",
      line: "All"
    };
    state.users.push(user);
    currentUser = user;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    saveState();
    applyLoginState();
    renderAll();
    showToast("First admin login created.");
    return;
  }
  const user = state.users.find((item) => item.id === id && item.password === password);
  if (!user) {
    showToast("Login failed. Check user ID/password or import admin user into database.");
    return;
  }
  currentUser = user;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  applyLoginState();
  renderAll();
  $("scanInput").focus();
}

document.querySelectorAll(".nav-tab").forEach((button) => {
  button.addEventListener("click", () => {
    closeOptionsMenu();
    loadServerState();
    setActiveView(button.dataset.view);
  });
});

$("loginBtn").addEventListener("click", login);
$("loginPass").addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});
$("logoutBtn").addEventListener("click", () => {
  currentUser = null;
  sessionStorage.removeItem(SESSION_KEY);
  stopCamera();
  closeOptionsMenu();
  applyLoginState();
});

$("menuBtn").addEventListener("click", () => {
  const sidebar = document.querySelector(".sidebar");
  const open = sidebar.classList.toggle("menu-open");
  $("menuBtn").setAttribute("aria-expanded", String(open));
});

function closeOptionsMenu() {
  document.querySelector(".sidebar").classList.remove("menu-open");
  $("menuBtn").setAttribute("aria-expanded", "false");
}

$("departmentSelect").addEventListener("change", refreshLines);
["lineSelect", "shiftSelect", "attendanceDate"].forEach((id) => {
  $(id).addEventListener("change", renderAll);
});

$("scanInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") scanAttendance(event.target.value, "Skill Card");
});
$("missedCardBtn").addEventListener("click", () => scanAttendance($("scanInput").value, "Missed Card ID"));
$("queryFromScanBtn").addEventListener("click", () => {
  $("queryInput").value = $("scanInput").value.trim();
  setActiveView("blacklist");
  renderQueryResult();
});
$("cameraBtn").addEventListener("click", toggleCamera);
$("downloadBtn").addEventListener("click", exportExcel);
$("backupBtn").addEventListener("click", exportBackup);
$("queryBtn").addEventListener("click", () => renderQueryResult());
$("queryInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") renderQueryResult();
});
$("queryShift").addEventListener("change", () => renderQueryResult());
$("downloadBlacklistBtn").addEventListener("click", exportBlacklist);

$("attendanceRows").addEventListener("click", (event) => {
  const id = event.target.dataset.remove;
  if (!id) return;
  const record = state.attendance.find((item) => item.id === id);
  if (!window.confirm(`Remove attendance for ${record?.name || "this operator"}?`)) return;
  state.deletedAttendanceIds.push(id);
  state.attendance = state.attendance.filter((item) => item.id !== id);
  saveState();
  renderAll();
});

$("clearLineBtn").addEventListener("click", () => {
  const records = currentLineRecords();
  if (!records.length) return;
  if (!window.confirm(`Clear ${records.length} attendance record(s) for this line and shift?`)) return;
  const ids = new Set(records.map((record) => record.id));
  state.deletedAttendanceIds.push(...ids);
  state.attendance = state.attendance.filter((record) => !ids.has(record.id));
  saveState();
  renderAll();
  showToast("Selected line attendance cleared.");
});

$("sampleBtn").addEventListener("click", () => {
  if (!window.confirm("Replace current operator master with sample data?")) return;
  replaceOperators(sampleOperators);
  saveState();
  refreshFilters();
  showToast("Sample master loaded.");
});

$("addOperatorBtn").addEventListener("click", () => {
  const operator = {
    code: $("newCode").value.trim(),
    name: $("newName").value.trim(),
    skill: $("newSkill").value.trim(),
    department: $("newDept").value.trim(),
    line: $("newLine").value.trim(),
    doj: $("newDoj").value.trim(),
    skillLevel: $("newSkillLevel").value.trim()
  };
  if (!operator.code || !operator.name || !operator.department || !operator.line) {
    showToast("Please enter code, name, department and line.");
    return;
  }
  upsertOperator(operator);
  ["newCode", "newName", "newSkill", "newDept", "newLine", "newDoj", "newSkillLevel"].forEach((id) => $(id).value = "");
  saveState();
  refreshFilters();
  showToast("Operator added to master.");
});

$("masterFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const rows = parseCsv(await file.text());
  const firstHeader = rows[0]?.[0]?.toLowerCase();
  const hasHeader = firstHeader === "code" || firstHeader === "emp_id";
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const importedOperators = dataRows.map(([code, name, department, line, skill, doj = "", skillLevel = "", issuedDate = "", renewDate = ""]) => ({
    code,
    name,
    department,
    line,
    skill,
    doj,
    skillLevel,
    issuedDate,
    renewDate
  }));
  replaceOperators(importedOperators);
  saveState();
  refreshFilters();
  showToast(`${state.operators.length} operators imported.`);
});

$("addUserBtn").addEventListener("click", () => {
  const user = {
    name: $("newLoginName").value.trim(),
    id: $("newLoginId").value.trim(),
    password: $("newLoginPass").value.trim(),
    role: $("newLoginRole").value,
    department: $("newLoginDept").value.trim() || "All",
    line: $("newLoginLine").value.trim() || "All"
  };
  if (!user.name || !user.id || !user.password) {
    showToast("Enter name, user ID and password.");
    return;
  }
  if (user.role === "supervisor" && (!user.department || user.department === "All" || !user.line || user.line === "All")) {
    showToast("Line leader login needs department and line.");
    return;
  }
  state.users = state.users.filter((item) => item.id !== user.id);
  state.users.push(user);
  ["newLoginName", "newLoginId", "newLoginPass", "newLoginDept", "newLoginLine"].forEach((id) => $(id).value = "");
  saveState();
  renderUsers();
  showToast("Login created.");
});

$("userRows").addEventListener("click", (event) => {
  const id = event.target.dataset.removeUser;
  if (!id) return;
  const user = state.users.find((item) => item.id === id);
  if (!user || !canRemoveUser(user)) {
    showToast("This login cannot be removed while it is protecting admin access.");
    renderUsers();
    return;
  }
  if (!window.confirm(`Remove login ${id}?`)) return;
  state.deletedUserIds.push(id);
  state.users = state.users.filter((user) => user.id !== id);
  saveState();
  renderUsers();
});

window.addEventListener("online", () => {
  if (pendingSync) loadServerState();
});

window.addEventListener("focus", () => {
  if (pendingSync) loadServerState();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && pendingSync) loadServerState();
});

refreshFilters();
applyLoginState();
renderAll();
loadServerState();
