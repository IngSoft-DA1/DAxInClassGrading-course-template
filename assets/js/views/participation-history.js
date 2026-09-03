import { getContents } from '../github-api.js';
import { setActiveCourse, addRecentCourse } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import { parseParticipationAuditLogCsv, listParticipationAuditEntries } from '../participation-audit-log.js';

const PARTICIPATION_AUDIT_LOG_PATH = 'grades/participation-audit-log.csv';

const CATEGORY_LABELS = { theory: 'Theory', lab: 'Lab' };

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

// Read-only audit trail: every Theory/Lab create and edit, grouped by
// student, newest first — corrections happen in views/participation-record.js
// (re-recording a category overwrites it), this view only displays what
// happened. See template/assets/js/participation-audit-log.js.
export async function renderParticipationHistory(container, { org, repo }, headerEl) {
  container.innerHTML = '<p>Loading participation…</p>';

  let configFile;
  try {
    configFile = await getContents(org, repo, 'config/course.json');
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load course: ${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!configFile) {
    container.innerHTML =
      '<p class="error">config/course.json not found. Make sure the repository exists, you have access to it, and it was created from the course template.</p>';
    return;
  }

  const config = JSON.parse(configFile.content);
  if (!config.sessionId) {
    location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    return;
  }

  setActiveCourse({ org, repo, sessionId: config.sessionId });
  addRecentCourse({ org, repo, sessionId: config.sessionId });
  if (headerEl) renderHeader(headerEl, { org, repo, sessionId: config.sessionId });

  let rosterFile;
  let auditLogFile;
  try {
    [rosterFile, auditLogFile] = await Promise.all([
      getContents(org, repo, 'students/roster.csv'),
      getContents(org, repo, PARTICIPATION_AUDIT_LOG_PATH),
    ]);
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load participation data: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const { students, errors: rosterErrors } = parseRosterCsv(rosterFile ? rosterFile.content : '');
  if (rosterErrors.length) {
    container.innerHTML = `<p class="error">${escapeHtml(rosterErrors[0])}</p>`;
    return;
  }

  const auditRows = auditLogFile ? parseParticipationAuditLogCsv(auditLogFile.content) : [];

  let searchTerm = '';
  let typeFilter = '';

  renderCard();

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Participation history</h2>
        <nav class="participation-tabs">
          <a href="#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/participation">Record</a>
          <span class="active">History</span>
        </nav>

        ${
          auditRows.length === 0
            ? '<p>No participation changes recorded yet.</p>'
            : `
              <div class="record-controls">
                <label for="student-search">Search</label>
                <input type="search" id="student-search" placeholder="Filter by name, ID, or handle" value="${escapeHtml(searchTerm)}" />
                <label for="type-filter">Type</label>
                <select id="type-filter">
                  <option value="" ${typeFilter === '' ? 'selected' : ''}>All</option>
                  <option value="theory" ${typeFilter === 'theory' ? 'selected' : ''}>Theory</option>
                  <option value="lab" ${typeFilter === 'lab' ? 'selected' : ''}>Lab</option>
                </select>
              </div>
              <div id="history-groups"></div>
            `
        }
      </section>
    `;

    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });

    if (auditRows.length === 0) return;

    container.querySelector('#student-search').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderGroups();
    });
    container.querySelector('#type-filter').addEventListener('change', (e) => {
      typeFilter = e.target.value;
      renderGroups();
    });

    renderGroups();
  }

  function renderGroups() {
    const groupsEl = container.querySelector('#history-groups');
    const term = searchTerm.trim().toLowerCase();
    const filteredStudents = students.filter((s) => {
      if (!term) return true;
      return (
        s.studentId.toLowerCase().includes(term) ||
        s.name.toLowerCase().includes(term) ||
        s.handle.toLowerCase().includes(term)
      );
    });

    const groups = filteredStudents
      .map((s) => ({
        student: s,
        entries: listParticipationAuditEntries(auditRows, s.studentId).filter(
          (e) => !typeFilter || e.category === typeFilter
        ),
      }))
      .filter((g) => g.entries.length > 0);

    groupsEl.innerHTML = groups.map((g) => groupHtml(g.student, g.entries)).join('') || '<p>No students match.</p>';
  }

  function groupHtml(student, entries) {
    return `
      <div class="audit-student-group" data-student-id="${escapeHtml(student.studentId)}">
        <h3 class="audit-student-heading">${escapeHtml(student.name)} <span class="student-id">${escapeHtml(student.studentId)}</span></h3>
        <div class="participation-table-wrap">
          <table class="participation-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Meeting date</th>
                <th>Score</th>
                <th>Changed by</th>
              </tr>
            </thead>
            <tbody>
              ${entries.map((e) => entryHtml(e)).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function formatScore(points, absent) {
    return absent ? 'Absent' : String(points);
  }

  function entryHtml(entry) {
    const noteHtml =
      entry.previousPoints === ''
        ? '<i class="diff-created">(created)</i>'
        : `<span class="diff-old">${escapeHtml(formatScore(entry.previousPoints, entry.previousAbsent))}</span>`;
    return `
      <tr
        data-category="${escapeHtml(entry.category)}"
        data-meeting-date="${escapeHtml(entry.meetingDate)}"
        data-previous-points="${escapeHtml(String(entry.previousPoints))}"
        data-previous-absent="${entry.previousAbsent ? 'true' : 'false'}"
        data-new-points="${escapeHtml(String(entry.newPoints))}"
        data-new-absent="${entry.newAbsent ? 'true' : 'false'}"
        data-changed-by="${escapeHtml(entry.changedBy)}"
      >
        <td>${escapeHtml(formatTimestamp(entry.changedAt))}</td>
        <td><span class="pill pill-${escapeHtml(entry.category)}">${escapeHtml(CATEGORY_LABELS[entry.category] || entry.category)}</span></td>
        <td>${escapeHtml(entry.meetingDate)}</td>
        <td>${noteHtml} <span class="diff-arrow">→</span> <b>${escapeHtml(formatScore(entry.newPoints, entry.newAbsent))}</b></td>
        <td>${escapeHtml(entry.changedBy)}</td>
      </tr>
    `;
  }
}
