const fs = require("fs");
const { Pool } = require("pg");

const file = process.argv[2] || "data/attendance.json";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(file, "utf8"));
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id text PRIMARY KEY,
      state jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    INSERT INTO app_state (id, state, updated_at)
    VALUES ('primary', $1::jsonb, now())
    ON CONFLICT (id) DO UPDATE
    SET state = EXCLUDED.state, updated_at = now()
  `, [JSON.stringify({
    operators: state.operators || [],
    attendance: state.attendance || [],
    users: state.users || [],
    deletedAttendanceIds: state.deletedAttendanceIds || [],
    deletedUserIds: state.deletedUserIds || []
  })]);
  console.log(`Imported ${state.operators?.length || 0} operators, ${state.attendance?.length || 0} attendance records, ${state.users?.length || 0} users.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
