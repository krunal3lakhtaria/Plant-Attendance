# Permanent Production Deployment

This version keeps the existing app UI but moves shared plant data into Postgres through Vercel API routes.

## What Stays Safe

- Current local app is not deleted.
- Current data was backed up before production changes:
  - `../backups/attendance-backup-20260804-003005.json`
  - `../backups/plant-attendance-app-backup-20260804-003005/`
- The GitHub repository intentionally excludes `data/attendance.json`.
- Vercel/Postgres storage merges attendance records instead of replacing the full file, so simultaneous line-leader scans are protected from accidental overwrite.

## Production Stack

- GitHub: source code
- Vercel: app hosting and API routes
- Neon Postgres or Supabase Postgres: permanent database

## Database

Create a Postgres database and copy its connection string.

The required Vercel environment variable is:

```text
DATABASE_URL
```

The app creates its table automatically:

```sql
CREATE TABLE IF NOT EXISTS app_state (
  id text PRIMARY KEY,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

## Import Existing Data

From this folder, run:

```bash
DATABASE_URL="your_postgres_connection_string" npm install
DATABASE_URL="your_postgres_connection_string" npm run import:data -- ../backups/attendance-backup-20260804-003005.json
```

This imports:

- operator master
- attendance records
- admin and line-leader logins
- blacklist/query history inputs that are stored in attendance data

## GitHub

Create a private GitHub repository, then push this folder:

```bash
git remote add github YOUR_GITHUB_REPO_URL
git push github main
```

## Vercel

1. Open Vercel.
2. Add New Project.
3. Import the GitHub repository.
4. Add `DATABASE_URL` in Project Settings > Environment Variables.
5. Deploy.

After deployment and data import, open the Vercel URL and log in with the imported admin account.

## Important Production Notes

- Do not commit real operator data or passwords to GitHub.
- Change imported/default passwords before plant use.
- Keep the GitHub repo private.
- Use one shared Postgres database for all supervisors and admin users.
- Schedule database backups in Neon/Supabase.
- Do not use the old direct `file://index.html` path for production.
