import { toCsv } from './csv.js';
import { getScore } from './participation.js';
import { getWrittenActivity } from './written-activity.js';
import { getBonusTotal } from './bonus.js';

// Generated report, not a source of truth — regenerated wholesale from
// participation.csv/written-activity.csv/bonus.csv on every export
// (see views/grades-summary.js), never parsed back into the app.
export const GRADES_SUMMARY_HEADERS = [
  'StudentID',
  'Name',
  'GitHubHandle',
  'TheoryPoints',
  'LabPoints',
  'WrittenActivityPoints',
  'BonusPoints',
  'InClassPerformanceTotal',
  'InClassPerformanceMax',
  // Appended last so existing columns keep their positions. Lists the
  // categories whose participation grade is still Pending (e.g. "Theory" or
  // "Theory;Lab"); empty when nothing is pending.
  'PendingItems',
];

export const PENDING_MARK = 'p';
export const ABSENT_MARK = 'a';

// Key shown under the Grades table and appended to the exported CSV as
// '#' comment lines (no commas, so they stay one raw line).
export const GRADES_KEY_LINES = [
  'p = Pending: participated but the grade is not assigned yet; counted as 0 in the total until graded',
  'a = Absent: did not attend; counted as 0 in the total',
];

function markFor(entry) {
  if (!entry) return '';
  if (entry.pending) return PENDING_MARK;
  if (entry.absent) return ABSENT_MARK;
  return '';
}

export function buildGradesSummary(students, { participationRows, writtenActivityRows, bonusRows, config }) {
  const max = config.participation.theory.max + config.participation.lab.max + config.writtenActivity.max;

  return students.map((s) => {
    const theoryEntry = getScore(participationRows, s.studentId, 'theory');
    const labEntry = getScore(participationRows, s.studentId, 'lab');
    // Pending ("grade later") has no points: it contributes 0 to the total
    // and is flagged with PENDING_MARK. Absent also contributes 0 and is
    // flagged with ABSENT_MARK. Both are shown as a marker, not a number.
    const theoryMark = markFor(theoryEntry);
    const labMark = markFor(labEntry);
    const theory = theoryEntry?.points ?? 0;
    const lab = labEntry?.points ?? 0;
    const pendingItems = [];
    if (theoryMark === PENDING_MARK) pendingItems.push('Theory');
    if (labMark === PENDING_MARK) pendingItems.push('Lab');
    const writtenActivity = getWrittenActivity(writtenActivityRows, s.studentId)?.points ?? 0;
    const bonus = getBonusTotal(bonusRows, s.studentId);
    const total = theory + lab + writtenActivity + bonus;
    return {
      studentId: s.studentId,
      name: s.name,
      handle: s.handle,
      theory,
      lab,
      theoryMark,
      labMark,
      writtenActivity,
      bonus,
      // Only the points actually given; pending/absent count as 0.
      total,
      pendingItems,
      max,
    };
  });
}

export function gradesSummaryToCsv(rows) {
  const csvRows = rows.map((r) => ({
    StudentID: r.studentId,
    Name: r.name,
    GitHubHandle: r.handle,
    TheoryPoints: r.theoryMark || r.theory,
    LabPoints: r.labMark || r.lab,
    WrittenActivityPoints: r.writtenActivity,
    BonusPoints: r.bonus,
    InClassPerformanceTotal: r.total,
    InClassPerformanceMax: r.max,
    PendingItems: r.pendingItems.join(';'),
  }));
  // Key goes after the data rows so the header stays on line 1.
  const key = GRADES_KEY_LINES.map((l) => `# ${l}\n`).join('');
  return toCsv(csvRows, GRADES_SUMMARY_HEADERS) + key;
}
