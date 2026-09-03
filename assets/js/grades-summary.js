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
];

export function buildGradesSummary(students, { participationRows, writtenActivityRows, bonusRows, config }) {
  const max = config.participation.theory.max + config.participation.lab.max + config.writtenActivity.max;

  return students.map((s) => {
    const theory = getScore(participationRows, s.studentId, 'theory')?.points ?? 0;
    const lab = getScore(participationRows, s.studentId, 'lab')?.points ?? 0;
    const writtenActivity = getWrittenActivity(writtenActivityRows, s.studentId)?.points ?? 0;
    const bonus = getBonusTotal(bonusRows, s.studentId);
    return {
      studentId: s.studentId,
      name: s.name,
      handle: s.handle,
      theory,
      lab,
      writtenActivity,
      bonus,
      total: theory + lab + writtenActivity + bonus,
      max,
    };
  });
}

export function gradesSummaryToCsv(rows) {
  const csvRows = rows.map((r) => ({
    StudentID: r.studentId,
    Name: r.name,
    GitHubHandle: r.handle,
    TheoryPoints: r.theory,
    LabPoints: r.lab,
    WrittenActivityPoints: r.writtenActivity,
    BonusPoints: r.bonus,
    InClassPerformanceTotal: r.total,
    InClassPerformanceMax: r.max,
  }));
  return toCsv(csvRows, GRADES_SUMMARY_HEADERS);
}
