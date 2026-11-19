import { getContents, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse, getUserLogin } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import {
  parseParticipationCsv,
  participationToCsv,
  getScore,
  upsertScore,
  clearScore,
  resolveMeetingDate,
} from '../participation.js';
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
  // "Pending only" narrows the list to students whose entry in the current
  // category is Pending (participated, grade still to be given) - the
  // reminder surface for finding them all when ready to grade.
  let pendingOnly = false;
  let savingId = null;
  let flashId = null;
  // Keyed by `${studentId}:${category}` — holds the just-cleared entry so
  // Clear can offer a 10s Undo, same pattern as views/written-activity.js.
  const undoable = new Map();

  function undoKey(studentId) {
    return `${studentId}:${category}`;
  }

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
          <label class="pending-only-label"><input type="checkbox" id="pending-only" ${pendingOnly ? 'checked' : ''} /> Pending only</label>
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
    container.querySelector('#pending-only').addEventListener('change', (e) => {
      pendingOnly = e.target.checked;
      renderList();
    });

    renderList();
  }

  function renderList() {
    const listEl = container.querySelector('#participation-list');
    const max = config.participation[category].max;
    const term = searchTerm.trim().toLowerCase();
    const filtered = students.filter((s) => {
      if (pendingOnly) {
        const entry = getScore(rows, s.studentId, category);
        if (!entry || !entry.pending) return false;
      }
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
      btn.addEventListener('click', () => {
        const pending = btn.dataset.pending === 'true';
        // A Pending entry has no grade (null), never 0.
        handleTap(btn.dataset.studentId, pending ? null : Number(btn.dataset.points), btn.dataset.absent === 'true', pending);
      });
    });
    listEl.querySelectorAll('.clear-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleClear(btn.dataset.studentId));
    });
    listEl.querySelectorAll('.undo-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleUndo(btn.dataset.studentId));
    });
  }

  function badgeScoreText(entry) {
    if (!entry) return '—';
    if (entry.pending) return 'Pending';
    return entry.absent ? 'Absent' : entry.points;
  }

  function badgeClass(entry) {
    if (!entry) return 'badge-none';
    return entry.pending ? 'badge-pending' : 'badge-active';
  }

  function rowHtml(student, max) {
    const entry = getScore(rows, student.studentId, category);
    const theoryEntry = getScore(rows, student.studentId, 'theory');
    const labEntry = getScore(rows, student.studentId, 'lab');
    const badges = `
      <span class="badge ${badgeClass(theoryEntry)}">Theory: ${badgeScoreText(theoryEntry)}</span>
      <span class="badge ${badgeClass(labEntry)}">Lab: ${badgeScoreText(labEntry)}</span>
    `;
    const absentSelected = entry && entry.absent ? 'selected' : '';
    const pendingSelected = entry && entry.pending ? 'selected' : '';
    const buttons = [
      `<button type="button" class="score-btn score-btn-absent ${absentSelected}" data-student-id="${escapeHtml(student.studentId)}" data-points="0" data-absent="true" data-pending="false">Absent</button>`,
      // Pending: participated, grade later. No points (data-points is blank)
      // - it must never read as a 0.
      `<button type="button" class="score-btn score-btn-pending ${pendingSelected}" data-student-id="${escapeHtml(student.studentId)}" data-points="" data-absent="false" data-pending="true">Pending</button>`,
    ];
    for (let n = 0; n <= max; n++) {
      const selected = entry && !entry.absent && !entry.pending && entry.points === n ? 'selected' : '';
      buttons.push(
        `<button type="button" class="score-btn ${selected}" data-student-id="${escapeHtml(student.studentId)}" data-points="${n}" data-absent="false" data-pending="false">${n}</button>`
      );
    }
    const status =
      savingId === student.studentId
        ? '<span class="row-status">Saving…</span>'
        : flashId === student.studentId
          ? '<span class="row-status saved">Saved</span>'
          : '';
    const hasUndo = undoable.has(undoKey(student.studentId));
    return `
      <li class="participation-row" data-student-id="${escapeHtml(student.studentId)}">
        <div class="student-info">
          <span class="student-name">${escapeHtml(student.name)}</span>
          <span class="student-id">${escapeHtml(student.studentId)}</span>
          ${badges}
        </div>
        <div class="score-buttons">${buttons.join('')}</div>
        <div class="score-actions">
          <button type="button" class="clear-btn" data-student-id="${escapeHtml(student.studentId)}" ${entry ? '' : 'disabled'}>Clear</button>
          ${hasUndo ? `<button type="button" class="undo-btn" data-student-id="${escapeHtml(student.studentId)}">Undo</button>` : ''}
        </div>
        ${status}
      </li>
    `;
  }

  // Records a Theory/Lab score (a fresh entry, a correction, or an Undo
  // restoring a cleared one) and appends the matching audit entry. Shared by
  // handleTap and handleUndo, which differ only in where points/absent come
  // from and whether `previous` is the pre-tap score or the undo buffer.
  async function saveScoreChange(studentId, { points, absent, pending = false, meetingDate: entryMeetingDate, previous }) {
    const now = new Date().toISOString();
    const login = getUserLogin() || '';

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
          pending,
          meetingDate: entryMeetingDate,
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
          meetingDate: entryMeetingDate,
          previousPoints: previous && previous.points !== null ? previous.points : '',
          previousAbsent: previous ? !!previous.absent : false,
          previousPending: previous ? !!previous.pending : false,
          newPoints: pending ? '' : points,
          newAbsent: absent,
          newPending: pending,
          newCleared: false,
          changedAt: now,
          changedBy: login,
        }),
    });
    auditRows = auditResult.rows;
    auditSha = auditResult.sha;
  }

  async function handleTap(studentId, points, absent, pending = false) {
    const previous = getScore(rows, studentId, category);
    // Grading a Pending entry later keeps its original meeting date rather
    // than taking the date picker's (today's) value.
    const entryMeetingDate = resolveMeetingDate(previous, { pending, meetingDate });
    if (
      previous &&
      previous.points === points &&
      !!previous.absent === absent &&
      !!previous.pending === pending &&
      previous.meetingDate === entryMeetingDate
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

    try {
      await saveScoreChange(studentId, { points, absent, pending, meetingDate: entryMeetingDate, previous });
      // A fresh record makes any pending Clear-undo for this student/category stale.
      undoable.delete(undoKey(studentId));

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

  async function handleClear(studentId) {
    const previous = getScore(rows, studentId, category);
    if (!previous) return;

    const errorEl = container.querySelector('#participation-error');
    errorEl.hidden = true;
    savingId = studentId;
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
        message: `Clear ${category} participation for ${studentId}`,
        mutate: (r) => clearScore(r, studentId, category),
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
        message: `Log ${category} participation clear for ${studentId}`,
        mutate: (r) =>
          appendParticipationAuditEntry(r, {
            studentId,
            category,
            meetingDate: previous.meetingDate,
            previousPoints: previous.points === null ? '' : previous.points,
            previousAbsent: !!previous.absent,
            previousPending: !!previous.pending,
            newPoints: '',
            newAbsent: false,
            newPending: false,
            newCleared: true,
            changedAt: now,
            changedBy: login,
          }),
      });
      auditRows = auditResult.rows;
      auditSha = auditResult.sha;

      savingId = null;
      const key = undoKey(studentId);
      undoable.set(key, previous);
      renderList();
      setTimeout(() => {
        if (undoable.get(key) === previous) {
          undoable.delete(key);
          renderList();
        }
      }, 10000);
    } catch (err) {
      savingId = null;
      renderList();
      errorEl.textContent = describeSaveError(err, studentId);
      errorEl.hidden = false;
    }
  }

  async function handleUndo(studentId) {
    const key = undoKey(studentId);
    const previous = undoable.get(key);
    if (!previous) return;

    const errorEl = container.querySelector('#participation-error');
    errorEl.hidden = true;
    savingId = studentId;
    renderList();

    try {
      await saveScoreChange(studentId, {
        points: previous.points,
        absent: !!previous.absent,
        pending: !!previous.pending,
        meetingDate: previous.meetingDate,
        previous: getScore(rows, studentId, category),
      });
      undoable.delete(key);
      savingId = null;
      renderList();
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
