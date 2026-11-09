# Course data repository

This repository stores persistent data for a course session managed by
[DAxInClassGrading](https://github.com/IngSoft-DA1/DAxInClassGrading) — the
maintainer-facing repo where the app is developed. This repo is what an
instructor actually works with day to day; see
[`INSTRUCTOR_GUIDE.md`](INSTRUCTOR_GUIDE.md) for how to use it.

Do not edit files here by hand unless you know what you're doing — the app
reads and writes `config/course.json`, `students/roster.csv`,
`students/photos/`, and files under `grades/` directly. Manual edits that
don't match the expected format may confuse the app.

## Layout

- `config/course.json` — course session id, org, and grading configuration
  (Theory/Lab participation, Written Activity, and Bonus point maximums).
- `students/roster.csv` — the student roster.
- `students/photos/<studentId>.jpg` — one photo per student, purely to help
  an instructor recognize/remember students; not part of the roster and
  doesn't affect grading (created as needed).
- `grades/participation.csv` — one row per student with their Theory and
  Lab oral-participation scores, including whether either was an absence
  (created as needed).
- `grades/participation-audit-log.csv` — append-only log of every Theory/Lab
  score entered or corrected, powering the read-only participation history
  view (created as needed).
- `grades/written-activity.csv` — one row per student with their written
  activity score and which sitting (official or make-up) produced it
  (created as needed).
- `grades/bonus.csv` — one row per bonus award (a student can have several
  over the semester); their bonus score is the sum of their rows (created
  as needed).
- `grades/summary.csv` — a generated snapshot of the consolidated grades
  view, written only when an instructor explicitly exports it (not a source
  of truth — regenerated from the files above on every export).
- `scripts/update-from-template.sh` / `.ps1` — optional: pulls this repo's
  app code (`index.html`, `assets/`, the Pages deploy workflow — nothing
  else) up to date from the published course template. See
  [`INSTRUCTOR_GUIDE.md`](INSTRUCTOR_GUIDE.md) for details.
- `INSTRUCTOR_GUIDE.md` — the step-by-step guide for instructors using this
  repo's deployed app.
