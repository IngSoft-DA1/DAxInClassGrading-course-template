import { getContents, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse, getUserLogin } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import { parseParticipationCsv, participationToCsv, getScore, upsertScore } from '../participation.js';
import {
  parseParticipationAuditLogCsv,
  participationAuditLogToCsv,
  appendParticipationAuditEntry,
} from '../participation-audit-log.js';
import { saveWithRetry } from '../save-with-retry.js';

const PARTICIPATION_PATH = 'grades/participation.csv';
const PARTICIPATION_AUDIT_LOG_PATH = 'grades/participation-audit-log.csv';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function renderParticipationRecord(container, { org, repo }, headerEl) {
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
  let participationFile;
  let auditLogFile;
  try {
    [rosterFile, participationFile, auditLogFile] = await Promise.all([
      getContents(org, repo, 'students/roster.csv'),
      getContents(org, repo, PARTICIPATION_PATH),
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

  let rows = participationFile ? parseParticipationCsv(participationFile.content) : [];
  let sha = participationFile ? participationFile.sha : undefined;
  let auditRows = auditLogFile ? parseParticipationAuditLogCsv(auditLogFile.content) : [];
  let auditSha = auditLogFile ? auditLogFile.sha : undefined;

  let category = 'theory';
  let meetingDate = todayIso();
  let searchTerm = '';
  let savingId = null;
  let flashId = null;

  renderCard();

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Record participation</h2>
        <nav class="participation-tabs">
          <span class="active">Record</span>
          <a href="#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/participation/history">History</a>
        </nav>

        <div class="category-toggle" role="group" aria-label="Category">
          <button type="button" id="category-theory" class="${category === 'theory' ? 'active' : ''}">Theory</button>
          <button type="button" id="category-lab" class="${category === 'lab' ? 'active' : ''}">Lab</button>
        </div>

        <div class="record-controls">
          <label for="meeting-date">Meeting date</label>
          <input type="date" id="meeting-date" value="${escapeHtml(meetingDate)}" />
          <label for="student-search">Search</label>
          <input type="search" id="student-search" placeholder="Filter by name, ID, or handle" value="${escapeHtml(searchTerm)}" />
        </div>

        <ul class="participation-list" id="participation-list"></ul>
        <p id="participation-error" class="error" hidden></p>
      </section>
    `;

    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });
    container.querySelector('#category-theory').addEventListener('click', () => {
      category = 'theory';
      renderCard();
    });
    container.querySelector('#category-lab').addEventListener('click', () => {
      category = 'lab';
      renderCard();
    });
    container.querySelector('#meeting-date').addEventListener('change', (e) => {
      meetingDate = e.target.value;
    });
    container.querySelector('#student-search').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderList();
    });

    renderList();
  }

  function renderList() {
    const listEl = container.querySelector('#participation-list');
    const max = config.participation[category].max;
    const term = searchTerm.trim().toLowerCase();
    const filtered = students.filter((s) => {
      if (!term) return true;
      return (
        s.studentId.toLowerCase().includes(term) ||
        s.name.toLowerCase().includes(term) ||
        s.handle.toLowerCase().includes(term)
      );
    });

    listEl.innerHTML =
      filtered.map((s) => rowHtml(s, max)).join('') || '<li>No students match.</li>';

    listEl.querySelectorAll('.score-btn').forEach((btn) => {
      btn.addEventListener('click', () =>
        handleTap(btn.dataset.studentId, Number(btn.dataset.points), btn.dataset.absent === 'true')
      );
    });
  }

  function badgeScoreText(entry) {
    if (!entry) return '—';
    return entry.absent ? 'Absent' : entry.points;
  }

  function rowHtml(student, max) {
    const entry = getScore(rows, student.studentId, category);
    const theoryEntry = getScore(rows, student.studentId, 'theory');
    const labEntry = getScore(rows, student.studentId, 'lab');
    const badges = `
      <span class="badge ${theoryEntry ? 'badge-active' : 'badge-none'}">Theory: ${badgeScoreText(theoryEntry)}</span>
      <span class="badge ${labEntry ? 'badge-active' : 'badge-none'}">Lab: ${badgeScoreText(labEntry)}</span>
    `;
    const absentSelected = entry && entry.absent ? 'selected' : '';
    const buttons = [
      `<button type="button" class="score-btn score-btn-absent ${absentSelected}" data-student-id="${escapeHtml(student.studentId)}" data-points="0" data-absent="true">Absent</button>`,
    ];
    for (let n = 0; n <= max; n++) {
      const selected = entry && !entry.absent && entry.points === n ? 'selected' : '';
      buttons.push(
        `<button type="button" class="score-btn ${selected}" data-student-id="${escapeHtml(student.studentId)}" data-points="${n}" data-absent="false">${n}</button>`
      );
    }
    const status =
      savingId === student.studentId
        ? '<span class="row-status">Saving…</span>'
        : flashId === student.studentId
          ? '<span class="row-status saved">Saved</span>'
          : '';
    return `
      <li class="participation-row" data-student-id="${escapeHtml(student.studentId)}">
        <div class="student-info">
          <span class="student-name">${escapeHtml(student.name)}</span>
          <span class="student-id">${escapeHtml(student.studentId)}</span>
          ${badges}
        </div>
        <div class="score-buttons">${buttons.join('')}</div>
        ${status}
      </li>
    `;
  }

  async function handleTap(studentId, points, absent) {
    const previous = getScore(rows, studentId, category);
    if (
      previous &&
      previous.points === points &&
      !!previous.absent === absent &&
      previous.meetingDate === meetingDate
    ) {
      // No actual change — skip the save rather than write a no-op event
      // to the audit log.
      return;
    }

    const errorEl = container.querySelector('#participation-error');
    errorEl.hidden = true;
    savingId = studentId;
    flashId = null;
    renderList();

    const now = new Date().toISOString();
    const login = getUserLogin() || '';

    try {
      const result = await saveWithRetry({
        org,
        repo,
        path: PARTICIPATION_PATH,
        parse: parseParticipationCsv,
        serialize: participationToCsv,
        rows,
        sha,
        message: `Record ${category} participation for ${studentId}`,
        mutate: (r) =>
          upsertScore(r, studentId, category, {
            points,
            absent,
            meetingDate,
            recordedBy: login,
            now,
          }),
      });
      rows = result.rows;
      sha = result.sha;

      const auditResult = await saveWithRetry({
        org,
        repo,
        path: PARTICIPATION_AUDIT_LOG_PATH,
        parse: parseParticipationAuditLogCsv,
        serialize: participationAuditLogToCsv,
        rows: auditRows,
        sha: auditSha,
        message: `Log ${category} participation change for ${studentId}`,
        mutate: (r) =>
          appendParticipationAuditEntry(r, {
            studentId,
            category,
            meetingDate,
            previousPoints: previous ? previous.points : '',
            previousAbsent: previous ? !!previous.absent : false,
            newPoints: points,
            newAbsent: absent,
            changedAt: now,
            changedBy: login,
          }),
      });
      auditRows = auditResult.rows;
      auditSha = auditResult.sha;

      savingId = null;
      flashId = studentId;
      renderList();
      setTimeout(() => {
        if (flashId === studentId) {
          flashId = null;
          renderList();
        }
      }, 1500);
    } catch (err) {
      savingId = null;
      renderList();
      errorEl.textContent = describeSaveError(err, studentId);
      errorEl.hidden = false;
    }
  }

  function describeSaveError(err, studentId) {
    if (err instanceof GitHubApiError && err.status === 409) {
      return `Could not save ${studentId}'s score after retrying — reload the page and try again.`;
    }
    return `Could not save ${studentId}'s score: ${err.message}`;
  }
}
