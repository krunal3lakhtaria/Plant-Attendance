# Plant Attendance App

This is a first working version for fast daily manpower attendance.

Production source does not include real attendance data or login passwords. Import users and operator data into Postgres before plant use.

For permanent GitHub + Vercel + Postgres deployment, use:

```text
PRODUCTION_DEPLOYMENT.md
```

## Start the app

Run this inside the `plant-attendance-app` folder:

```bash
node server.js
```

Open this URL, not the direct `index.html` file:

```text
http://127.0.0.1:4174
```

For plant network use, IT can run it on a shared computer or server and set `HOST=0.0.0.0` so supervisors and admin can open the same app from their devices.

## Daily flow

1. Admin creates department-wise and line-leader-wise logins.
2. Line leader logs in once. Their department and line are locked automatically.
3. Line leader scans skill cards continuously. Each scan is saved instantly as present.
4. If an operator forgot the skill card, punch the ID number and use `Missed Card ID`; details are pulled from master data.
5. Use `Query` to scan or enter an Emp. ID and see that operator's absent days.
6. Open `Blacklist` to see people with more than 20% absenteeism.
7. Admin opens `Admin` to see total plant count, department count, line count, names, skills, and line leader.
8. Use `Download Excel` for the Excel-readable attendance file.
9. Use `Backup` for a full JSON backup of master data, attendance, and logins.

## Absenteeism rule

The app calculates absent days only from recorded attendance sessions for the employee's assigned department and line. A session means a date plus shift where that line has any attendance record.

Example: if `Production / Assembly-K2` has attendance recorded on 10 morning sessions and Emp. ID `303408` is present on 7 of them, the app shows 3 absent sessions and 30% absenteeism. Anyone above 20% appears in `Blacklist`.

## Logins

Production logins are stored in Postgres, not in GitHub source. Import existing users or create the first admin user in the database before plant use.

## Operator master

Open `Master` to add people or import a CSV.

CSV format:

```csv
emp_id,name,department,line,current_process,doj,skill_level,issued_date,renew_date
303408,Sample Operator,Production,Assembly-K2,F/A,14-07-2025,Level 4,23-04-2026,22-07-2026
```

Skill cards can contain only the Emp. ID, such as:

```text
303408
```

They can also contain full operator detail:

```text
303408|Sample Operator|F/A|Production|Assembly-K2|14-07-2025|Level 4|23-04-2026|22-07-2026
```

When a full-detail card is scanned, the app updates the operator master automatically. This keeps daily scan data useful as master memory for future missed-card ID entries.

## Data

Shared data is stored at:

```text
data/attendance.json
```

Keep regular backups from the app or from this file.
