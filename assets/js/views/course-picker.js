import { getRecentCourses, clearToken } from '../session.js';
import { getContents, templateGenerateUrl } from '../github-api.js';
import { escapeHtml } from '../util.js';

export function renderCoursePicker(container) {
  const recents = getRecentCourses();

  container.innerHTML = `
    <section class="card">
      <h2>Your courses</h2>
      ${
        recents.length
          ? `<ul id="recent-list" class="list">${recents
              .map(
                (c) =>
                  `<li><a href="#/course/${encodeURIComponent(c.org)}/${encodeURIComponent(
                    c.repo
                  )}">${escapeHtml(c.sessionId)} — ${escapeHtml(c.org)}/${escapeHtml(c.repo)}</a></li>`
              )
              .join('')}</ul>`
          : '<p>No recent courses yet.</p>'
      }
    </section>

    <section class="card">
      <h3>Open a course</h3>
      <p>Already created a course repository from the template? Enter it here.</p>
      <form id="open-form">
        <label for="open-org">Organization</label>
        <input id="open-org" required />
        <label for="open-repo">Repository name</label>
        <input id="open-repo" required />
        <button type="submit">Open</button>
      </form>
      <p id="open-error" class="error" hidden></p>
    </section>

    <section class="card">
      <h3>Start a new course</h3>
      <p>
        Create the course's private repository directly on GitHub from the
        course template, then open it above.
      </p>
      <p>
        <a href="${templateGenerateUrl()}" target="_blank" rel="noopener">
          <button type="button">Create repository from template</button>
        </a>
      </p>
    </section>

    <p><button type="button" id="sign-out">Sign out</button></p>
  `;

  container.querySelector('#open-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const org = container.querySelector('#open-org').value.trim();
    const repo = container.querySelector('#open-repo').value.trim();
    const errorEl = container.querySelector('#open-error');
    errorEl.hidden = true;
    try {
      const file = await getContents(org, repo, 'config/course.json');
      if (!file) {
        throw new Error(
          'config/course.json not found. Make sure the repository exists, you have access to it, and it was created from the course template.'
        );
      }
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    } catch (err) {
      errorEl.textContent = `Could not open repository: ${err.message}`;
      errorEl.hidden = false;
    }
  });

  container.querySelector('#sign-out').addEventListener('click', () => {
    clearToken();
    location.hash = '#/connect';
  });
}
