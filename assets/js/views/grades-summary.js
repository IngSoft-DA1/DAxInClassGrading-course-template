import { getContents, putContents, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import { parseParticipationCsv } from '../participation.js';
import { parseWrittenActivityCsv } from '../written-activity.js';
import { parseBonusCsv } from '../bonus.js';
import {
  buildGradesSummary,
  gradesSummaryToCsv,
  PENDING_MARK,
  ABSENT_MARK,
  GRADES_KEY_LINES,
} from '../grades-summary.js';

const SUMMARY_PATH = 'grades/summary.csv';

function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function renderGradesSummary(container, { org, repo }, headerEl) {
  container.innerHTML = '<p>Loading grades…</p>';

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
  let summaryFile;
  try {
    [rosterFile, participationFile, writtenActivityFile, bonusFile, summaryFile] = await Promise.all([
      getContents(org, repo, 'students/roster.csv'),
      getContents(org, repo, 'grades/participation.csv'),
      getContents(org, repo, 'grades/written-activity.csv'),
      getContents(org, repo, 'grades/bonus.csv'),
      getContents(org, repo, SUMMARY_PATH),
    ]);
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load grades: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const { students, errors: rosterErrors } = parseRosterCsv(rosterFile ? rosterFile.content : '');
  if (rosterErrors.length) {
    container.innerHTML = `<p class="error">${escapeHtml(rosterErrors[0])}</p>`;
    return;
  }

  const participationRows = participationFile ? parseParticipationCsv(participationFile.content) : [];
  const writtenActivityRows = writtenActivityFile ? parseWrittenActivityCsv(writtenActivityFile.content) : [];
  const bonusRows = bonusFile ? parseBonusCsv(bonusFile.content) : [];
  let summarySha = summaryFile ? summaryFile.sha : undefined;

  const rows = buildGradesSummary(students, { participationRows, writtenActivityRows, bonusRows, config });
  // Students with a still-Pending participation grade: shown as "Pending"
  // (never 0), warned about, and confirmed before exporting.
  const pendingRows = rows.filter((r) => r.pendingItems.length > 0);

  renderCard();

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Grades</h2>
        <p class="print-only print-meta">${escapeHtml(config.sessionId)} · ${escapeHtml(org)}/${escapeHtml(repo)} · ${escapeHtml(new Date().toISOString().slice(0, 10))}</p>

        ${pendingWarningHtml()}

        <div class="participation-table-wrap">
          <table class="participation-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Theory</th>
                <th>Lab</th>
                <th>Written Activity</th>
                <th>Bonus</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => rowHtml(r)).join('') || '<tr><td colspan="6">No students yet.</td></tr>'}
            </tbody>
          </table>
        </div>

        ${keyHtml()}

        <div class="record-controls">
          <button type="button" id="export-csv">Export CSV</button>
          <button type="button" id="export-pdf">Download PDF</button>
          <span id="export-status" class="row-status"></span>
        </div>
        <div id="export-confirm-slot"></div>
        <p id="grades-error" class="error" hidden></p>
      </section>
    `;

    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });
    container.querySelector('#export-csv').addEventListener('click', () => requestExport());
    container.querySelector('#export-pdf').addEventListener('click', () => requestExport(printReport));
  }

  // PDF export is the browser's print dialog ("Save as PDF"), styled by the
  // @media print rules in styles.css. Nothing is written to the repo.
  function printReport() {
    const previousTitle = document.title;
    document.title = `${config.sessionId || 'grades'}-grades`;
    const restore = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  function pendingLabel(r) {
    return `${r.name} (${r.studentId}) - ${r.pendingItems.join(', ')}`;
  }

  function pendingWarningHtml() {
    if (pendingRows.length === 0) return '';
    return `
      <div id="pending-warning" class="pending-warning" role="status">
        <b>${pendingRows.length} student${pendingRows.length === 1 ? ' has' : 's have'} a participation grade still pending.</b>
        Their totals count only the points given so far (pending counts as 0) until graded in Participation.
        <ul>${pendingRows.map((r) => `<li>${escapeHtml(pendingLabel(r))}</li>`).join('')}</ul>
      </div>
    `;
  }

  // Exporting while anything is Pending asks first (in-page, not a native
  // confirm() - this app never uses one): the CSV would leave those cells and
  // totals blank.
  function requestExport(action = handleExport) {
    if (pendingRows.length === 0) {
      action();
      return;
    }
    const slot = container.querySelector('#export-confirm-slot');
    slot.innerHTML = `
      <div id="export-confirm" class="pending-warning" role="alert">
        <p>Export with pending grades? These students' pending cells will be marked "p" in the export and their totals count only the points given:</p>
        <ul>${pendingRows.map((r) => `<li>${escapeHtml(pendingLabel(r))}</li>`).join('')}</ul>
        <button type="button" id="export-confirm-yes">Export anyway</button>
        <button type="button" id="export-confirm-cancel">Cancel</button>
      </div>
    `;
    slot.querySelector('#export-confirm-yes').addEventListener('click', () => {
      slot.innerHTML = '';
      action();
    });
    slot.querySelector('#export-confirm-cancel').addEventListener('click', () => {
      slot.innerHTML = '';
    });
  }

  function markCell(mark, points) {
    if (mark === PENDING_MARK) return `<span class="mark" title="Pending">${mark}</span>`;
    if (mark === ABSENT_MARK) return `<span class="mark" title="Absent">${mark}</span>`;
    return String(points);
  }

  function keyHtml() {
    return `
      <ul id="grades-key" class="grades-key">
        ${GRADES_KEY_LINES.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}
      </ul>
    `;
  }

  function rowHtml(r) {
    return `
      <tr data-student-id="${escapeHtml(r.studentId)}">
        <td>${escapeHtml(r.name)} <span class="student-id">${escapeHtml(r.studentId)}</span></td>
        <td>${markCell(r.theoryMark, r.theory)}</td>
        <td>${markCell(r.labMark, r.lab)}</td>
        <td>${r.writtenActivity}</td>
        <td>${r.bonus}</td>
        <td class="total-col">${r.total} / ${r.max}${r.pendingItems.length ? ' <span class="mark" title="Total excludes pending grades">p</span>' : ''}</td>
      </tr>
    `;
  }

  async function handleExport() {
    const csv = gradesSummaryToCsv(rows);
    downloadCsv(`${config.sessionId || 'grades'}-summary.csv`, csv);

    const statusEl = container.querySelector('#export-status');
    const errorEl = container.querySelector('#grades-error');
    errorEl.hidden = true;
    statusEl.textContent = 'Saving…';
    statusEl.classList.remove('saved');

    try {
      const result = await putSummaryWithRetry(csv);
      summarySha = result.content.sha;
      statusEl.textContent = 'Saved';
      statusEl.classList.add('saved');
      setTimeout(() => {
        if (statusEl.textContent === 'Saved') statusEl.textContent = '';
      }, 1500);
    } catch (err) {
      statusEl.textContent = '';
      errorEl.textContent = describeSaveError(err);
      errorEl.hidden = false;
    }
  }

  async function putSummaryWithRetry(csv) {
    try {
      return await putContents(org, repo, SUMMARY_PATH, csv, 'Export grades summary', summarySha);
    } catch (err) {
      if (!(err instanceof GitHubApiError) || err.status !== 409) throw err;
      const fresh = await getContents(org, repo, SUMMARY_PATH);
      summarySha = fresh ? fresh.sha : undefined;
      return putContents(org, repo, SUMMARY_PATH, csv, 'Export grades summary', summarySha);
    }
  }

  function describeSaveError(err) {
    if (err instanceof GitHubApiError && err.status === 409) {
      return 'Could not save the grades snapshot after retrying — reload the page and try again.';
    }
    return `Could not save the grades snapshot: ${err.message}`;
  }
}
