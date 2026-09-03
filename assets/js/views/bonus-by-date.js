import { getContents } from '../github-api.js';
import { setActiveCourse, addRecentCourse } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import { parseBonusCsv, listBonusMeetingDates, getBonusPointsForDate, getBonusTotal } from '../bonus.js';

const BONUS_PATH = 'grades/bonus.csv';

// Read-only positional view: one row per student, one column per class
// meeting date that has at least one bonus award, each cell showing that
// student's points for that date (summed, if more than one award landed
// on the same date) — see bonus.js's listBonusMeetingDates/
// getBonusPointsForDate. Editing stays in bonus-history.js; this view is
// purely a "where did the points come from" overview.
export async function renderBonusByDate(container, { org, repo }, headerEl) {
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
  let bonusFile;
  try {
    [rosterFile, bonusFile] = await Promise.all([
      getContents(org, repo, 'students/roster.csv'),
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

  const rows = bonusFile ? parseBonusCsv(bonusFile.content) : [];
  const sessions = listBonusMeetingDates(rows);

  let searchTerm = '';

  renderCard();

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Bonus — Points by date</h2>
        <nav class="participation-tabs">
          <a href="#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/bonus">Record</a>
          <a href="#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/bonus/history">History</a>
          <span class="active">Points by Date</span>
        </nav>

        ${
          sessions.length === 0
            ? '<p>No bonus awards recorded yet.</p>'
            : `
              <div class="record-controls">
                <label for="student-search">Search</label>
                <input type="search" id="student-search" placeholder="Filter by name, ID, or handle" value="${escapeHtml(searchTerm)}" />
              </div>
              <div class="participation-table-wrap">
                <table class="participation-table" id="bonus-by-date-table">
                  <thead>
                    <tr>
                      <th>Student</th>
                      ${sessions.map((date) => `<th>${escapeHtml(date)}</th>`).join('')}
                      <th>Total points</th>
                    </tr>
                  </thead>
                  <tbody id="bonus-by-date-body"></tbody>
                </table>
              </div>
            `
        }
      </section>
    `;

    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });

    if (sessions.length === 0) return;

    container.querySelector('#student-search').addEventListener('input', (e) => {
      searchTerm = e.target.value;
      renderRows();
    });

    renderRows();
  }

  function renderRows() {
    const tbody = container.querySelector('#bonus-by-date-body');
    const term = searchTerm.trim().toLowerCase();
    const filtered = students.filter((s) => {
      if (!term) return true;
      return (
        s.studentId.toLowerCase().includes(term) ||
        s.name.toLowerCase().includes(term) ||
        s.handle.toLowerCase().includes(term)
      );
    });

    tbody.innerHTML = filtered.map((s) => rowHtml(s)).join('') || '<tr><td colspan="' + (sessions.length + 2) + '">No students match.</td></tr>';
  }

  function rowHtml(student) {
    const cells = sessions
      .map((date) => `<td>${getBonusPointsForDate(rows, student.studentId, date)}</td>`)
      .join('');
    return `
      <tr data-student-id="${escapeHtml(student.studentId)}">
        <td>${escapeHtml(student.name)} <span class="student-id">${escapeHtml(student.studentId)}</span></td>
        ${cells}
        <td class="total-col">${getBonusTotal(rows, student.studentId)}</td>
      </tr>
    `;
  }
}
