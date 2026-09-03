import { getContents, putContents, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import { parseParticipationCsv } from '../participation.js';
import { parseWrittenActivityCsv } from '../written-activity.js';
import { parseBonusCsv } from '../bonus.js';
import { buildGradesSummary, gradesSummaryToCsv } from '../grades-summary.js';

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

  renderCard();

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Grades</h2>

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

        <div class="record-controls">
          <button type="button" id="export-csv">Export CSV</button>
          <span id="export-status" class="row-status"></span>
        </div>
        <p id="grades-error" class="error" hidden></p>
      </section>
    `;

    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });
    container.querySelector('#export-csv').addEventListener('click', handleExport);
  }

  function rowHtml(r) {
    return `
      <tr data-student-id="${escapeHtml(r.studentId)}">
        <td>${escapeHtml(r.name)} <span class="student-id">${escapeHtml(r.studentId)}</span></td>
        <td>${r.theory}</td>
        <td>${r.lab}</td>
        <td>${r.writtenActivity}</td>
        <td>${r.bonus}</td>
        <td class="total-col">${r.total} / ${r.max}</td>
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
