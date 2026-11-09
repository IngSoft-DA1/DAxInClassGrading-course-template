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
  // Appended after the original columns (never inserted among them) so every
  // existing column keeps its position. Missing on files written before
  // Pending existed — categoryFromRow reads that as "not pending".
  'TheoryPending',
  'LabPending',
];

function categoryFromRow(r, prefix) {
  const noPoints = r[`${prefix}Points`] === '' || r[`${prefix}Points`] === undefined;
  // Pending means "participated, grade it later" (SPEC §3.1.1): the entry
  // exists but deliberately has NO grade — Points stays blank and must never
  // be turned into 0 (Number('') === 0), or a forgotten Pending would
  // silently become a graded 0.
  const pending = r[`${prefix}Pending`] === 'true';
  if (noPoints && !pending) return null;
  return {
    points: noPoints ? null : Number(r[`${prefix}Points`]),
    pending,
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
    Points: entry && entry.points !== null && entry.points !== undefined ? entry.points : '',
    Absent: entry ? String(!!entry.absent) : '',
    Pending: entry ? String(!!entry.pending) : '',
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
      TheoryPending: theory.Pending,
      LabPending: lab.Pending,
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
export function upsertScore(
  rows,
  studentId,
  category,
  { points, meetingDate, recordedBy, now, absent = false, pending = false }
) {
  if (absent && pending) {
    throw new Error('A participation entry cannot be both Absent and Pending.');
  }
  const next = rows.map((r) => ({ ...r }));
  let row = next.find((r) => r.studentId === studentId);
  if (!row) {
    row = { studentId, theory: null, lab: null };
    next.push(row);
  }
  const existing = row[category];
  row[category] = {
    // A Pending entry has no grade at all (null, blank in the CSV) — never 0.
    points: pending ? null : points,
    absent: !!absent,
    pending: !!pending,
    meetingDate: resolveMeetingDate(existing, { pending, meetingDate }),
    recordedAt: existing ? existing.recordedAt : now,
    recordedBy: existing ? existing.recordedBy : recordedBy,
    modifiedAt: now,
    modifiedBy: recordedBy,
  };
  return next;
}

// Fully un-does a mistaken entry (wrong student, wrong category, fat-fingered
// Absent) — unlike upsertScore, which only ever moves between Absent/0..max,
// this puts the student back to "not yet graded" so they're eligible for the
// picker again (see eligibleStudents() in views/participation-picker.js).
export function clearScore(rows, studentId, category) {
  return rows.map((r) => (r.studentId === studentId ? { ...r, [category]: null } : r));
}

// Grading a Pending entry later (a 0/1/2 or Absent tap) must not re-date the
// participation to the day it was graded, so the original meeting date wins.
// A first-time record, a correction of a graded entry, and a Pending-to-Pending
// re-tap all still take the date the instructor picked.
export function resolveMeetingDate(existing, { pending, meetingDate }) {
  if (existing && existing.pending && !pending && existing.meetingDate) return existing.meetingDate;
  return meetingDate;
}

// Every Pending entry (either category) for the reminder surfaces: the Record
// view's "Pending only" filter and the Grades warning.
export function listPending(rows, students) {
  const result = [];
  for (const student of students) {
    for (const category of ['theory', 'lab']) {
      const entry = getScore(rows, student.studentId, category);
      if (entry && entry.pending) {
        result.push({ student, category, meetingDate: entry.meetingDate });
      }
    }
  }
  return result;
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

// Multi-student draw: picks `count` distinct indexes (into `weights`) in
// spin order. Each pick reuses the existing weightedRandomIndex() on the
// weights of whoever is still left, so every spin follows the same rule as a
// single draw; students already picked in this draw are simply removed from
// the remaining pool, which also guarantees termination.
export function drawDistinctIndexes(weights, count) {
  const remaining = weights.map((weight, index) => ({ weight, index }));
  const picked = [];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    const at = weightedRandomIndex(remaining.map((r) => r.weight));
    picked.push(remaining[at].index);
    remaining.splice(at, 1);
  }
  return picked;
}

// Validates the raw value of the "how many students" input against the
// number of currently eligible students.
export function validateDrawCount(raw, eligibleCount) {
  if (eligibleCount < 1) return { ok: false, message: 'No eligible students to draw.' };
  const text = String(raw ?? '').trim();
  if (!/^-?\d+$/.test(text)) return { ok: false, message: 'Enter a whole number of at least 1.' };
  const value = Number(text);
  if (value < 1) return { ok: false, message: 'Enter a whole number of at least 1.' };
  if (value > eligibleCount) {
    return {
      ok: false,
      message: `Only ${eligibleCount} ${eligibleCount === 1 ? 'student is' : 'students are'} eligible.`,
    };
  }
  return { ok: true, value };
}
