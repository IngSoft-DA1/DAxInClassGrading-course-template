import { parseCsv, toCsv } from './csv.js';

export const ROSTER_HEADERS = ['Student ID', 'First and Last Name', 'GitHub Handle'];

export function parseRosterCsv(text) {
  const { headers, rows } = parseCsv(text);

  if (headers.length === 0) {
    return { students: [], errors: [] };
  }

  const headerMatches =
    headers.length === ROSTER_HEADERS.length && ROSTER_HEADERS.every((h, i) => headers[i] === h);
  if (!headerMatches) {
    return {
      students: [],
      errors: [`Expected header "${ROSTER_HEADERS.join(',')}" but found "${headers.join(',')}".`],
    };
  }

  const students = rows.map((r) => ({
    studentId: (r['Student ID'] || '').trim(),
    name: (r['First and Last Name'] || '').trim(),
    handle: (r['GitHub Handle'] || '').trim(),
  }));

  return { students, errors: [] };
}

export function rosterToCsv(students) {
  const rows = students.map((s) => ({
    'Student ID': s.studentId,
    'First and Last Name': s.name,
    'GitHub Handle': s.handle,
  }));
  return toCsv(rows, ROSTER_HEADERS);
}

// Upserts `importedStudents` into `workingRows` by Student ID, mutating and
// returning `workingRows`. A row already flagged 'new' stays 'new'; any
// other existing row (including a previously 'removed' one — re-importing
// it counts as an explicit un-delete) becomes 'edited'. Matches within the
// imported list itself resolve last-row-wins, since later matches simply
// overwrite the same row object.
export function mergeRoster(workingRows, importedStudents) {
  const byId = new Map(workingRows.map((r) => [r.studentId, r]));
  const added = [];
  const updated = [];

  importedStudents.forEach((s) => {
    const existing = byId.get(s.studentId);
    if (existing) {
      existing.name = s.name;
      existing.handle = s.handle;
      if (existing._status !== 'new') existing._status = 'edited';
      if (!updated.includes(s.studentId)) updated.push(s.studentId);
    } else {
      const row = { studentId: s.studentId, name: s.name, handle: s.handle, _status: 'new' };
      byId.set(s.studentId, row);
      workingRows.push(row);
      added.push(s.studentId);
    }
  });

  return { merged: workingRows, added, updated };
}

// `workingRows` must NOT include `student` itself — when validating a row
// that's already part of the working table (the common case, since the
// roster table is edited in place), the caller filters it out first, e.g.
// `validateStudent(row, workingRows.filter((r) => r !== row))`.
export function validateStudent(student, workingRows) {
  const errors = [];
  if (!student.studentId || !student.studentId.trim()) errors.push('Student ID is required.');
  if (!student.name || !student.name.trim()) errors.push('Name is required.');

  const duplicate = workingRows.some((r) => r.studentId === student.studentId && r._status !== 'removed');
  if (duplicate) errors.push('Student ID must be unique.');

  return errors;
}
