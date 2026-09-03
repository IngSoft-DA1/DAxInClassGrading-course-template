import { parseCsv, toCsv } from './csv.js';

export const WRITTEN_ACTIVITY_HEADERS = [
  'StudentID',
  'Points',
  'Sitting',
  'RecordedAt',
  'RecordedBy',
  'ModifiedAt',
  'ModifiedBy',
];

export function parseWrittenActivityCsv(text) {
  const { rows } = parseCsv(text);
  return rows.map((r) => ({
    studentId: r.StudentID,
    points: Number(r.Points),
    sitting: r.Sitting || '',
    recordedAt: r.RecordedAt || '',
    recordedBy: r.RecordedBy || '',
    modifiedAt: r.ModifiedAt || '',
    modifiedBy: r.ModifiedBy || '',
  }));
}

export function writtenActivityToCsv(rows) {
  const csvRows = rows.map((r) => ({
    StudentID: r.studentId,
    Points: r.points,
    Sitting: r.sitting,
    RecordedAt: r.recordedAt,
    RecordedBy: r.recordedBy,
    ModifiedAt: r.modifiedAt,
    ModifiedBy: r.modifiedBy,
  }));
  return toCsv(csvRows, WRITTEN_ACTIVITY_HEADERS);
}

export function getWrittenActivity(rows, studentId) {
  return rows.find((r) => r.studentId === studentId) || null;
}

// Mirrors participation.js's upsertScore: keeps the original recordedAt/
// recordedBy if an entry already existed (a correction — e.g. switching
// which sitting produced the score — not a first entry) so the original
// recorder stays attributed; modifiedAt/modifiedBy always reflect the most
// recent edit.
export function upsertWrittenActivity(rows, studentId, { points, sitting, recordedBy, now }) {
  const next = rows.filter((r) => r.studentId !== studentId);
  const existing = rows.find((r) => r.studentId === studentId);
  next.push({
    studentId,
    points,
    sitting,
    recordedAt: existing ? existing.recordedAt : now,
    recordedBy: existing ? existing.recordedBy : recordedBy,
    modifiedAt: now,
    modifiedBy: recordedBy,
  });
  return next;
}

export function clearWrittenActivity(rows, studentId) {
  return rows.filter((r) => r.studentId !== studentId);
}

export function validateWrittenActivityScore(points, max) {
  if (!Number.isInteger(points)) return 'Score must be a whole number.';
  if (points < 0 || points > max) return `Score must be between 0 and ${max}.`;
  return null;
}

// Once a student has a score recorded for one sitting, switching them to
// the other sitting is always blocked — not just first -> second (the
// second sitting exists only to recover points for a student who missed
// the first one entirely, SPEC §3.1.2), but second -> first too, since
// that transition is indistinguishable from an instructor genuinely
// overwriting a real make-up record with different content, not just
// fixing a mis-click. Correcting the points within the *same* sitting is
// still always allowed; switching sittings requires clearing the entry
// first (views/written-activity.js's Clear) and recording it fresh.
export function isSittingChangeAllowed(existing, sitting) {
  if (!existing) return true;
  return existing.sitting === sitting;
}
