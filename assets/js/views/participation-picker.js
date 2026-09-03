import { getContents } from '../github-api.js';
import { setActiveCourse, addRecentCourse } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import { parseParticipationCsv, getScore, computeDrawWeight, weightedRandomIndex } from '../participation.js';

const DEFAULT_DRAW_SPACING_WEEKS = 12;

// Spin duration/feel: a chain of setTimeouts with increasing delay, so the
// number visibly slows down before landing — no animation library needed.
// The per-tick delay grows quadratically (not linearly) so the spin reads
// as a real deceleration — a quick flicker at the start, a long, obvious
// pause on the last couple of ticks — rather than a steady metronome.
const SPIN_TICKS = 15;
const SPIN_BASE_DELAY_MS = 70;
const SPIN_DELAY_QUADRATIC_MS = 4;

// Suspense beat: the number settles first, then — after this pause — the
// winner's name fades in. Splitting "it stopped" from "here's who" into two
// moments is what makes the reveal feel like a real draw instead of a
// number that happens to have a name printed under it.
const REVEAL_DELAY_MS = 700;

export async function renderParticipationPicker(container, { org, repo }, headerEl) {
  container.innerHTML = '<p>Loading roster…</p>';

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
  try {
    [rosterFile, participationFile] = await Promise.all([
      getContents(org, repo, 'students/roster.csv'),
      getContents(org, repo, 'grades/participation.csv'),
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

  const participationRows = participationFile ? parseParticipationCsv(participationFile.content) : [];
  const drawSpacingWeeks = config.participation?.drawSpacingWeeks ?? DEFAULT_DRAW_SPACING_WEEKS;
  const windowDays = drawSpacingWeeks * 7;

  let category = 'theory';
  let spinTimer = null;

  renderCard();

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Pick a Student</h2>

        <div class="category-toggle" role="group" aria-label="Category">
          <button type="button" id="category-theory" class="${category === 'theory' ? 'active' : ''}">Theory</button>
          <button type="button" id="category-lab" class="${category === 'lab' ? 'active' : ''}">Lab</button>
        </div>

        <div class="picker-layout">
          <div class="picker-list-col">
            <p>Students without a ${category === 'theory' ? 'Theory' : 'Lab'} score yet:</p>
            <ol id="picker-list" class="picker-list"></ol>
            <p id="picker-empty" class="row-status" hidden>Every student already has a score in this category.</p>
          </div>
          <div class="picker-draw-col">
            <div id="picker-number" class="picker-number">—</div>
            <div id="picker-winner" class="picker-winner"></div>
            <button type="button" id="picker-draw">Draw</button>
          </div>
        </div>
      </section>
    `;

    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });
    container.querySelector('#category-theory').addEventListener('click', () => {
      category = 'theory';
      stopSpin();
      renderCard();
    });
    container.querySelector('#category-lab').addEventListener('click', () => {
      category = 'lab';
      stopSpin();
      renderCard();
    });
    container.querySelector('#picker-draw').addEventListener('click', runDraw);

    renderList();
  }

  function eligibleStudents() {
    return students.filter((s) => getScore(participationRows, s.studentId, category) === null);
  }

  function renderList() {
    const eligible = eligibleStudents();
    const listEl = container.querySelector('#picker-list');
    const emptyEl = container.querySelector('#picker-empty');
    const drawBtn = container.querySelector('#picker-draw');

    listEl.innerHTML = eligible.map((s) => `<li>${escapeHtml(s.name)}</li>`).join('');
    emptyEl.hidden = eligible.length > 0;
    drawBtn.disabled = eligible.length === 0;
  }

  function stopSpin() {
    if (spinTimer) {
      clearTimeout(spinTimer);
      spinTimer = null;
    }
  }

  function runDraw() {
    const eligible = eligibleStudents();
    if (eligible.length === 0) return;

    stopSpin();
    const now = new Date().toISOString();
    const weights = eligible.map((s) => computeDrawWeight(participationRows, s.studentId, category, { now, windowDays }));
    const targetIndex = weightedRandomIndex(weights);
    const numberEl = container.querySelector('#picker-number');
    const winnerEl = container.querySelector('#picker-winner');
    const drawBtn = container.querySelector('#picker-draw');

    winnerEl.textContent = '';
    winnerEl.classList.remove('is-revealed');
    numberEl.classList.remove('is-landed');
    numberEl.classList.add('is-spinning');
    drawBtn.disabled = true;
    drawBtn.textContent = 'Drawing…';

    let tick = 0;
    const step = () => {
      tick++;
      const landing = tick >= SPIN_TICKS;
      const shown = landing ? targetIndex : Math.floor(Math.random() * eligible.length);
      numberEl.textContent = String(shown + 1);

      if (landing) {
        numberEl.classList.remove('is-spinning');
        numberEl.classList.add('is-landed');
        spinTimer = setTimeout(() => {
          winnerEl.textContent = eligible[targetIndex].name;
          winnerEl.classList.add('is-revealed');
          drawBtn.disabled = false;
          drawBtn.textContent = 'Draw';
          spinTimer = null;
        }, REVEAL_DELAY_MS);
        return;
      }
      spinTimer = setTimeout(step, SPIN_BASE_DELAY_MS + tick * tick * SPIN_DELAY_QUADRATIC_MS);
    };
    step();
  }
}
