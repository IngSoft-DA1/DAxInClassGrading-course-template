import { getContents, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse, getUserLogin } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import {
  parseWrittenActivityCsv,
  writtenActivityToCsv,
  getWrittenActivity,
  upsertWrittenActivity,
  clearWrittenActivity,
  validateWrittenActivityScore,
  isSittingChangeAllowed,
} from '../written-activity.js';
import { saveWithRetry } from '../save-with-retry.js';

const WRITTEN_ACTIVITY_PATH = 'grades/written-activity.csv';

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export async function renderWrittenActivity(container, { org, repo }, headerEl) {
  container.innerHTML = '<p>Loading written activity…</p>';

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
  let writtenActivityFile;
  try {
    [rosterFile, writtenActivityFile] = await Promise.all([
      getContents(org, repo, 'students/roster.csv'),
      getContents(org, repo, WRITTEN_ACTIVITY_PATH),
    ]);
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load written activity data: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const { students, errors: rosterErrors } = parseRosterCsv(rosterFile ? rosterFile.content : '');
  if (rosterErrors.length) {
    container.innerHTML = `<p class="error">${escapeHtml(rosterErrors[0])}</p>`;
    return;
  }

  let rows = writtenActivityFile ? parseWrittenActivityCsv(writtenActivityFile.content) : [];
  let sha = writtenActivityFile ? writtenActivityFile.sha : undefined;

  const undoable = new Map();

  renderCard();

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Written activity</h2>
        <p>Single score per student — the official date or the make-up sitting, whichever produced it (max ${config.writtenActivity.max}).</p>
        <div class="participation-table-wrap">
          <table class="participation-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Points</th>
                <th>Sitting</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="wa-body"></tbody>
          </table>
        </div>
        <p id="wa-error" class="error" hidden></p>
      </section>
    `;

    wireStaticControls();
    renderRows();
  }

  function wireStaticControls() {
    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });

    const tbody = container.querySelector('#wa-body');

    tbody.addEventListener(
      'focusout',
      (e) => {
        const input = e.target.closest('input.cell');
        if (!input) return;
        handleCellCommit(input.closest('tr').dataset.studentId);
      },
      true
    );

    tbody.addEventListener('change', (e) => {
      const select = e.target.closest('select.cell');
      if (!select) return;
      handleCellCommit(select.closest('tr').dataset.studentId);
    });

    tbody.addEventListener('click', (e) => {
      const clearBtn = e.target.closest('.clear-btn');
      if (clearBtn) return handleClear(clearBtn.closest('tr').dataset.studentId);
      const undoBtn = e.target.closest('.undo-btn');
      if (undoBtn) return handleUndo(undoBtn.closest('tr').dataset.studentId);
    });
  }

  function renderRows() {
    const tbody = container.querySelector('#wa-body');
    tbody.innerHTML = students.map((s) => rowHtml(s)).join('') || '<tr><td colspan="4">No students yet.</td></tr>';
  }

  function rowHtml(student) {
    const entry = getWrittenActivity(rows, student.studentId);
    const hasUndo = undoable.has(student.studentId);
    const noteParts = [];
    if (entry) {
      noteParts.push(`Recorded ${formatTimestamp(entry.recordedAt)}${entry.recordedBy ? ` by ${entry.recordedBy}` : ''}`);
      if (entry.modifiedAt && entry.modifiedAt !== entry.recordedAt) {
        noteParts.push(`edited ${formatTimestamp(entry.modifiedAt)}${entry.modifiedBy ? ` by ${entry.modifiedBy}` : ''}`);
      }
    }
    return `
      <tr data-student-id="${escapeHtml(student.studentId)}">
        <td>${escapeHtml(student.name)} <span class="student-id">${escapeHtml(student.studentId)}</span></td>
        <td>
          <input
            class="cell"
            type="number"
            min="0"
            max="${config.writtenActivity.max}"
            data-student-id="${escapeHtml(student.studentId)}"
            data-field="points"
            value="${entry ? entry.points : ''}"
          />
        </td>
        <td>
          <select class="cell" data-student-id="${escapeHtml(student.studentId)}" data-field="sitting">
            <option
              value="first"
              ${!entry || entry.sitting === 'first' ? 'selected' : ''}
              ${isSittingChangeAllowed(entry, 'first') ? '' : 'disabled'}
              ${isSittingChangeAllowed(entry, 'first') ? '' : 'title="Already recorded for the second sitting — clear the entry to switch sittings."'}
            >First</option>
            <option
              value="second"
              ${entry && entry.sitting === 'second' ? 'selected' : ''}
              ${isSittingChangeAllowed(entry, 'second') ? '' : 'disabled'}
              ${isSittingChangeAllowed(entry, 'second') ? '' : 'title="Already recorded for the first sitting — clear the entry to switch sittings."'}
            >Second</option>
          </select>
        </td>
        <td>
          ${noteParts.length ? `<span class="timestamp-note">${escapeHtml(noteParts.join(' · '))}</span>` : ''}
          <button type="button" class="clear-btn" ${entry ? '' : 'disabled'}>Clear</button>
          ${hasUndo ? '<button type="button" class="undo-btn">Undo</button>' : ''}
        </td>
      </tr>
    `;
  }

  function readCell(studentId, field) {
    const el = container.querySelector(`[data-student-id="${cssEscape(studentId)}"][data-field="${field}"]`);
    return el ? el.value : '';
  }

  function cssEscape(value) {
    return value.replace(/["\\]/g, '\\$&');
  }

  async function handleCellCommit(studentId) {
    const errorEl = container.querySelector('#wa-error');
    errorEl.hidden = true;

    const pointsRaw = readCell(studentId, 'points');
    const sitting = readCell(studentId, 'sitting');
    const existing = getWrittenActivity(rows, studentId);

    if (pointsRaw === '') {
      if (existing) await handleClear(studentId);
      return;
    }

    const points = Number(pointsRaw);
    const unchanged = existing && existing.points === points && existing.sitting === sitting;
    if (unchanged) return;

    const scoreError = validateWrittenActivityScore(points, config.writtenActivity.max);
    if (scoreError) {
      errorEl.textContent = `${studentId}: ${scoreError}`;
      errorEl.hidden = false;
      renderRows();
      return;
    }

    if (!isSittingChangeAllowed(existing, sitting)) {
      errorEl.textContent = `${studentId}: already recorded for the ${existing.sitting} sitting — clear the entry first to switch sittings.`;
      errorEl.hidden = false;
      renderRows();
      return;
    }

    try {
      const result = await saveWithRetry({
        org,
        repo,
        path: WRITTEN_ACTIVITY_PATH,
        parse: parseWrittenActivityCsv,
        serialize: writtenActivityToCsv,
        rows,
        sha,
        message: `Update written activity for ${studentId}`,
        mutate: (r) =>
          upsertWrittenActivity(r, studentId, {
            points,
            sitting,
            recordedBy: getUserLogin() || '',
            now: new Date().toISOString(),
          }),
      });
      rows = result.rows;
      sha = result.sha;
      undoable.delete(studentId);
      renderRows();
    } catch (err) {
      errorEl.textContent = describeSaveError(err, studentId);
      errorEl.hidden = false;
      renderRows();
    }
  }

  async function handleClear(studentId) {
    const errorEl = container.querySelector('#wa-error');
    errorEl.hidden = true;
    const existing = getWrittenActivity(rows, studentId);
    if (!existing) return;

    try {
      const result = await saveWithRetry({
        org,
        repo,
        path: WRITTEN_ACTIVITY_PATH,
        parse: parseWrittenActivityCsv,
        serialize: writtenActivityToCsv,
        rows,
        sha,
        message: `Clear written activity for ${studentId}`,
        mutate: (r) => clearWrittenActivity(r, studentId),
      });
      rows = result.rows;
      sha = result.sha;
      undoable.set(studentId, existing);
      renderRows();
      setTimeout(() => {
        if (undoable.get(studentId) === existing) {
          undoable.delete(studentId);
          renderRows();
        }
      }, 10000);
    } catch (err) {
      errorEl.textContent = describeSaveError(err, studentId);
      errorEl.hidden = false;
      renderRows();
    }
  }

  async function handleUndo(studentId) {
    const errorEl = container.querySelector('#wa-error');
    errorEl.hidden = true;
    const previous = undoable.get(studentId);
    if (!previous) return;

    try {
      const result = await saveWithRetry({
        org,
        repo,
        path: WRITTEN_ACTIVITY_PATH,
        parse: parseWrittenActivityCsv,
        serialize: writtenActivityToCsv,
        rows,
        sha,
        message: `Restore written activity for ${studentId}`,
        mutate: (r) =>
          upsertWrittenActivity(r, studentId, {
            points: previous.points,
            sitting: previous.sitting,
            recordedBy: previous.recordedBy || getUserLogin() || '',
            now: new Date().toISOString(),
          }),
      });
      rows = result.rows;
      sha = result.sha;
      undoable.delete(studentId);
      renderRows();
    } catch (err) {
      errorEl.textContent = describeSaveError(err, studentId);
      errorEl.hidden = false;
      renderRows();
    }
  }

  function describeSaveError(err, studentId) {
    if (err instanceof GitHubApiError && err.status === 409) {
      return `Could not save ${studentId}'s score after retrying — reload the page and try again.`;
    }
    return `Could not save ${studentId}'s score: ${err.message}`;
  }
}
