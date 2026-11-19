import { parseCsv, toCsv } from './csv.js';

// One row per award, not per student — bonus accumulates over the
// semester (per instructor: typically 1 point at a time, across up to
// three separate class sessions, awarded by whichever instructor is
// teaching that day). EntryID is the stable key used to edit/clear a
// single award without touching a student's other entries. MeetingDate
// ties each award to the class session it was given in (like
// participation.js's meetingDate), recorded positionally — see
// listMeetingDates/getPointsForDate, used by views/bonus-by-date.js.
// Category records whether that session was Theory or Lab — purely a
// descriptive tag (like written-activity.js's Sitting), it never gates or
// changes the award's limit. Missing on older rows (added after this
// column existed) reads as '', same as MeetingDate.
export const BONUS_HEADERS = [
  'StudentID',
  'EntryID',
  'Points',
  'MeetingDate',
  'Category',
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
    category: r.Category || '',
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
    Category: r.category || '',
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

// Distinct non-blank categories among a student's awards on one date, for
// views/bonus-by-date.js to tag a summed cell — e.g. a date with both a
// Theory and a Lab award for the same student surfaces both, an
// uncategorized (legacy) award contributes nothing.
export function listBonusCategoriesForDate(rows, studentId, meetingDate) {
  const categories = new Set(
    rows
      .filter((r) => r.studentId === studentId && r.meetingDate === meetingDate)
      .map((r) => r.category)
      .filter(Boolean)
  );
  return [...categories].sort();
}

export function addBonusEntry(rows, studentId, { points, meetingDate, category, recordedBy, now }) {
  return [
    ...rows,
    {
      studentId,
      entryId: crypto.randomUUID(),
      points,
      meetingDate: meetingDate || '',
      category: category || '',
      recordedAt: now,
      recordedBy,
      modifiedAt: now,
      modifiedBy: recordedBy,
    },
  ];
}

// Mirrors written-activity.js's upsertWrittenActivity: keeps the original
// recordedAt/recordedBy, only bumps modifiedAt/modifiedBy — but scoped to
// one entry (by entryId) rather than one row per student. meetingDate and
// category are optional so callers that only touch points (e.g. restoring
// via Undo) don't need to pass them explicitly.
export function updateBonusEntry(rows, entryId, { points, meetingDate, category, recordedBy, now }) {
  return rows.map((r) =>
    r.entryId === entryId
      ? {
          ...r,
          points,
          meetingDate: meetingDate === undefined ? r.meetingDate : meetingDate,
          category: category === undefined ? r.category : category,
          modifiedAt: now,
          modifiedBy: recordedBy,
        }
      : r
  );
}

export function removeBonusEntry(rows, entryId) {
  return rows.filter((r) => r.entryId !== entryId);
}

// How many more bonus points a student can receive. Bonus is limited only
// by the configured bonus maximum (config.bonus.max), shared by Theory and
// Lab awards — never by the points earned in participation or the written
// activity. The in-class performance cap is applied to the final total in
// the Grades view instead (grades-summary.js's adjustedTotal), so bonus
// can make up for points lost elsewhere. `excludeEntryId` leaves one award
// out of the running total, for editing that award in History.
export function bonusRoomLeft(rows, studentId, max, { excludeEntryId } = {}) {
  const others = listBonusEntries(rows, studentId).filter((r) => r.entryId !== excludeEntryId);
  const total = others.reduce((sum, r) => sum + r.points, 0);
  return Math.max(0, max - total);
}

export class BonusLimitError extends Error {
  constructor(studentId, max) {
    super(`${studentId} would have more than the ${max}-point bonus maximum.`);
    this.name = 'BonusLimitError';
  }
}

// Save-time guard, run inside saveWithRetry's mutate so it also covers the
// retry on fresh data — e.g. a Theory and a Lab instructor awarding the
// same student's last point at the same moment. Only refuses a change that
// *raises* the total above the max, so lowering an award or correcting its
// date/category still works if the max was lowered after awards were given.
export function checkBonusLimit(before, after, studentId, max) {
  const nextTotal = getBonusTotal(after, studentId);
  if (nextTotal > max && nextTotal > getBonusTotal(before, studentId)) {
    throw new BonusLimitError(studentId, max);
  }
}

// `max` is the per-entry room — see views/bonus-record.js (adding a new
// award) and views/bonus-history.js (editing one, where the room excludes
// that entry's own current points from the running total).
export function validateBonusScore(points, max) {
  if (!Number.isInteger(points)) return 'Score must be a whole number.';
  if (points < 0 || points > max) return `Score must be between 0 and ${max}.`;
  return null;
}
