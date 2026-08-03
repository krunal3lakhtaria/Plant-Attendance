const { Pool } = require("pg");

const pool = globalThis.__plantAttendancePool || new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});
globalThis.__plantAttendancePool = pool;

const DEFAULT_STATE = {
  operators: [],
  attendance: [],
  users: [],
  deletedAttendanceIds: [],
  deletedUserIds: [],
  deletedOperatorIds: []
};

module.exports = async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL) {
      res.status(500).json({ error: "DATABASE_URL is not configured" });
      return;
    }

    await ensureSchema();

    if (req.method === "GET") {
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(await readState());
      return;
    }

    if (req.method === "POST") {
      const incoming = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
      const existing = await readState();
      const merged = mergeState(existing, normalizeState(incoming));
      await writeState(merged);
      res.status(200).json({ ok: true, counts: countState(merged) });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id text PRIMARY KEY,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    INSERT INTO app_state (id, state)
    VALUES ('primary', $1::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [JSON.stringify(DEFAULT_STATE)]);
}

async function readState() {
  const result = await pool.query("SELECT state FROM app_state WHERE id = 'primary'");
  return normalizeState(result.rows[0]?.state || DEFAULT_STATE);
}

async function writeState(state) {
  await pool.query(`
    UPDATE app_state
    SET state = $1::jsonb, updated_at = now()
    WHERE id = 'primary'
  `, [JSON.stringify(normalizeState(state))]);
}

function normalizeState(state = {}) {
  return {
    operators: Array.isArray(state.operators) ? state.operators : [],
    attendance: Array.isArray(state.attendance) ? state.attendance : [],
    users: Array.isArray(state.users) ? state.users : DEFAULT_STATE.users,
    deletedAttendanceIds: Array.isArray(state.deletedAttendanceIds) ? state.deletedAttendanceIds : [],
    deletedUserIds: Array.isArray(state.deletedUserIds) ? state.deletedUserIds : [],
    deletedOperatorIds: Array.isArray(state.deletedOperatorIds) ? state.deletedOperatorIds : []
  };
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
  const operators = upsertBy(existing.operators, incoming.operators, (item) => item.code)
    .filter((operator) => !deletedOperatorIds.has(String(operator.code).toLowerCase()));
  const users = upsertBy(existing.users, incoming.users, (item) => item.id)
    .filter((user) => !deletedUserIds.has(user.id) || user.id === "admin");
  const attendance = upsertBy(existing.attendance, incoming.attendance, (item) => item.id)
    .filter((record) => !deletedAttendanceIds.has(record.id));

  return {
    operators,
    users,
    attendance,
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

function countState(state) {
  return {
    operators: state.operators.length,
    attendance: state.attendance.length,
    users: state.users.length
  };
}
