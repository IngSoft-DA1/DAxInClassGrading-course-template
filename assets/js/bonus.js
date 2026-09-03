import { parseCsv, toCsv } from './csv.js';

// One row per award, not per student — bonus accumulates over the
// semester (per instructor: typically 1 point at a time, across up to
// three separate class sessions, awarded by whichever instructor is
// teaching that day). EntryID is the stable key used to edit/clear a
// single award without touching a student's other entries. MeetingDate
// ties each award to the class session it was given in (like
// participation.js's meetingDate), recorded positionally — see
// listMeetingDates/getPointsForDate, used by views/bonus-by-date.js.
export const BONUS_HEADERS = [
  'StudentID',
  'EntryID',
  'Points',
  'MeetingDate',
  'RecordedAt',
  'RecordedBy',
  'ModifiedAt',
  'ModifiedBy',
];

export function parseBonusCsv(text) {
  const { rows } = parseCsv(text);
  return rows.map((r) => ({
    studentId: r.StudentID,
    entryId: r.EntryID,
    points: Number(r.Points),
    meetingDate: r.MeetingDate || '',
    recordedAt: r.RecordedAt || '',
    recordedBy: r.RecordedBy || '',
    modifiedAt: r.ModifiedAt || '',
    modifiedBy: r.ModifiedBy || '',
  }));
}

export function bonusToCsv(rows) {
  const csvRows = rows.map((r) => ({
    StudentID: r.studentId,
    EntryID: r.entryId,
    Points: r.points,
    MeetingDate: r.meetingDate || '',
    RecordedAt: r.recordedAt,
    RecordedBy: r.recordedBy,
    ModifiedAt: r.modifiedAt,
    ModifiedBy: r.modifiedBy,
  }));
  return toCsv(csvRows, BONUS_HEADERS);
}

export function listBonusEntries(rows, studentId) {
  return rows.filter((r) => r.studentId === studentId);
}

export function getBonusEntry(rows, entryId) {
  return rows.find((r) => r.entryId === entryId) || null;
}

export function getBonusTotal(rows, studentId) {
  return listBonusEntries(rows, studentId).reduce((sum, r) => sum + r.points, 0);
}

// Distinct meeting dates that have at least one award, oldest first —
// the column set for views/bonus-by-date.js. Awards with no meeting date
// recorded (legacy rows, or a cleared date field) don't get a column.
export function listBonusMeetingDates(rows) {
  const dates = new Set(rows.map((r) => r.meetingDate).filter(Boolean));
  return [...dates].sort();
}

// A student can in principle receive more than one award on the same
// date (nothing prevents it — see addBonusEntry) — positional display
// sums them into that date's single cell rather than picking one.
export function getBonusPointsForDate(rows, studentId, meetingDate) {
  return rows
    .filter((r) => r.studentId === studentId && r.meetingDate === meetingDate)
    .reduce((sum, r) => sum + r.points, 0);
}

export function addBonusEntry(rows, studentId, { points, meetingDate, recordedBy, now }) {
  return [
    ...rows,
    {
      studentId,
      entryId: crypto.randomUUID(),
      points,
      meetingDate: meetingDate || '',
      recordedAt: now,
      recordedBy,
      modifiedAt: now,
      modifiedBy: recordedBy,
    },
  ];
}

// Mirrors written-activity.js's upsertWrittenActivity: keeps the original
// recordedAt/recordedBy, only bumps modifiedAt/modifiedBy — but scoped to
// one entry (by entryId) rather than one row per student. meetingDate is
// optional so callers that only touch points (e.g. restoring via Undo)
// don't need to pass it explicitly.
export function updateBonusEntry(rows, entryId, { points, meetingDate, recordedBy, now }) {
  return rows.map((r) =>
    r.entryId === entryId
      ? { ...r, points, meetingDate: meetingDate === undefined ? r.meetingDate : meetingDate, modifiedAt: now, modifiedBy: recordedBy }
      : r
  );
}

export function removeBonusEntry(rows, entryId) {
  return rows.filter((r) => r.entryId !== entryId);
}

// `max` is the per-entry dynamic ceiling — see views/bonus-record.js
// (adding a new award) and views/bonus-history.js (editing one, where the
// ceiling excludes that entry's own current points from the running total).
export function validateBonusScore(points, max) {
  if (!Number.isInteger(points)) return 'Score must be a whole number.';
  if (points < 0 || points > max) return `Score must be between 0 and ${max}.`;
  return null;
}
