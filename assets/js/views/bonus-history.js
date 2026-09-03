import { getContents, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse, getUserLogin } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import { parseParticipationCsv, getScore } from '../participation.js';
import { parseWrittenActivityCsv, getWrittenActivity } from '../written-activity.js';
import {
  parseBonusCsv,
  bonusToCsv,
  getBonusEntry,
  getBonusTotal,
  addBonusEntry,
  updateBonusEntry,
  removeBonusEntry,
  validateBonusScore,
} from '../bonus.js';
import { saveWithRetry } from '../save-with-retry.js';

const BONUS_PATH = 'grades/bonus.csv';

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString();
}

export async function renderBonusHistory(container, { org, repo }, headerEl) {
  container.innerHTML = '<p>Loading bonus…</p>';

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
  let writtenActivityFile;
  let bonusFile;
  try {
    [rosterFile, participationFile, writtenActivityFile, bonusFile] = await Promise.all([
      getContents(org, repo, 'students/roster.csv'),
      getContents(org, repo, 'grades/participation.csv'),
      getContents(org, repo, 'grades/written-activity.csv'),
      getContents(org, repo, BONUS_PATH),
    ]);
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load bonus data: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const { students, errors: rosterErrors } = parseRosterCsv(rosterFile ? rosterFile.content : '');
  if (rosterErrors.length) {
    container.innerHTML = `<p class="error">${escapeHtml(rosterErrors[0])}</p>`;
    return;
  }
  const studentsById = new Map(students.map((s) => [s.studentId, s]));

  const participationRows = participationFile ? parseParticipationCsv(participationFile.content) : [];
  const writtenActivityRows = writtenActivityFile ? parseWrittenActivityCsv(writtenActivityFile.content) : [];
  let rows = bonusFile ? parseBonusCsv(bonusFile.content) : [];
  let sha = bonusFile ? bonusFile.sha : undefined;

  const cap = config.participation.theory.max + config.participation.lab.max + config.writtenActivity.max;

  function awardCeiling(studentId) {
    const earnedBase =
      (getScore(participationRows, studentId, 'theory')?.points ?? 0) +
      (getScore(participationRows, studentId, 'lab')?.points ?? 0) +
      (getWrittenActivity(writtenActivityRows, studentId)?.points ?? 0);
    return Math.max(0, Math.min(config.bonus.max, cap - earnedBase));
  }

  // Ceiling for editing an *existing* entry excludes that entry's own
  // current points from the running total, so raising/lowering it within
  // the room left by the student's other entries works correctly.
  function editCeiling(entry) {
    const total = getBonusTotal(rows, entry.studentId);
    return Math.max(0, awardCeiling(entry.studentId) - (total - entry.points));
  }

  // Holds the just-cleared entry (by entryId) so Clear can offer a
  // short-lived Undo without a confirmation dialog up front.
  const undoable = new Map();

  renderCard();

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Bonus history</h2>
        <nav class="participation-tabs">
          <a href="#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/bonus">Record</a>
          <span class="active">History</span>
          <a href="#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/bonus/by-date">Points by Date</a>
        </nav>

        <div class="participation-table-wrap">
          <table class="participation-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Points</th>
                <th>Meeting date</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="bonus-history-body"></tbody>
          </table>
        </div>
        <p id="bonus-history-error" class="error" hidden></p>
      </section>
    `;

    wireStaticControls();
    renderRows();
  }

  function wireStaticControls() {
    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });

    const tbody = container.querySelector('#bonus-history-body');

    tbody.addEventListener(
      'focusout',
      (e) => {
        const input = e.target.closest('input.cell');
        if (!input) return;
        handleCellCommit(input.closest('tr').dataset.entryId);
      },
      true
    );

    tbody.addEventListener('click', (e) => {
      const clearBtn = e.target.closest('.clear-btn');
      if (clearBtn) return handleClear(clearBtn.closest('tr').dataset.entryId);
      const undoBtn = e.target.closest('.undo-btn');
      if (undoBtn) return handleUndo(undoBtn.closest('tr').dataset.entryId);
    });
  }

  function sortedRows() {
    return rows.slice().sort((a, b) => (b.recordedAt || '').localeCompare(a.recordedAt || ''));
  }

  function renderRows() {
    const tbody = container.querySelector('#bonus-history-body');
    const entries = sortedRows();
    // Clearing an entry removes its row from `rows` entirely (unlike
    // Theory/Lab, where the per-student row survives and just has its
    // category nulled) — so a still-undoable cleared entry needs a
    // synthetic placeholder row here, purely to host its Undo button.
    const currentIds = new Set(entries.map((e) => e.entryId));
    const ghostEntries = [...undoable.entries()]
      .filter(([entryId]) => !currentIds.has(entryId))
      .map(([, entry]) => ({ ...entry, _removed: true }));
    const all = [...entries, ...ghostEntries];
    tbody.innerHTML = all.map((entry) => rowHtml(entry)).join('') || '<tr><td colspan="4">No bonus awards yet.</td></tr>';
  }

  function rowHtml(entry) {
    const student = studentsById.get(entry.studentId);
    const hasUndo = undoable.has(entry.entryId);
    const removed = Boolean(entry._removed);
    const noteParts = removed
      ? ['Cleared']
      : [`Recorded ${formatTimestamp(entry.recordedAt)}${entry.recordedBy ? ` by ${entry.recordedBy}` : ''}`];
    if (!removed && entry.modifiedAt && entry.modifiedAt !== entry.recordedAt) {
      noteParts.push(`edited ${formatTimestamp(entry.modifiedAt)}${entry.modifiedBy ? ` by ${entry.modifiedBy}` : ''}`);
    }
    return `
      <tr data-entry-id="${escapeHtml(entry.entryId)}" data-student-id="${escapeHtml(entry.studentId)}" class="${removed ? 'removed' : ''}">
        <td>${escapeHtml(student ? student.name : entry.studentId)} <span class="student-id">${escapeHtml(entry.studentId)}</span></td>
        <td>
          <input
            class="cell"
            type="number"
            min="0"
            data-entry-id="${escapeHtml(entry.entryId)}"
            data-field="points"
            value="${removed ? '' : entry.points}"
            ${removed ? 'disabled' : ''}
          />
        </td>
        <td>
          <input
            class="cell"
            type="date"
            data-entry-id="${escapeHtml(entry.entryId)}"
            data-field="meetingDate"
            value="${removed ? '' : escapeHtml(entry.meetingDate)}"
            ${removed ? 'disabled' : ''}
          />
        </td>
        <td>
          <span class="timestamp-note">${escapeHtml(noteParts.join(' · '))}</span>
          <button type="button" class="clear-btn" ${removed ? 'disabled' : ''}>Clear</button>
          ${hasUndo ? '<button type="button" class="undo-btn">Undo</button>' : ''}
        </td>
      </tr>
    `;
  }

  function readCell(entryId, field) {
    const input = container.querySelector(`input.cell[data-entry-id="${cssEscape(entryId)}"][data-field="${field}"]`);
    return input ? input.value : '';
  }

  function cssEscape(value) {
    return value.replace(/["\\]/g, '\\$&');
  }

  async function handleCellCommit(entryId) {
    const errorEl = container.querySelector('#bonus-history-error');
    errorEl.hidden = true;

    const entry = getBonusEntry(rows, entryId);
    if (!entry) return;

    const pointsRaw = readCell(entryId, 'points');
    if (pointsRaw === '') {
      await handleClear(entryId);
      return;
    }

    const points = Number(pointsRaw);
    const meetingDate = readCell(entryId, 'meetingDate');
    if (entry.points === points && entry.meetingDate === meetingDate) return;

    const scoreError = validateBonusScore(points, editCeiling(entry));
    if (scoreError) {
      errorEl.textContent = `${entry.studentId}: ${scoreError}`;
      errorEl.hidden = false;
      renderRows();
      return;
    }

    try {
      const result = await saveWithRetry({
        org,
        repo,
        path: BONUS_PATH,
        parse: parseBonusCsv,
        serialize: bonusToCsv,
        rows,
        sha,
        message: `Update bonus entry for ${entry.studentId}`,
        mutate: (r) =>
          updateBonusEntry(r, entryId, {
            points,
            meetingDate,
            recordedBy: getUserLogin() || '',
            now: new Date().toISOString(),
          }),
      });
      rows = result.rows;
      sha = result.sha;
      renderRows();
    } catch (err) {
      errorEl.textContent = describeSaveError(err, entry.studentId);
      errorEl.hidden = false;
      renderRows();
    }
  }

  async function handleClear(entryId) {
    const errorEl = container.querySelector('#bonus-history-error');
    errorEl.hidden = true;
    const existing = getBonusEntry(rows, entryId);
    if (!existing) return;

    try {
      const result = await saveWithRetry({
        org,
        repo,
        path: BONUS_PATH,
        parse: parseBonusCsv,
        serialize: bonusToCsv,
        rows,
        sha,
        message: `Clear bonus entry for ${existing.studentId}`,
        mutate: (r) => removeBonusEntry(r, entryId),
      });
      rows = result.rows;
      sha = result.sha;
      undoable.set(entryId, existing);
      renderRows();
      setTimeout(() => {
        if (undoable.get(entryId) === existing) {
          undoable.delete(entryId);
          renderRows();
        }
      }, 10000);
    } catch (err) {
      errorEl.textContent = describeSaveError(err, existing.studentId);
      errorEl.hidden = false;
      renderRows();
    }
  }

  // Restoring re-creates the entry (its entryId is gone once cleared), so
  // it gets a fresh recordedAt for the restore action — same convention
  // participation-history.js's Undo already uses — while still attributing
  // it to whoever originally recorded it.
  async function handleUndo(entryId) {
    const errorEl = container.querySelector('#bonus-history-error');
    errorEl.hidden = true;
    const previous = undoable.get(entryId);
    if (!previous) return;

    try {
      const result = await saveWithRetry({
        org,
        repo,
        path: BONUS_PATH,
        parse: parseBonusCsv,
        serialize: bonusToCsv,
        rows,
        sha,
        message: `Restore bonus entry for ${previous.studentId}`,
        mutate: (r) =>
          addBonusEntry(r, previous.studentId, {
            points: previous.points,
            meetingDate: previous.meetingDate,
            recordedBy: previous.recordedBy || getUserLogin() || '',
            now: new Date().toISOString(),
          }),
      });
      rows = result.rows;
      sha = result.sha;
      undoable.delete(entryId);
      renderRows();
    } catch (err) {
      errorEl.textContent = describeSaveError(err, previous.studentId);
      errorEl.hidden = false;
      renderRows();
    }
  }

  function describeSaveError(err, studentId) {
    if (err instanceof GitHubApiError && err.status === 409) {
      return `Could not save ${studentId}'s bonus after retrying — reload the page and try again.`;
    }
    return `Could not save ${studentId}'s bonus: ${err.message}`;
  }
}
