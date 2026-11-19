import { getContents, putContents, listCollaborators, addCollaborator, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';

export async function renderCourseHome(container, { org, repo }, headerEl) {
  container.innerHTML = '<p>Loading course…</p>';

  let file;
  try {
    file = await getContents(org, repo, 'config/course.json');
    if (!file) {
      throw new Error(
        'config/course.json not found. Make sure the repository exists, you have access to it, and it was created from the course template.'
      );
    }
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load course: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const config = JSON.parse(file.content);

  if (!config.sessionId) {
    if (headerEl) renderHeader(headerEl, null);
    renderConfigureForm(container, { org, repo, sha: file.sha, config }, headerEl);
    return;
  }

  setActiveCourse({ org, repo, sessionId: config.sessionId });
  addRecentCourse({ org, repo, sessionId: config.sessionId });
  if (headerEl) renderHeader(headerEl, { org, repo, sessionId: config.sessionId });

  renderSummary(container, { org, repo, config });
}

function renderConfigureForm(container, { org, repo, sha, config }, headerEl) {
  container.innerHTML = `
    <section class="card">
      <h2>Configure this course</h2>
      <p>${escapeHtml(org)}/${escapeHtml(repo)}</p>
      <p>This repository hasn't been configured yet. Fill in the details below to start using it.</p>
      <form id="configure-form">
        <label for="session-id">Course Session ID</label>
        <input id="session-id" placeholder="e.g. M5ADA1-ID" required />

        <fieldset>
          <legend>Theory participation</legend>
          <label for="theory-max">Max points</label>
          <input id="theory-max" type="number" min="0" step="1" value="${config.participation?.theory?.max ?? 2}" required />
        </fieldset>

        <fieldset>
          <legend>Lab participation</legend>
          <label for="lab-max">Max points</label>
          <input id="lab-max" type="number" min="0" step="1" value="${config.participation?.lab?.max ?? 2}" required />
        </fieldset>

        <fieldset>
          <legend>Random student picker</legend>
          <p class="field-hint">
            Spreads a student's Theory and Lab draws apart across the
            course instead of picking them for both close together.
          </p>
          <label for="draw-spacing-weeks">Weeks between draws to aim for</label>
          <input
            id="draw-spacing-weeks"
            type="number"
            min="1"
            step="1"
            value="${config.participation?.drawSpacingWeeks ?? 12}"
            required
          />
        </fieldset>

        <fieldset>
          <legend>Written activity</legend>
          <p class="field-hint">
            Single max, shared by the official date and the make-up sitting —
            a student only ever earns one of the two.
          </p>
          <label for="written-activity-max">Max points</label>
          <input id="written-activity-max" type="number" min="0" step="1" value="${config.writtenActivity?.max ?? 6}" required />
        </fieldset>

        <fieldset>
          <legend>Bonus</legend>
          <label for="bonus-max">Max points</label>
          <input id="bonus-max" type="number" min="0" step="1" value="${config.bonus?.max ?? 3}" required />
        </fieldset>

        <button type="submit">Save configuration</button>
      </form>
      <p id="configure-error" class="error" hidden></p>
    </section>
  `;

  container.querySelector('#configure-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const errorEl = container.querySelector('#configure-error');
    const submitBtn = form.querySelector('button[type=submit]');
    errorEl.hidden = true;
    submitBtn.disabled = true;

    const updatedConfig = {
      ...config,
      sessionId: form['session-id'].value.trim(),
      org,
      repoName: repo,
      createdAt: config.createdAt || new Date().toISOString(),
      participation: {
        theory: { max: Number(form['theory-max'].value) },
        lab: { max: Number(form['lab-max'].value) },
        drawSpacingWeeks: Number(form['draw-spacing-weeks'].value),
      },
      writtenActivity: { max: Number(form['written-activity-max'].value) },
      bonus: { max: Number(form['bonus-max'].value) },
    };

    try {
      await putContents(
        org,
        repo,
        'config/course.json',
        `${JSON.stringify(updatedConfig, null, 2)}\n`,
        'Configure course',
        sha
      );
      setActiveCourse({ org, repo, sessionId: updatedConfig.sessionId });
      addRecentCourse({ org, repo, sessionId: updatedConfig.sessionId });
      if (headerEl) renderHeader(headerEl, { org, repo, sessionId: updatedConfig.sessionId });
      renderSummary(container, { org, repo, config: updatedConfig });
    } catch (err) {
      errorEl.textContent = describeConfigureError(err);
      errorEl.hidden = false;
      submitBtn.disabled = false;
    }
  });
}

function renderSummary(container, { org, repo, config }) {
  container.innerHTML = `
    <section class="card">
      <h2>${escapeHtml(config.sessionId)}</h2>
      <p>${escapeHtml(org)}/${escapeHtml(repo)}</p>
      <dl class="summary">
        <dt>Theory participation max</dt>
        <dd>${config.participation.theory.max} pts</dd>
        <dt>Lab participation max</dt>
        <dd>${config.participation.lab.max} pts</dd>
        <dt>Written activity max</dt>
        <dd>${config.writtenActivity.max} pts</dd>
        <dt>Bonus max</dt>
        <dd>${config.bonus.max} pts</dd>
        <dt>Picker draw spacing</dt>
        <dd>${config.participation.drawSpacingWeeks ?? 12} weeks</dd>
        <dt>In-class performance cap</dt>
        <dd id="in-class-cap">${config.participation.theory.max + config.participation.lab.max + config.writtenActivity.max} pts</dd>
      </dl>
      <nav class="actions">
        <a
          id="nav-picker"
          href="#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/participation/picker"
        >Pick a Student</a>
        <button type="button" id="nav-participation">Participation</button>
        <button type="button" id="nav-bonus">Bonus</button>
        <button type="button" id="nav-written-activity">Written Activity</button>
        <button type="button" id="nav-grades">Grades</button>
        <button type="button" id="nav-roster">Roster</button>
        <button type="button" id="nav-photos">Photos</button>
      </nav>
    </section>

    <section class="card">
      <h3>Instructors</h3>
      <ul id="instructor-list" class="list"><li>Loading…</li></ul>
      <form id="add-instructor-form">
        <label for="instructor-handle">GitHub handle</label>
        <input id="instructor-handle" required />
        <button type="submit">Add instructor</button>
      </form>
      <p id="instructor-error" class="error" hidden></p>
    </section>
  `;

  refreshInstructors(container, org, repo);

  container.querySelector('#nav-participation').addEventListener('click', () => {
    location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/participation`;
  });

  container.querySelector('#nav-bonus').addEventListener('click', () => {
    location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/bonus`;
  });

  container.querySelector('#nav-written-activity').addEventListener('click', () => {
    location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/written-activity`;
  });

  container.querySelector('#nav-grades').addEventListener('click', () => {
    location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/grades`;
  });

  container.querySelector('#nav-roster').addEventListener('click', () => {
    location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/roster`;
  });

  container.querySelector('#nav-photos').addEventListener('click', () => {
    location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/photos`;
  });

  container.querySelector('#add-instructor-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = container.querySelector('#instructor-handle');
    const handle = input.value.trim();
    const errorEl = container.querySelector('#instructor-error');
    const btn = e.target.querySelector('button');
    errorEl.hidden = true;
    btn.disabled = true;
    try {
      await addCollaborator(org, repo, handle, 'push');
      input.value = '';
      await refreshInstructors(container, org, repo);
    } catch (err) {
      errorEl.textContent = `Could not add ${handle}: ${err.message}`;
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}

async function refreshInstructors(container, org, repo) {
  const listEl = container.querySelector('#instructor-list');
  try {
    const collaborators = await listCollaborators(org, repo);
    listEl.innerHTML = collaborators.length
      ? collaborators.map((c) => `<li>${escapeHtml(c.login)}</li>`).join('')
      : '<li>No instructors listed yet.</li>';
  } catch (err) {
    listEl.innerHTML = `<li class="error">Could not load instructors: ${escapeHtml(err.message)}</li>`;
  }
}

function describeConfigureError(err) {
  if (err instanceof GitHubApiError && err.status === 409) {
    return 'This file changed elsewhere since it was loaded. Reload the page and try again.';
  }
  return `Could not save configuration: ${err.message}`;
}
