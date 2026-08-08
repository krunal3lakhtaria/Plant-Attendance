const STORAGE_KEY = "plant-attendance-v2";
const SESSION_KEY = "plant-attendance-current-user";
const SYNC_PENDING_KEY = "plant-attendance-sync-pending";
const PRODUCTION_ORIGIN = "https://backend-krunal3lakhtaria-3113s-projects.vercel.app";
const API_BASE = location.protocol === "file:" ? PRODUCTION_ORIGIN : "";
const ASSEMBLY_DEPARTMENT = "Assembly";

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
let editingUserId = "";
let selectedDashboardDept = "";

const $ = (id) => document.getElementById(id);
let today = localDate();

$("attendanceDate").value = today;
$("dashboardDate").value = today;
$("historyToDate").value = today;
$("historyFromDate").value = localDate(addDays(new Date(), -30));
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

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function refreshToday() {
  const liveToday = localDate();
  if (liveToday === today) return false;
  today = liveToday;
  $("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
  if (!$("attendanceDate").value || $("attendanceDate").value < today) {
    $("attendanceDate").value = today;
  }
  if (!$("historyToDate").value || $("historyToDate").value < today) {
    $("historyToDate").value = today;
  }
  if (!$("dashboardDate").value || $("dashboardDate").value < today) {
    $("dashboardDate").value = today;
  }
  return true;
}

function normalizeState(parsed = {}) {
  return {
    operators: Array.isArray(parsed.operators) ? parsed.operators : [],
    attendance: Array.isArray(parsed.attendance) ? parsed.attendance : [],
    users: Array.isArray(parsed.users) ? parsed.users : defaultUsers,
    deptTargets: normalizeDeptTargets(parsed.deptTargets),
    deletedAttendanceIds: Array.isArray(parsed.deletedAttendanceIds) ? parsed.deletedAttendanceIds : [],
    deletedUserIds: Array.isArray(parsed.deletedUserIds) ? parsed.deletedUserIds : [],
    deletedOperatorIds: Array.isArray(parsed.deletedOperatorIds) ? parsed.deletedOperatorIds : []
  };
}

function normalizeDeptTargets(value) {
  const source = Array.isArray(value)
    ? value
    : Object.entries(value || {}).map(([department, target]) => ({ department, target }));
  const targets = source
    .map((item) => ({
      department: reportingDepartmentName(item.department || item.dept || ""),
      target: Math.max(Number.parseInt(item.target, 10) || 0, 0)
    }))
    .filter((item) => item.department);
  const merged = targets.reduce((acc, item) => {
    acc[item.department] = Math.max(acc[item.department] || 0, item.target);
    return acc;
  }, {});
  return Object.entries(merged).map(([department, target]) => ({ department, target }));
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
    deptTargets: upsertBy(existing.deptTargets, incoming.deptTargets, (item) => item.department),
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
  return [record.date, reportingDepartment(record), record.line, record.shift].join("::");
}

function userCan(view) {
  if (!currentUser) return false;
  if (currentUser.role === "admin") return true;
  return view === "supervisor" || view === "history" || view === "blacklist";
}

function selectedContext() {
  if (currentUser?.role === "supervisor") {
    const department = reportingDepartmentName(currentUser.department, currentUser.line);
    return {
      date: $("attendanceDate").value || today,
      department,
      line: currentUser.line,
      shift: $("shiftSelect").value,
      supervisor: currentUser.name,
      leaderId: currentUser.id
    };
  }

  const line = $("lineSelect").value;
  return {
    date: $("attendanceDate").value || today,
    department: reportingDepartmentName($("departmentSelect").value, line),
    line,
    shift: $("shiftSelect").value,
    supervisor: $("supervisorName").value.trim() || currentUser?.name || "Supervisor",
    leaderId: currentUser?.id || "unknown"
  };
}

function hasLineContext(context) {
  return Boolean(context.department && context.line);
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

function fillSelectWithAll(select, values, allLabel = "All") {
  const previous = select.value;
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = allLabel;
  select.appendChild(allOption);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = previous === "all" || values.includes(previous) ? previous : "all";
}

function currentContextFallback() {
  const department = currentUser?.role === "supervisor"
    ? currentUser.department
    : $("departmentSelect").value;
  const line = currentUser?.role === "supervisor"
    ? currentUser.line
    : $("lineSelect").value;
  return { department: reportingDepartmentName(department, line), line };
}

function refreshFilters() {
  const departments = currentUser?.role === "supervisor"
    ? [reportingDepartmentName(currentUser.department, currentUser.line)]
    : unique(state.operators.map(reportingDepartment));
  fillSelect($("departmentSelect"), departments);
  refreshHistoryFilters();
  refreshTargetDepartmentSelect();
  refreshLines();
}

function refreshLines() {
  const dept = $("departmentSelect").value;
  const lines = currentUser?.role === "supervisor"
    ? [currentUser.line]
    : unique(state.operators.filter((op) => !dept || reportingDepartment(op) === dept).map((op) => op.line));
  fillSelect($("lineSelect"), lines);
  renderAll();
}

function refreshHistoryFilters() {
  if (currentUser?.role === "supervisor") {
    fillSelect($("historyDepartmentSelect"), [reportingDepartmentName(currentUser.department, currentUser.line)]);
    fillSelect($("historyLineSelect"), [currentUser.line]);
    $("historyDepartmentSelect").disabled = true;
    $("historyLineSelect").disabled = true;
    return;
  }

  $("historyDepartmentSelect").disabled = false;
  $("historyLineSelect").disabled = false;
  const records = scopedAttendance();
  fillSelectWithAll($("historyDepartmentSelect"), unique(records.map(reportingDepartment)), "All Departments");
  refreshHistoryLines(false);
}

function refreshHistoryLines(shouldRender = true) {
  if (currentUser?.role === "supervisor") {
    fillSelect($("historyLineSelect"), [currentUser.line]);
    if (shouldRender) renderAll();
    return;
  }

  const department = $("historyDepartmentSelect").value;
  const records = scopedAttendance().filter((record) =>
    department === "all" || reportingDepartment(record) === department
  );
  fillSelectWithAll($("historyLineSelect"), unique(records.map((record) => record.line)), "All Lines");
  if (shouldRender) renderAll();
}

function refreshTargetDepartmentSelect() {
  fillSelect($("targetDeptSelect"), departmentNames());
  updateTargetInput();
}

function updateTargetInput() {
  const department = $("targetDeptSelect").value;
  $("targetValueInput").value = department ? departmentTarget(department) || "" : "";
}

function parseCardText(text) {
  const clean = text.trim();
  if (!clean) return null;

  const scannedOperator = operatorFromScannedText(clean);
  if (scannedOperator) {
    upsertOperator(scannedOperator);
    return scannedOperator;
  }

  const existingOperator = findOperatorByCode(clean);
  if (existingOperator) return existingOperator;

  return null;
}

function findOperatorByCode(code) {
  const clean = String(code || "").trim().toLowerCase();
  if (!clean) return null;
  return state.operators.find((op) => op.code.toLowerCase() === clean) || null;
}

function operatorFromScannedText(text) {
  return operatorFromJson(text)
    || operatorFromUrlText(text)
    || operatorFromKeyValueText(text)
    || operatorFromCardText(text)
    || operatorFromPipeText(text);
}

function operatorFromJson(text) {
  if (!text.startsWith("{")) return null;
  try {
    return normalizeScannedOperator(JSON.parse(text));
  } catch {
    return null;
  }
}

function operatorFromUrlText(text) {
  const clean = text.trim();
  if (!clean.includes("?") && !clean.includes("=")) return null;

  try {
    const url = new URL(clean.includes("://") ? clean : `https://attendance.local/?${clean.replace(/^\?/, "")}`);
    const fields = Object.fromEntries(url.searchParams.entries());
    return Object.keys(fields).length ? normalizeScannedOperator(fields) : null;
  } catch {
    return null;
  }
}

function operatorFromPipeText(text) {
  const separator = text.includes("|") ? "|" : text.includes("\t") ? "\t" : text.includes(",") ? "," : "";
  if (!separator) return null;
  const parts = text.split(separator).map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 5) {
    const [code, name, third, fourth, fifth, doj = "", skillLevel = "", issuedDate = "", renewDate = ""] = parts;
    return bestScannedOperator([
      { code, name, skill: third, department: fourth, line: fifth, doj, skillLevel, issuedDate, renewDate },
      { code, name, department: third, line: fourth, skill: fifth, doj, skillLevel, issuedDate, renewDate }
    ]);
  }

  return null;
}

function operatorFromKeyValueText(text) {
  const fields = {};
  text
    .split(/\n|;|\|/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
      if (!match) return;
      fields[normalizeFieldName(match[1])] = match[2].trim();
    });

  if (!Object.keys(fields).length) return null;
  return normalizeScannedOperator(fields);
}

function operatorFromCardText(text) {
  const flat = text
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ");

  const code = readCardField(flat, ["Emp. ID", "Emp ID", "Employee ID", "Operator ID"], ["DOJ", "Dept", "Department", "Current Process", "Process", "Issued Date", "Renew Date"]);
  const name = readCardField(flat, ["Name of Operator", "Operator Name"], ["Emp. ID", "Emp ID", "Employee ID", "DOJ", "Dept", "Department"]);
  const department = readCardField(flat, ["Dept.", "Dept", "Department"], ["Current Process", "Process", "Issued Date", "Issue Date", "Renew Date", "Skill Level"]);
  const skill = readCardField(flat, ["Current Process", "Process"], ["Issued Date", "Issue Date", "Renew Date", "Authorised", "Authorized", "Skill Level"]);
  const doj = readCardField(flat, ["DOJ", "Date of Joining"], ["Dept", "Department", "Current Process", "Process"]);
  const issuedDate = readCardField(flat, ["Issued Date", "Issue Date"], ["Renew Date", "Skill Level"]);
  const renewDate = readCardField(flat, ["Renew Date", "Renewal Date"], ["Skill Level", "Authorised", "Authorized"]);
  const skillLevel = readCardField(flat, ["Skill Level", "Level"], ["Issued Date", "Renew Date", "Authorised", "Authorized"]);

  return normalizeScannedOperator({ code, name, department, skill, doj, issuedDate, renewDate, skillLevel });
}

function readCardField(text, labels, nextLabels) {
  for (const label of labels) {
    const labelPattern = labelToPattern(label);
    const nextPattern = nextLabels.map(labelToPattern).join("|");
    const regex = new RegExp(`(?:^|\\b)${labelPattern}\\s*[:=]?\\s*([\\s\\S]*?)(?=\\s+(?:${nextPattern})\\s*[:=]?|$)`, "i");
    const match = text.match(regex);
    if (match?.[1]) return cleanScannedValue(match[1]);
  }
  return "";
}

function labelToPattern(label) {
  return label
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\./g, "\\.?")
    .replace(/\s+/g, "\\s+");
}

function cleanScannedValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:=-]+|[\s,;]+$/g, "")
    .trim();
}

function reportingDepartmentName(department, line = "") {
  const cleanDepartment = cleanScannedValue(department);
  const cleanLine = cleanScannedValue(line);
  const joined = `${cleanDepartment} ${cleanLine}`;
  if (/\bassembly\b/i.test(joined) || /^lines?$/i.test(cleanDepartment)) {
    return ASSEMBLY_DEPARTMENT;
  }
  return cleanDepartment;
}

function reportingDepartment(item = {}) {
  return reportingDepartmentName(item.department, item.line || item.homeLine);
}

function reportingHomeDepartment(record = {}) {
  return reportingDepartmentName(record.homeDepartment || record.department, record.homeLine || record.line);
}

function normalizeFieldName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function readScannedField(source, names) {
  for (const name of names) {
    const direct = source[name];
    const normalized = source[normalizeFieldName(name)];
    if (direct || normalized) return String(direct || normalized).trim();
  }
  return "";
}

function normalizeScannedOperator(source = {}) {
  const readableSource = normalizeScannedFields(source);
  const fallback = currentContextFallback();
  const code = readScannedField(readableSource, ["code", "empId", "emp_id", "employeeId", "employee_id", "empid", "operatorId", "operator_id", "id"]);
  if (!code) return null;

  const name = readScannedField(readableSource, ["name", "operatorName", "operator_name", "nameofoperator", "nameOfOperator"]);
  const skill = readScannedField(readableSource, ["skill", "currentProcess", "current_process", "process", "currentprocess"]);
  const rawDepartment = readScannedField(readableSource, ["department", "dept", "dept.", "deptname"]);
  const rawLine = readScannedField(readableSource, ["line", "lineName", "line_name"]);
  const splitContext = splitDepartmentLine(rawDepartment, rawLine);
  const department = reportingDepartmentName(splitContext.department || fallback.department, splitContext.line || fallback.line);
  const line = splitContext.line || fallback.line;

  if (!name || !department || !line) return null;
  return {
    code,
    name,
    skill: skill || "Not specified",
    department,
    line,
    doj: readScannedField(readableSource, ["doj", "dateOfJoining", "date_of_joining"]),
    skillLevel: readScannedField(readableSource, ["skillLevel", "skill_level", "level"]),
    issuedDate: readScannedField(readableSource, ["issuedDate", "issued_date", "issueDate", "issue_date"]),
    renewDate: readScannedField(readableSource, ["renewDate", "renew_date", "renewalDate", "renewal_date"])
  };
}

function operatorFromIdOnlyScan(code, context = selectedContext()) {
  if (!isIdOnlyScan(code) || !hasLineContext(context)) return null;
  return {
    code: String(code).trim(),
    name: `Emp. ID ${String(code).trim()}`,
    skill: "Details pending",
    department: reportingDepartmentName(context.department, context.line),
    line: context.line,
    doj: "",
    skillLevel: "",
    issuedDate: "",
    renewDate: "",
    detailsPending: true
  };
}

function splitDepartmentLine(department, line) {
  const cleanDepartment = cleanScannedValue(department);
  const cleanLine = cleanScannedValue(line);
  if (cleanLine || !cleanDepartment) {
    return { department: cleanDepartment, line: cleanLine };
  }

  const separatorMatch = cleanDepartment.match(/^(.+?)[-/](.+)$/);
  if (!separatorMatch) return { department: cleanDepartment, line: "" };

  const possibleDepartment = cleanScannedValue(separatorMatch[1]);
  const possibleLine = cleanScannedValue(separatorMatch[2]);
  if (!possibleDepartment || !possibleLine) return { department: cleanDepartment, line: "" };

  return looksLikeLine(possibleLine)
    ? { department: possibleDepartment, line: possibleLine }
    : { department: cleanDepartment, line: "" };
}

function bestScannedOperator(candidates) {
  const operators = candidates
    .map((candidate) => normalizeScannedOperator(candidate))
    .filter(Boolean)
    .sort((a, b) => scoreOperatorCandidate(b) - scoreOperatorCandidate(a));
  return operators[0] || null;
}

function scoreOperatorCandidate(operator) {
  let score = 0;
  if (/^\d{3,}$|^[a-z]*\d{3,}$/i.test(operator.code)) score += 2;
  if (operator.name && /\s/.test(operator.name)) score += 2;
  if (looksLikeLine(operator.line)) score += 3;
  if (operator.department && !looksLikeLine(operator.department)) score += 1;
  if (operator.skill && !looksLikeLine(operator.skill)) score += 1;
  return score;
}

function looksLikeLine(value) {
  return /\b(line|assembly|cell|station|shop|k\d+|l\d+)\b|^[a-z]+-\w*\d+$|^[A-Z]{2,6}\d*$/i.test(String(value || ""));
}

function isIdOnlyScan(value) {
  return /^[a-z]*\d{3,}$/i.test(String(value || "").trim());
}

function normalizeScannedFields(source) {
  return Object.entries(source || {}).reduce((fields, [key, value]) => {
    fields[key] = value;
    fields[normalizeFieldName(key)] = value;
    return fields;
  }, {});
}

function upsertOperator(operator) {
  state.deletedOperatorIds = state.deletedOperatorIds.filter((id) => id.toLowerCase() !== operator.code.toLowerCase());
  const index = state.operators.findIndex((op) => op.code.toLowerCase() === operator.code.toLowerCase());
  if (index >= 0) {
    state.operators[index] = { ...state.operators[index], ...operator };
  } else {
    state.operators.push(operator);
  }
  updateAttendanceDetails(operator);
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
  operators.forEach(updateAttendanceDetails);
}

function importReferenceOperators(operators) {
  let added = 0;
  let updated = 0;

  operators.forEach((operator) => {
    const existing = findOperatorByCode(operator.code);
    upsertOperator({ ...operator, detailsPending: false });
    if (existing) {
      updated += 1;
    } else {
      added += 1;
    }
  });

  return { added, updated, total: operators.length };
}

function updateAttendanceDetails(operator) {
  if (!operator?.code || !operator.name) return;
  state.attendance = state.attendance.map((record) => {
    if (record.code.toLowerCase() !== operator.code.toLowerCase()) return record;
    return {
      ...record,
      name: operator.name || record.name,
      skill: operator.skill || record.skill,
      currentProcess: operator.skill || record.currentProcess,
      homeDepartment: reportingDepartmentName(operator.department, operator.line) || record.homeDepartment || record.department,
      homeLine: operator.line || record.homeLine || record.line,
      doj: operator.doj || record.doj || "",
      skillLevel: operator.skillLevel || record.skillLevel || "",
      issuedDate: operator.issuedDate || record.issuedDate || "",
      renewDate: operator.renewDate || record.renewDate || ""
    };
  });
}

function scanAttendance(text, source = "Skill Card") {
  const now = Date.now();
  const clean = text.trim();
  if (!clean) return;
  if (clean === lastScanValue && now - lastScanAt < 1200) return;
  lastScanValue = clean;
  lastScanAt = now;

  let scanSource = source;
  let operator = parseCardText(clean);
  if (!operator && source !== "Missed Card ID" && isIdOnlyScan(clean)) {
    operator = operatorFromIdOnlyScan(clean);
    if (operator) {
      upsertOperator(operator);
      scanSource = `${source} - ID only`;
      showToast("QR has Emp. ID only. Attendance saved; details pending.");
    }
  }

  if (!operator) {
    const message = isIdOnlyScan(clean)
      ? "ID not learned yet. Scan the card QR on assigned line, or use full-detail QR."
      : "QR detail not readable. Use labeled QR text with Emp. ID, name, department and line.";
    showToast(message);
    return;
  }

  const context = selectedContext();
  const duplicate = state.attendance.find((record) =>
    record.date === context.date &&
    record.shift === context.shift &&
    record.code.toLowerCase() === operator.code.toLowerCase()
  );
  const isDuplicate = Boolean(duplicate);

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
    department: context.department,
    line: context.line,
    homeDepartment: operator.department || context.department,
    homeLine: operator.line || context.line,
    shift: context.shift,
    supervisor: context.supervisor,
    leaderId: context.leaderId,
    source: scanSource,
    status: isDuplicate ? "Duplicate" : "Present",
    duplicateOf: duplicate?.id || ""
  };

  state.attendance.push(record);
  saveState();
  $("lastScan").innerHTML = isDuplicate
    ? `<strong>${escapeHtml(operator.name)}</strong><br>${escapeHtml(operator.code)} · duplicate highlighted · present count unchanged`
    : `<strong>${escapeHtml(operator.name)}</strong><br>${escapeHtml(operator.code)} · ${escapeHtml(operator.skill)} · saved automatically`;
  $("scanInput").value = "";
  refreshFilters();
  renderAll();
  if (isDuplicate) {
    showToast(`Duplicate scan highlighted. ${operator.name} is counted once only.`);
  }
}

async function toggleCamera() {
  if (stream) {
    stopCamera();
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraMessage("Camera not available", cameraHelpText("unsupported"));
    showToast("Camera is not available in this browser.");
    return;
  }

  if (!window.isSecureContext) {
    setCameraMessage("Open secure app link", cameraHelpText("insecure"));
    showToast("Open the HTTPS app link to allow camera access.");
    return;
  }

  $("cameraBtn").textContent = "Allow Camera";
  setCameraMessage("Camera permission required", cameraHelpText("request"));

  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    if (!("BarcodeDetector" in window)) {
      stopCamera();
      setCameraMessage("Camera allowed", cameraHelpText("noDetector"));
      showToast("Camera allowed. This browser cannot auto-read QR; use scanner/manual ID.");
      return;
    }

    detector = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13"] });
    $("scannerVideo").srcObject = stream;
    await $("scannerVideo").play();
    $("cameraEmpty").classList.add("hidden");
    $("cameraBtn").textContent = "Stop Camera";
    scanning = true;
    scanLoop();
  } catch (error) {
    if (stream) stopCamera();
    setCameraMessage("Camera access blocked", cameraHelpText(error?.name || "blocked"));
    showToast("Camera blocked. Allow camera in browser settings, then try again.");
  } finally {
    if (!stream) $("cameraBtn").textContent = "Start Camera";
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

function setCameraMessage(title, detail) {
  $("cameraEmpty").classList.remove("hidden");
  $("cameraEmpty").innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
}

function cameraHelpText(reason) {
  if (reason === "request") return "Tap Allow when your phone asks for camera permission.";
  if (reason === "insecure") return "Camera works only on the HTTPS Vercel link, not the local file preview.";
  if (reason === "noDetector") return "Use a browser with barcode scanning support, or use USB scanner / missed-card ID entry after one full scan.";
  if (isIosDevice()) return "On iPhone, open Settings > Safari or Apps > Safari > Camera, choose Allow, then reopen this app.";
  return "Allow camera permission for this site in browser settings, then press Start Camera again.";
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
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
  const userDepartment = reportingDepartmentName(currentUser.department, currentUser.line);
  return records.filter((record) => reportingDepartment(record) === userDepartment && record.line === currentUser.line);
}

function currentLineRecords() {
  const context = selectedContext();
  return state.attendance.filter((record) =>
    record.date === context.date &&
    reportingDepartment(record) === context.department &&
    record.line === context.line &&
    record.shift === context.shift
  );
}

function countedRecords(records = state.attendance) {
  const seen = new Set();
  return records.filter((record) => {
    const key = `${record.date}::${record.shift}::${String(record.code).toLowerCase()}`;
    if (record.status === "Duplicate" || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderAttendance() {
  const records = currentLineRecords();
  const counted = countedRecords(records);
  const required = state.operators.filter((op) =>
    reportingDepartment(op) === $("departmentSelect").value && op.line === $("lineSelect").value
  ).length;

  $("presentCount").textContent = counted.length;
  $("requiredCount").textContent = required;
  $("gapCount").textContent = Math.max(required - counted.length, 0);

  const skillCounts = counted.reduce((acc, record) => {
    acc[record.skill] = (acc[record.skill] || 0) + 1;
    return acc;
  }, {});
  $("skillSummary").innerHTML = Object.entries(skillCounts)
    .map(([skill, count]) => `<div class="pill-row"><span>${escapeHtml(skill)}</span><strong>${count}</strong></div>`)
    .join("") || `<div class="pill-row"><span>No skill count yet</span><strong>0</strong></div>`;

  $("attendanceRows").innerHTML = records.map((record) => `
    <tr class="${record.status === "Duplicate" ? "duplicate-row" : ""}">
      <td>${escapeHtml(record.time)}</td>
      <td>${escapeHtml(record.code)}</td>
      <td>${escapeHtml(record.name)}</td>
      <td>${escapeHtml(record.skill)}</td>
      <td>${escapeHtml(reportingDepartment(record))}</td>
      <td>${escapeHtml(record.line)}</td>
      <td><span class="status ${record.status === "Duplicate" ? "duplicate" : "present"}">${escapeHtml(record.status === "Duplicate" ? "Duplicate - counted once" : record.source || record.status)}</span></td>
      <td><button class="mini-btn" data-remove="${record.id}">Remove</button></td>
    </tr>
  `).join("") || `<tr><td colspan="8">No attendance marked for this line yet.</td></tr>`;
}

function attendanceGroups() {
  const groups = new Map();
  adminDailyRecords().forEach((record) => {
    const key = groupKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  return [...groups.entries()].map(([key, records]) => ({ key, records, first: records[0] }))
    .sort((a, b) => countedRecords(b.records).length - countedRecords(a.records).length || a.key.localeCompare(b.key));
}

function adminDailyRecords() {
  const date = $("attendanceDate").value || today;
  return scopedAttendance().filter((record) => record.date === date);
}

function dashboardRecords(date = $("dashboardDate").value || today) {
  return scopedAttendance().filter((record) => record.date === date);
}

function departmentNames() {
  return unique([
    ...state.operators.map(reportingDepartment),
    ...state.attendance.map(reportingDepartment),
    ...state.deptTargets.map((target) => reportingDepartmentName(target.department))
  ]);
}

function departmentTarget(department) {
  const cleanDepartment = reportingDepartmentName(department);
  return state.deptTargets.find((target) => reportingDepartmentName(target.department) === cleanDepartment)?.target || 0;
}

function setDepartmentTarget(department, target) {
  const cleanDepartment = reportingDepartmentName(department);
  const cleanTarget = Math.max(Number.parseInt(target, 10) || 0, 0);
  if (!cleanDepartment) return;
  state.deptTargets = state.deptTargets.filter((item) => reportingDepartmentName(item.department) !== cleanDepartment);
  state.deptTargets.push({ department: cleanDepartment, target: cleanTarget });
  state.deptTargets.sort((a, b) => a.department.localeCompare(b.department));
}

function departmentDashboardRows(date = $("dashboardDate").value || today) {
  const counted = countedRecords(dashboardRecords(date));
  const departments = departmentNames();
  return departments.map((department) => {
    const deptRecords = counted.filter((record) => reportingDepartment(record) === department);
    const lines = new Set(deptRecords.map((record) => record.line));
    const present = deptRecords.length;
    const target = departmentTarget(department);
    const difference = present - target;
    return {
      department,
      present,
      target,
      difference,
      lines: lines.size,
      status: target === 0
        ? "No target"
        : difference < 0
          ? "Low"
          : difference > 0
            ? "Extra"
            : "Sufficient"
    };
  }).sort((a, b) => b.present - a.present || b.target - a.target || a.department.localeCompare(b.department));
}

function statusClass(status) {
  if (status === "Low") return "risk";
  if (status === "Extra") return "extra";
  if (status === "Sufficient") return "present";
  return "pending";
}

function trendDates(endDate, days = 14) {
  const end = new Date(`${endDate || today}T00:00:00`);
  return Array.from({ length: days }, (_, index) => localDate(addDays(end, index - days + 1)));
}

function colorForIndex(index) {
  const colors = ["#116a7b", "#18a999", "#f5b400", "#6c5ce7", "#e85d75", "#2d9cdb", "#8bc34a", "#ff8a3d"];
  return colors[index % colors.length];
}

function lineSessionsFor(operator, shift = "all") {
  const sessions = new Set();
  const operatorDepartment = reportingDepartment(operator);
  state.attendance.forEach((record) => {
    const sameLine = reportingDepartment(record) === operatorDepartment && record.line === operator.line;
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
  const userDepartment = reportingDepartmentName(currentUser.department, currentUser.line);
  return state.operators.filter((op) => reportingDepartment(op) === userDepartment && op.line === currentUser.line);
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
    $("queryResult").innerHTML = `<strong>Emp. ID not found</strong><br><span>${escapeHtml(code)} is not available in scanned data yet.</span>`;
    return;
  }

  if (currentUser?.role === "supervisor" && (reportingDepartment(operator) !== reportingDepartmentName(currentUser.department, currentUser.line) || operator.line !== currentUser.line)) {
    $("queryResult").innerHTML = `<strong>Outside this login</strong><br><span>${escapeHtml(operator.name)} belongs to ${escapeHtml(reportingDepartment(operator))} / ${escapeHtml(operator.line)}.</span>`;
    return;
  }

  const stats = absenteeismFor(operator, $("queryShift").value);
  const absentList = stats.absentSessions.map(absentSessionLabel).join(", ") || "No absent days in recorded attendance sessions.";
  $("queryResult").innerHTML = `
    <div class="query-person">
      <strong>${escapeHtml(operator.name)}</strong>
      <span>${escapeHtml(operator.code)} · ${escapeHtml(reportingDepartment(operator))} / ${escapeHtml(operator.line)}</span>
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
  const records = adminDailyRecords();
  const counted = countedRecords(records);
  const groups = attendanceGroups();
  $("adminTotal").textContent = counted.length;
  $("adminLines").textContent = groups.length;
  $("adminOperators").textContent = state.operators.length;

  const deptCounts = counted.reduce((acc, record) => {
    const department = reportingDepartment(record);
    acc[department] = (acc[department] || 0) + 1;
    return acc;
  }, {});
  const max = Math.max(...Object.values(deptCounts), 1);
  $("deptBars").innerHTML = Object.entries(deptCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([dept, count]) => `
    <div class="bar-row">
      <span>${escapeHtml(dept)}</span>
      <progress max="${max}" value="${count}"></progress>
      <strong>${count}</strong>
    </div>
  `).join("") || `<div class="bar-row"><span>No attendance yet</span><strong>0</strong></div>`;

  $("adminRows").innerHTML = groups.map(({ key, records: groupRecords, first }) => {
    const countedGroup = countedRecords(groupRecords);
    const skills = summarize(countedGroup.map((record) => record.skill));
    const names = groupRecords.map((record) =>
      record.status === "Duplicate" ? `${record.name} (duplicate)` : record.name
    ).join(", ");
    return `
      <tr>
        <td>${escapeHtml(first.date)}</td>
        <td>${escapeHtml(reportingDepartment(first))}</td>
        <td>${escapeHtml(first.line)}</td>
        <td>${escapeHtml(first.shift)}</td>
        <td>${countedGroup.length}</td>
        <td>${escapeHtml(skills)}</td>
      <td>${escapeHtml(names)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7">No compiled data yet.</td></tr>`;
}

function renderDashboard() {
  const date = $("dashboardDate").value || today;
  const rows = departmentDashboardRows(date);
  const presentTotal = rows.reduce((sum, row) => sum + row.present, 0);
  const targetTotal = rows.reduce((sum, row) => sum + row.target, 0);
  const lowTotal = rows.reduce((sum, row) => sum + Math.max(row.target - row.present, 0), 0);
  const extraTotal = rows.reduce((sum, row) => sum + Math.max(row.present - row.target, 0), 0);
  const selected = rows.find((row) => row.department === selectedDashboardDept) || rows[0] || null;

  $("dashboardPresent").textContent = presentTotal;
  $("dashboardTarget").textContent = targetTotal;
  $("dashboardLow").textContent = lowTotal;
  $("dashboardExtra").textContent = extraTotal;
  $("dashboardDeptCount").textContent = `${rows.length} Dept.`;
  $("dashboardMixLabel").textContent = date === today ? "Today" : date;

  if (selected && selected.department !== selectedDashboardDept) {
    selectedDashboardDept = selected.department;
  }

  renderDashboardPie(rows, presentTotal);

  $("dashboardDeptCards").innerHTML = rows.map((row, index) => {
    const targetPercent = row.target ? Math.min(Math.round((row.present / row.target) * 100), 160) : 0;
    const barWidth = row.target ? Math.min(targetPercent, 100) : row.present ? 100 : 0;
    return `
      <button class="dept-card ${row.department === selectedDashboardDept ? "active" : ""}" type="button" data-dashboard-dept="${escapeHtml(row.department)}" style="--accent:${colorForIndex(index)}">
        <span class="dept-topline">
          <strong>${escapeHtml(row.department)}</strong>
          <em class="status ${statusClass(row.status)}">${escapeHtml(row.status)}</em>
        </span>
        <span class="dept-numbers">
          <b>${row.present}</b>
          <small>/ ${row.target || "No target"}</small>
        </span>
        <span class="dept-progress"><i style="width:${barWidth}%"></i></span>
        <span class="dept-footer">
          <small>${row.lines} lines</small>
          <small>${row.target ? `${row.difference >= 0 ? "+" : ""}${row.difference}` : "set target"}</small>
        </span>
      </button>
    `;
  }).join("") || `<div class="stack-empty">No department data available.</div>`;

  renderDashboardDetail(selected);
  renderDashboardTrend(date);
}

function renderDashboardPie(rows, presentTotal) {
  const activeRows = rows
    .map((row, index) => ({ ...row, colorIndex: index }))
    .filter((row) => row.present > 0);
  let angle = 0;
  const slices = activeRows.map((row, index) => {
    const size = presentTotal ? (row.present / presentTotal) * 360 : 0;
    const start = angle;
    const end = angle + size;
    angle = end;
    return `${colorForIndex(row.colorIndex)} ${start}deg ${end}deg`;
  });
  const chartFill = slices.length
    ? `conic-gradient(${slices.join(", ")})`
    : "conic-gradient(#dce5e8 0deg 360deg)";

  $("dashboardPie").style.background = `
    radial-gradient(circle at center, #ffffff 0 56%, transparent 57%),
    ${chartFill}
  `;
  $("dashboardPie").classList.toggle("empty", !activeRows.length);
  $("dashboardPieTotal").textContent = presentTotal;
  $("dashboardPieLegend").innerHTML = rows.map((row, index) => {
    const percent = presentTotal ? Math.round((row.present / presentTotal) * 100) : 0;
    return `
      <button type="button" data-pie-dept="${escapeHtml(row.department)}" class="${row.department === selectedDashboardDept ? "active" : ""}">
        <i style="background:${colorForIndex(index)}"></i>
        <span>${escapeHtml(row.department)}</span>
        <strong>${row.present}</strong>
        <small>${percent}%</small>
      </button>
    `;
  }).join("") || `<div class="stack-empty">No present count available.</div>`;
}

function renderDashboardDetail(row) {
  if (!row) {
    $("dashboardDetailTitle").textContent = "Department Detail";
    $("dashboardDetailMeta").textContent = "No department data available.";
    $("dashboardDetailStatus").textContent = "No target";
    $("dashboardDetailStatus").className = "status pending";
    $("dashboardTargetRing").innerHTML = `<strong>0%</strong><span>target</span>`;
    $("dashboardInsight").innerHTML = "";
    $("dashboardDetailRows").innerHTML = `<tr><td colspan="4">No details available.</td></tr>`;
    return;
  }

  const date = $("dashboardDate").value || today;
  const records = countedRecords(dashboardRecords(date))
    .filter((record) => reportingDepartment(record) === row.department);
  const ringPercent = row.target ? Math.min(Math.round((row.present / row.target) * 100), 160) : 0;
  const ringDisplay = row.target ? `${Math.min(ringPercent, 999)}%` : "--";

  $("dashboardDetailTitle").textContent = row.department;
  $("dashboardDetailMeta").textContent = `${date} · ${row.present} present · ${row.target || "target not set"} target`;
  $("dashboardDetailStatus").textContent = row.status;
  $("dashboardDetailStatus").className = `status ${statusClass(row.status)}`;
  $("dashboardTargetRing").style.setProperty("--ring", `${Math.min(ringPercent, 100) * 3.6}deg`);
  $("dashboardTargetRing").innerHTML = `<strong>${ringDisplay}</strong><span>target</span>`;
  $("dashboardInsight").innerHTML = `
    <div><span>Present</span><strong>${row.present}</strong></div>
    <div><span>Target</span><strong>${row.target || "Not set"}</strong></div>
    <div><span>Difference</span><strong>${row.target ? `${row.difference >= 0 ? "+" : ""}${row.difference}` : "-"}</strong></div>
    <div><span>Lines</span><strong>${row.lines}</strong></div>
  `;

  const groups = new Map();
  records.forEach((record) => {
    const key = `${record.line}::${record.shift}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  $("dashboardDetailRows").innerHTML = [...groups.entries()].map(([key, groupRecords]) => {
    const [line, shift] = key.split("::");
    const names = groupRecords.map((record) => record.name).join(", ");
    return `
      <tr>
        <td>${escapeHtml(line)}</td>
        <td>${escapeHtml(shift)}</td>
        <td>${groupRecords.length}</td>
        <td>${escapeHtml(names)}</td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="4">No attendance for this department on selected date.</td></tr>`;
}

function renderDashboardTrend(endDate = $("dashboardDate").value || today) {
  const departments = departmentNames();
  const dates = trendDates(endDate);
  const dayRows = dates.map((date) => {
    const counted = countedRecords(dashboardRecords(date));
    const counts = Object.fromEntries(departments.map((department) => [department, 0]));
    counted.forEach((record) => {
      const department = reportingDepartment(record);
      counts[department] = (counts[department] || 0) + 1;
    });
    return {
      date,
      counts,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0)
    };
  });
  const max = Math.max(...dayRows.map((row) => row.total), 1);

  $("dashboardTrendTotal").textContent = `${dayRows.reduce((sum, row) => sum + row.total, 0)} in 14 days`;
  $("dashboardTrend").innerHTML = dayRows.map((row) => `
    <button class="stack-row ${row.date === endDate ? "active" : ""}" type="button" data-trend-date="${escapeHtml(row.date)}">
      <span>${escapeHtml(row.date.slice(5))}</span>
      <div class="stack-track" title="${escapeHtml(`${row.date}: ${row.total}`)}">
        <div class="stack-fill" style="width:${(row.total / max) * 100}%">
          ${departments.map((department, index) => {
            const count = row.counts[department] || 0;
            const width = row.total ? (count / row.total) * 100 : 0;
            return count ? `<i style="width:${width}%;background:${colorForIndex(index)}" title="${escapeHtml(`${department}: ${count}`)}"></i>` : "";
          }).join("")}
        </div>
      </div>
      <strong>${row.total}</strong>
    </button>
  `).join("") || `<div class="stack-empty">No trend data available.</div>`;

  $("dashboardLegend").innerHTML = departments.map((department, index) => `
    <span><i style="background:${colorForIndex(index)}"></i>${escapeHtml(department)}</span>
  `).join("");
}

function renderBlacklist() {
  const rows = blacklistRows();
  $("blacklistRows").innerHTML = rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.operator.code)}</td>
      <td>${escapeHtml(item.operator.name)}</td>
      <td>${escapeHtml(reportingDepartment(item.operator))}</td>
      <td>${escapeHtml(item.operator.line)}</td>
      <td>${item.workingSessions}</td>
      <td>${item.absentCount}</td>
      <td><span class="status risk">${item.absentPercent}%</span></td>
      <td>${escapeHtml(item.absentSessions.map(absentSessionLabel).join(", "))}</td>
    </tr>
  `).join("") || `<tr><td colspan="8">No one is above 20% absenteeism for recorded line sessions.</td></tr>`;
}

function historyRecords() {
  const fromDate = $("historyFromDate").value || "0000-01-01";
  const toDate = $("historyToDate").value || "9999-12-31";
  const department = $("historyDepartmentSelect").value || "all";
  const line = $("historyLineSelect").value || "all";
  const shift = $("historyShiftSelect").value || "all";
  const search = $("historySearch").value.trim().toLowerCase();

  return scopedAttendance()
    .filter((record) => record.date >= fromDate && record.date <= toDate)
    .filter((record) => department === "all" || reportingDepartment(record) === department)
    .filter((record) => line === "all" || record.line === line)
    .filter((record) => shift === "all" || record.shift === shift)
    .filter((record) => {
      if (!search) return true;
      return [record.code, record.name, record.skill, record.currentProcess]
        .some((value) => String(value || "").toLowerCase().includes(search));
    })
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
}

function renderHistory() {
  const records = historyRecords();
  const counted = countedRecords(records);
  const days = new Set(records.map((record) => record.date));
  const lines = new Set(records.map((record) => groupKey(record)));

  $("historyTotal").textContent = counted.length;
  $("historyDays").textContent = days.size;
  $("historyLines").textContent = lines.size;

  $("historyRows").innerHTML = records.map((record) => `
    <tr class="${record.status === "Duplicate" ? "duplicate-row" : ""}">
      <td>${escapeHtml(record.date)}</td>
      <td>${escapeHtml(record.time)}</td>
      <td>${escapeHtml(record.code)}</td>
      <td>${escapeHtml(record.name)}</td>
      <td>${escapeHtml(reportingDepartment(record))}</td>
      <td>${escapeHtml(record.line)}</td>
      <td>${escapeHtml(record.shift)}</td>
      <td>${escapeHtml(record.currentProcess || record.skill)}</td>
      <td>${escapeHtml(record.supervisor)}</td>
      <td><span class="status ${record.status === "Duplicate" ? "duplicate" : "present"}">${escapeHtml(record.status === "Duplicate" ? "Duplicate - counted once" : record.source || record.status)}</span></td>
    </tr>
  `).join("") || `<tr><td colspan="10">No attendance found for selected filters.</td></tr>`;
}

function renderMaster() {
  const search = $("masterSearch").value.trim().toLowerCase();
  const operators = state.operators
    .filter((op) => {
      if (!search) return true;
      return [op.code, op.name, op.skill, reportingDepartment(op), op.department, op.line]
        .some((value) => String(value || "").toLowerCase().includes(search));
    })
    .sort((a, b) => String(a.code).localeCompare(String(b.code), undefined, { numeric: true }));

  $("masterTotal").textContent = state.operators.length;
  $("masterPending").textContent = state.operators.filter((op) => op.detailsPending).length;
  $("masterRows").innerHTML = operators.map((op) => `
    <tr>
      <td>${escapeHtml(op.code)}</td>
      <td>${escapeHtml(op.name)}</td>
      <td>${escapeHtml(op.skill)}</td>
      <td>${escapeHtml(reportingDepartment(op))}</td>
      <td>${escapeHtml(op.line)}</td>
      <td>${escapeHtml(op.doj || "")}</td>
      <td>${escapeHtml(op.skillLevel || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="7">No matching master records found.</td></tr>`;
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
      <td>
        <div class="row-actions">
          <button class="mini-btn" data-edit-user="${escapeHtml(user.id)}">Modify</button>
          ${canRemoveUser(user, adminCount) ? `<button class="mini-btn danger-mini" data-remove-user="${escapeHtml(user.id)}">Remove</button>` : ""}
        </div>
      </td>
    </tr>
  `).join("");
}

function canRemoveUser(user, adminCount = state.users.filter((item) => item.role === "admin").length) {
  if (currentUser?.id === user.id) return false;
  if (user.role === "admin" && adminCount <= 1) return false;
  return true;
}

function canSaveUserChange(previousUser, nextUser) {
  if (!previousUser) return true;
  const adminCount = state.users.filter((user) => user.role === "admin").length;
  const removingAdminAccess = previousUser.role === "admin" && nextUser.role !== "admin";
  if (removingAdminAccess && adminCount <= 1) {
    showToast("Keep at least one admin login active.");
    return false;
  }
  if (previousUser.id === currentUser?.id && nextUser.role !== "admin") {
    showToast("You cannot remove admin access from your current login.");
    return false;
  }
  if (previousUser.id === currentUser?.id && previousUser.id !== nextUser.id) {
    showToast("Current login User ID cannot be changed while you are using it.");
    return false;
  }
  return true;
}

function renderAll() {
  renderAttendance();
  renderAdmin();
  renderDashboard();
  renderHistory();
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
    ["Date", "Time", "Emp. ID", "Name", "Deployed Dept.", "Deployed Line", "Home Dept.", "Home Line", "Current Process", "Skill Level", "DOJ", "Issued Date", "Renew Date", "Shift", "Line Leader", "Leader Login", "Count Status", "Entry Source"]
  ];
  scopedAttendance().forEach((record) => {
    rows.push([
      record.date,
      record.time,
      record.code,
      record.name,
      reportingDepartment(record),
      record.line,
      reportingHomeDepartment(record),
      record.homeLine || record.line,
      record.currentProcess || record.skill,
      record.skillLevel || "",
      record.doj || "",
      record.issuedDate || "",
      record.renewDate || "",
      record.shift,
      record.supervisor,
      record.leaderId || "",
      record.status || "Present",
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
      reportingDepartment(item.operator),
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

function exportHistory() {
  const rows = [
    ["Date", "Time", "Emp. ID", "Name", "Deployed Department", "Deployed Line", "Home Department", "Home Line", "Shift", "Current Process", "Line Leader", "Leader Login", "Count Status", "Entry Source"]
  ];
  historyRecords().forEach((record) => {
    rows.push([
      record.date,
      record.time,
      record.code,
      record.name,
      reportingDepartment(record),
      record.line,
      reportingHomeDepartment(record),
      record.homeLine || record.line,
      record.shift,
      record.currentProcess || record.skill,
      record.supervisor,
      record.leaderId || "",
      record.status || "Present",
      record.source || "Skill Card"
    ]);
  });

  const html = `
    <html><head><meta charset="utf-8"></head><body>
      <table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</table>
    </body></html>
  `;
  download(`plant-attendance-history-${today}.xls`, html, "application/vnd.ms-excel");
}

function downloadMasterTemplate() {
  const rows = [
    ["emp_id", "name", "department", "line", "current_process", "doj", "skill_level", "issued_date", "renew_date"],
    ["101838", "Pranav Kashinath Patil", "Production", "LPC", "C&C", "30-09-2025", "", "10-07-26", "08-10-26"]
  ];
  download(`hr-operator-master-template-${today}.csv`, csvFromRows(rows), "text/csv;charset=utf-8");
}

function csvFromRows(rows) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  return `\uFEFF${csv}\n`;
}

function csvCell(value) {
  const clean = String(value ?? "");
  return /[",\n\r]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
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

function operatorsFromMasterRows(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(normalizeFieldName);
  const hasHeader = header.some((cell) => ["empid", "code", "employeeid"].includes(cell))
    && header.some((cell) => ["name", "operatorname", "nameofoperator"].includes(cell));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  return dataRows
    .map((row) => hasHeader ? operatorFromHeaderRow(row, header) : operatorFromOrderedRow(row))
    .filter(Boolean);
}

function operatorFromHeaderRow(row, header) {
  const fields = Object.fromEntries(header.map((key, index) => [key, row[index] || ""]));
  return normalizeReferenceOperator({
    code: readScannedField(fields, ["empid", "code", "employeeid", "operatorid", "id"]),
    name: readScannedField(fields, ["name", "operatorname", "nameofoperator"]),
    department: readScannedField(fields, ["department", "dept", "deptname"]),
    line: readScannedField(fields, ["line", "linename"]),
    skill: readScannedField(fields, ["currentprocess", "process", "skill"]),
    doj: readScannedField(fields, ["doj", "dateofjoining"]),
    skillLevel: readScannedField(fields, ["skilllevel", "level"]),
    issuedDate: readScannedField(fields, ["issueddate", "issuedate", "issued"]),
    renewDate: readScannedField(fields, ["renewdate", "renewaldate", "renew"])
  });
}

function operatorFromOrderedRow([code, name, department, line, skill, doj = "", skillLevel = "", issuedDate = "", renewDate = ""]) {
  return normalizeReferenceOperator({ code, name, department, line, skill, doj, skillLevel, issuedDate, renewDate });
}

function normalizeReferenceOperator(operator) {
  const splitContext = splitDepartmentLine(operator.department, operator.line);
  const cleanOperator = {
    code: cleanScannedValue(operator.code),
    name: cleanScannedValue(operator.name),
    department: reportingDepartmentName(splitContext.department, splitContext.line),
    line: splitContext.line,
    skill: cleanScannedValue(operator.skill) || "Not specified",
    doj: cleanScannedValue(operator.doj),
    skillLevel: cleanScannedValue(operator.skillLevel),
    issuedDate: cleanScannedValue(operator.issuedDate),
    renewDate: cleanScannedValue(operator.renewDate),
    detailsPending: false
  };
  if (!cleanOperator.code || !cleanOperator.name || !cleanOperator.department || !cleanOperator.line) return null;
  return cleanOperator;
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
    ? `${reportingDepartmentName(currentUser.department, currentUser.line)} / ${currentUser.line}`
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
$("dashboardDate").addEventListener("change", renderAll);
$("targetDeptSelect").addEventListener("change", () => {
  selectedDashboardDept = $("targetDeptSelect").value;
  updateTargetInput();
  renderDashboard();
});
$("saveTargetBtn").addEventListener("click", () => {
  const department = $("targetDeptSelect").value;
  if (!department) {
    showToast("Select department for target.");
    return;
  }
  setDepartmentTarget(department, $("targetValueInput").value);
  saveState();
  refreshTargetDepartmentSelect();
  renderAll();
  showToast("Department target saved.");
});
$("dashboardDeptCards").addEventListener("click", (event) => {
  const card = event.target.closest("[data-dashboard-dept]");
  if (!card) return;
  selectedDashboardDept = card.dataset.dashboardDept;
  $("targetDeptSelect").value = selectedDashboardDept;
  updateTargetInput();
  renderDashboard();
});
$("dashboardPieLegend").addEventListener("click", (event) => {
  const item = event.target.closest("[data-pie-dept]");
  if (!item) return;
  selectedDashboardDept = item.dataset.pieDept;
  $("targetDeptSelect").value = selectedDashboardDept;
  updateTargetInput();
  renderDashboard();
});
$("dashboardPie").addEventListener("click", () => {
  const rows = departmentDashboardRows();
  const topRow = rows.find((row) => row.present > 0) || rows[0];
  if (!topRow) return;
  selectedDashboardDept = topRow.department;
  $("targetDeptSelect").value = selectedDashboardDept;
  updateTargetInput();
  renderDashboard();
});
$("dashboardTrend").addEventListener("click", (event) => {
  const row = event.target.closest("[data-trend-date]");
  if (!row) return;
  $("dashboardDate").value = row.dataset.trendDate;
  renderAll();
});
document.querySelectorAll("[data-kpi]").forEach((button) => {
  button.addEventListener("click", () => {
    const rows = departmentDashboardRows();
    const mode = button.dataset.kpi;
    const targetRow = mode === "low"
      ? rows.find((row) => row.status === "Low")
      : mode === "extra"
        ? rows.find((row) => row.status === "Extra")
        : rows.sort((a, b) => b.present - a.present)[0];
    if (!targetRow) return;
    selectedDashboardDept = targetRow.department;
    $("targetDeptSelect").value = selectedDashboardDept;
    updateTargetInput();
    renderDashboard();
  });
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
$("downloadMasterTemplateBtn").addEventListener("click", downloadMasterTemplate);
$("downloadHistoryBtn").addEventListener("click", exportHistory);
$("historyDepartmentSelect").addEventListener("change", () => refreshHistoryLines());
["historyFromDate", "historyToDate", "historyLineSelect", "historyShiftSelect"].forEach((id) => {
  $(id).addEventListener("change", renderAll);
});
$("historySearch").addEventListener("input", renderAll);
$("masterSearch").addEventListener("input", renderAll);

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
  const importedOperators = operatorsFromMasterRows(rows);
  if (!importedOperators.length) {
    $("masterUploadStatus").textContent = "No valid rows found. Keep emp_id, name, department and line filled.";
    event.target.value = "";
    showToast("Master upload needs valid operator rows.");
    return;
  }

  const result = importReferenceOperators(importedOperators);
  saveState();
  refreshFilters();
  renderAll();
  $("masterUploadStatus").textContent =
    `${result.total} rows processed: ${result.added} added, ${result.updated} updated. ID-only scans can now use these details.`;
  event.target.value = "";
  showToast(`${result.total} master records uploaded.`);
});

function userFromLoginForm() {
  return {
    name: $("newLoginName").value.trim(),
    id: $("newLoginId").value.trim(),
    password: $("newLoginPass").value.trim(),
    role: $("newLoginRole").value,
    department: $("newLoginDept").value.trim() || "All",
    line: $("newLoginLine").value.trim() || "All"
  };
}

function clearLoginForm() {
  ["newLoginName", "newLoginId", "newLoginPass", "newLoginDept", "newLoginLine"].forEach((id) => $(id).value = "");
  $("newLoginRole").value = "supervisor";
  editingUserId = "";
  $("addUserBtn").textContent = "Create Login";
  $("cancelUserEditBtn").classList.add("hidden");
}

function setLoginFormForEdit(user) {
  editingUserId = user.id;
  $("newLoginName").value = user.name || "";
  $("newLoginId").value = user.id || "";
  $("newLoginPass").value = user.password || "";
  $("newLoginRole").value = user.role || "supervisor";
  $("newLoginDept").value = user.department || "All";
  $("newLoginLine").value = user.line || "All";
  $("addUserBtn").textContent = "Save Changes";
  $("cancelUserEditBtn").classList.remove("hidden");
  $("newLoginName").focus();
}

function saveLoginFromForm() {
  const user = userFromLoginForm();
  const wasEditing = Boolean(editingUserId);
  if (!user.name || !user.id || !user.password) {
    showToast("Enter name, user ID and password.");
    return;
  }
  if (user.role === "supervisor" && (!user.department || user.department === "All" || !user.line || user.line === "All")) {
    showToast("Line leader login needs department and line.");
    return;
  }
  const previousUser = editingUserId
    ? state.users.find((item) => item.id === editingUserId)
    : null;
  const sameIdExists = state.users.some((item) => item.id === user.id && item.id !== editingUserId);
  if (sameIdExists) {
    showToast("This User ID already exists. Modify that login or use another ID.");
    return;
  }
  if (!canSaveUserChange(previousUser, user)) return;
  if (editingUserId && editingUserId !== user.id) {
    state.deletedUserIds = unique([...state.deletedUserIds, editingUserId]);
  }
  state.deletedUserIds = state.deletedUserIds.filter((id) => id !== user.id);
  state.users = state.users.filter((item) => item.id !== (editingUserId || user.id));
  state.users.push(user);
  if (currentUser?.id === editingUserId || currentUser?.id === user.id) {
    currentUser = user;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
    applyLoginState();
  }
  clearLoginForm();
  saveState();
  renderAll();
  showToast(wasEditing ? "Login updated." : "Login created.");
}

$("addUserBtn").addEventListener("click", saveLoginFromForm);
$("cancelUserEditBtn").addEventListener("click", clearLoginForm);

$("userRows").addEventListener("click", (event) => {
  const editId = event.target.dataset.editUser;
  if (editId) {
    const user = state.users.find((item) => item.id === editId);
    if (!user) {
      showToast("Login not found.");
      renderUsers();
      return;
    }
    setLoginFormForEdit(user);
    showToast(`Editing login ${editId}.`);
    return;
  }

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
  if (editingUserId === id) clearLoginForm();
  saveState();
  renderUsers();
});

window.addEventListener("online", () => {
  if (refreshToday()) renderAll();
  if (pendingSync) loadServerState();
});

window.addEventListener("focus", () => {
  if (refreshToday()) renderAll();
  if (pendingSync) loadServerState();
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && refreshToday()) renderAll();
  if (!document.hidden && pendingSync) loadServerState();
});

setInterval(() => {
  if (refreshToday()) renderAll();
}, 60_000);

refreshFilters();
applyLoginState();
renderAll();
loadServerState();
