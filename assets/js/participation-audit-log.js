import { parseCsv, toCsv } from './csv.js';

// Append-only: one row per create/edit event, never overwritten or
// removed — the audit trail for views/participation-history.js. Corrections
// happen by re-recording in views/participation-record.js (see upsertScore
// in participation.js), which appends the resulting event here; there's no
// separate edit-in-place or delete for this file.
export const PARTICIPATION_AUDIT_LOG_HEADERS = [
  'StudentID',
  'Category',
  'MeetingDate',
  'PreviousPoints',
  'PreviousAbsent',
  'NewPoints',
  'NewAbsent',
  'ChangedAt',
  'ChangedBy',
];

export function parseParticipationAuditLogCsv(text) {
  const { rows } = parseCsv(text);
  return rows.map((r) => ({
    studentId: r.StudentID,
    category: r.Category,
    meetingDate: r.MeetingDate || '',
    previousPoints: r.PreviousPoints === undefined ? '' : r.PreviousPoints,
    // Missing (older rows, or the "(created)" case where there's no
    // previous entry at all) reads as false, same as any other
    // absent-less entry — see participation.js's categoryFromRow.
    previousAbsent: r.PreviousAbsent === 'true',
    newPoints: Number(r.NewPoints),
    newAbsent: r.NewAbsent === 'true',
    changedAt: r.ChangedAt || '',
    changedBy: r.ChangedBy || '',
  }));
}

export function participationAuditLogToCsv(rows) {
  const csvRows = rows.map((r) => ({
    StudentID: r.studentId,
    Category: r.category,
    MeetingDate: r.meetingDate,
    PreviousPoints: r.previousPoints,
    PreviousAbsent: r.previousPoints === '' ? '' : String(!!r.previousAbsent),
    NewPoints: r.newPoints,
    NewAbsent: String(!!r.newAbsent),
    ChangedAt: r.changedAt,
    ChangedBy: r.changedBy,
  }));
  return toCsv(csvRows, PARTICIPATION_AUDIT_LOG_HEADERS);
}

export function appendParticipationAuditEntry(rows, entry) {
  return [...rows, entry];
}

export function listParticipationAuditEntries(rows, studentId) {
  return rows
    .filter((r) => r.studentId === studentId)
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt));
}
