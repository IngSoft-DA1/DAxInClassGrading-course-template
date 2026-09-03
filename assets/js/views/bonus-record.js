import { getContents, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse, getUserLogin } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import { parseParticipationCsv, getScore } from '../participation.js';
import { parseWrittenActivityCsv, getWrittenActivity } from '../written-activity.js';
import { parseBonusCsv, bonusToCsv, getBonusTotal, addBonusEntry } from '../bonus.js';
import { saveWithRetry } from '../save-with-retry.js';

const BONUS_PATH = 'grades/bonus.csv';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function renderBonusRecord(container, { org, repo }, headerEl) {
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

  const participationRows = participationFile ? parseParticipationCsv(participationFile.content) : [];
  const writtenActivityRows = writtenActivityFile ? parseWrittenActivityCsv(writtenActivityFile.content) : [];
  let rows = bonusFile ? parseBonusCsv(bonusFile.content) : [];
  let sha = bonusFile ? bonusFile.sha : undefined;

  // The in-class-performance cap is derived, never stored (see
  // views/course-home.js) — Theory/Lab/Written Activity can never exceed it
  // on their own since it's defined as the sum of their maxes, so only
  // Bonus needs a per-student headroom check against it.
  const cap = config.participation.theory.max + config.participation.lab.max + config.writtenActivity.max;

  function awardCeiling(studentId) {
    const earnedBase =
      (getScore(participationRows, studentId, 'theory')?.points ?? 0) +
      (getScore(participationRows, studentId, 'lab')?.points ?? 0) +
      (getWrittenActivity(writtenActivityRows, studentId)?.points ?? 0);
    return Math.max(0, Math.min(config.bonus.max, cap - earnedBase));
  }

  let meetingDate = todayIso();
  let searchTerm = '';
  let savingId = null;
  let flashId = null;

  renderCard();

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Record bonus</h2>
        <nav class="participation-tabs">
          <span class="active">Record</span>
          <a href="#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/bonus/history">History</a>
          <a href="#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/bonus/by-date">Points by Date</a>
        </nav>

        <div class="record-controls">
          <label for="meeting-date">Meeting date</label>
          <input type="date" id="meeting-date" value="${escapeHtml(meetingDate)}" />
          <label for="student-search">Search</label>
          <input type="search" id="student-search" placeholder="Filter by name, ID, or handle" value="${escapeHtml(searchTerm)}" />
        </div>

        <ul class="participation-list" id="bonus-list"></ul>
        <p id="bonus-error" class="error" hidden></p>
      </section>
    `;

    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
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
    const listEl = container.querySelector('#bonus-list');
    const term = searchTerm.trim().toLowerCase();
    const filtered = students.filter((s) => {
      if (!term) return true;
      return (
        s.studentId.toLowerCase().includes(term) ||
        s.name.toLowerCase().includes(term) ||
        s.handle.toLowerCase().includes(term)
      );
    });

    listEl.innerHTML = filtered.map((s) => rowHtml(s)).join('') || '<li>No students match.</li>';

    listEl.querySelectorAll('.score-btn').forEach((btn) => {
      btn.addEventListener('click', () => handleAdd(btn.dataset.studentId, Number(btn.dataset.points)));
    });
  }

  function rowHtml(student) {
    const total = getBonusTotal(rows, student.studentId);
    const ceiling = awardCeiling(student.studentId);
    const remaining = Math.max(0, ceiling - total);
    const badge = `<span class="badge ${total > 0 ? 'badge-active' : 'badge-none'}">Bonus: ${total} / ${ceiling} pts</span>`;
    const buttons = [];
    for (let n = 1; n <= remaining; n++) {
      buttons.push(
        `<button type="button" class="score-btn" data-student-id="${escapeHtml(student.studentId)}" data-points="${n}">+${n}</button>`
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
          ${badge}
        </div>
        <div class="score-buttons">${buttons.join('')}</div>
        ${status}
      </li>
    `;
  }

  async function handleAdd(studentId, points) {
    const errorEl = container.querySelector('#bonus-error');
    errorEl.hidden = true;
    savingId = studentId;
    flashId = null;
    renderList();

    try {
      const result = await saveWithRetry({
        org,
        repo,
        path: BONUS_PATH,
        parse: parseBonusCsv,
        serialize: bonusToCsv,
        rows,
        sha,
        message: `Award ${points} bonus point(s) to ${studentId}`,
        mutate: (r) =>
          addBonusEntry(r, studentId, {
            points,
            meetingDate,
            recordedBy: getUserLogin() || '',
            now: new Date().toISOString(),
          }),
      });
      rows = result.rows;
      sha = result.sha;
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
      return `Could not save ${studentId}'s bonus after retrying — reload the page and try again.`;
    }
    return `Could not save ${studentId}'s bonus: ${err.message}`;
  }
}
