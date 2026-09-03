import { parseCsv, toCsv } from './csv.js';

export const PARTICIPATION_HEADERS = [
  'StudentID',
  'TheoryPoints',
  'TheoryAbsent',
  'TheoryMeetingDate',
  'TheoryRecordedAt',
  'TheoryRecordedBy',
  'TheoryModifiedAt',
  'TheoryModifiedBy',
  'LabPoints',
  'LabAbsent',
  'LabMeetingDate',
  'LabRecordedAt',
  'LabRecordedBy',
  'LabModifiedAt',
  'LabModifiedBy',
];

function categoryFromRow(r, prefix) {
  if (r[`${prefix}Points`] === '' || r[`${prefix}Points`] === undefined) return null;
  return {
    points: Number(r[`${prefix}Points`]),
    // Absence is still a 0-point score (SPEC §3.1.1) — this flag only
    // distinguishes "absent" from "answered and scored 0" for display in
    // views/participation-record.js and views/participation-history.js.
    // Missing on older rows (added after this column existed) reads as
    // false, same as any other absent-less recording.
    absent: r[`${prefix}Absent`] === 'true',
    meetingDate: r[`${prefix}MeetingDate`] || '',
    recordedAt: r[`${prefix}RecordedAt`] || '',
    recordedBy: r[`${prefix}RecordedBy`] || '',
    modifiedAt: r[`${prefix}ModifiedAt`] || '',
    modifiedBy: r[`${prefix}ModifiedBy`] || '',
  };
}

export function parseParticipationCsv(text) {
  const { rows } = parseCsv(text);
  return rows.map((r) => ({
    studentId: r.StudentID,
    theory: categoryFromRow(r, 'Theory'),
    lab: categoryFromRow(r, 'Lab'),
  }));
}

function categoryToRow(entry) {
  return {
    Points: entry ? entry.points : '',
    Absent: entry ? String(!!entry.absent) : '',
    MeetingDate: entry ? entry.meetingDate : '',
    RecordedAt: entry ? entry.recordedAt : '',
    RecordedBy: entry ? entry.recordedBy : '',
    ModifiedAt: entry ? entry.modifiedAt : '',
    ModifiedBy: entry ? entry.modifiedBy : '',
  };
}

export function participationToCsv(rows) {
  const csvRows = rows.map((r) => {
    const theory = categoryToRow(r.theory);
    const lab = categoryToRow(r.lab);
    return {
      StudentID: r.studentId,
      TheoryPoints: theory.Points,
      TheoryAbsent: theory.Absent,
      TheoryMeetingDate: theory.MeetingDate,
      TheoryRecordedAt: theory.RecordedAt,
      TheoryRecordedBy: theory.RecordedBy,
      TheoryModifiedAt: theory.ModifiedAt,
      TheoryModifiedBy: theory.ModifiedBy,
      LabPoints: lab.Points,
      LabAbsent: lab.Absent,
      LabMeetingDate: lab.MeetingDate,
      LabRecordedAt: lab.RecordedAt,
      LabRecordedBy: lab.RecordedBy,
      LabModifiedAt: lab.ModifiedAt,
      LabModifiedBy: lab.ModifiedBy,
    };
  });
  return toCsv(csvRows, PARTICIPATION_HEADERS);
}

export function getScore(rows, studentId, category) {
  const row = rows.find((r) => r.studentId === studentId);
  return row ? row[category] : null;
}

// Returns a new rows array with `studentId`'s `category` entry set. Keeps
// the original recordedAt/recordedBy if an entry already existed (a
// correction, not a first entry) so the original recorder stays attributed;
// modifiedAt/modifiedBy always reflect the most recent edit. `absent`
// defaults to false — tapping a 0/1/2 score button after a student was
// marked absent is itself the correction (see "Record is the only
// correction surface" in views/participation-record.js) and clears it.
export function upsertScore(rows, studentId, category, { points, meetingDate, recordedBy, now, absent = false }) {
  const next = rows.map((r) => ({ ...r }));
  let row = next.find((r) => r.studentId === studentId);
  if (!row) {
    row = { studentId, theory: null, lab: null };
    next.push(row);
  }
  const existing = row[category];
  row[category] = {
    points,
    absent: !!absent,
    meetingDate,
    recordedAt: existing ? existing.recordedAt : now,
    recordedBy: existing ? existing.recordedBy : recordedBy,
    modifiedAt: now,
    modifiedBy: recordedBy,
  };
  return next;
}

export function validateScore(points, max) {
  if (!Number.isInteger(points)) return 'Score must be a whole number.';
  if (points < 0 || points > max) return `Score must be between 0 and ${max}.`;
  return null;
}

// Never fully excludes a student from the picker, just deprioritizes them —
// a hard exclusion would make the draw predictable once few students are left.
const DRAW_WEIGHT_FLOOR = 0.1;

// A student's Theory and Lab draws should land far apart across the course
// rather than in the same week. This weighs a student down, but never to
// zero, based on how recently their *other* category was scored, ramping
// back up to full weight over `windowDays` (the course's configured
// draw-spacing window converted to days).
export function computeDrawWeight(rows, studentId, category, { now, windowDays }) {
  const otherCategory = category === 'theory' ? 'lab' : 'theory';
  const other = getScore(rows, studentId, otherCategory);
  if (!other || !other.recordedAt) return 1;

  const daysSince = (new Date(now) - new Date(other.recordedAt)) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(daysSince) || daysSince <= 0) return DRAW_WEIGHT_FLOOR;

  const ramp = Math.min(daysSince / windowDays, 1);
  return DRAW_WEIGHT_FLOOR + (1 - DRAW_WEIGHT_FLOOR) * ramp;
}

// Weighted counterpart to `Math.floor(Math.random() * weights.length)`:
// picks an index with probability proportional to its weight.
export function weightedRandomIndex(weights) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}
