import { setToken, clearToken, setUserLogin } from '../session.js';
import { getCurrentUser, GitHubApiError } from '../github-api.js';
import { resolveCourseContext } from '../course-context.js';

// Fine-grained PATs (unlike classic tokens) can be scoped to a single repo
// and organization instead of every repo/org the instructor can access, and
// their creation page supports pre-filling permissions and the resource
// owner via query params (GitHub's Aug 2025 "template URLs" change). We
// still can't pre-select the repo itself — the instructor picks that on
// GitHub's form — so the link text below spells that step out.
function tokenCreateUrl() {
  const context = resolveCourseContext();
  const params = new URLSearchParams({
    name: 'DAxInClassGrading',
    description: 'Grades/roster access for this course (and org, if selected)',
    expires_in: '90',
    contents: 'write',
    administration: 'write',
    members: 'write',
  });
  if (context) params.set('target_name', context.org);
  return `https://github.com/settings/personal-access-tokens/new?${params}`;
}

export function renderConnect(container) {
  container.innerHTML = `
    <section class="card">
      <h1>DAxInClassGrading</h1>
      <p>Paste a GitHub Personal Access Token to continue.</p>
      <p>
        <a href="${tokenCreateUrl()}" target="_blank" rel="noopener">Create a token scoped to this course</a>
        — on GitHub's form, under "Repository access", choose "Only select repositories" and pick this course's repo
        (pick every course repo under this org there if you want one token to cover all of them).
      </p>
      <form id="connect-form">
        <label for="pat">Personal Access Token</label>
        <input type="password" id="pat" name="pat" autocomplete="off" required />
        <button type="submit">Connect</button>
      </form>
      <p id="connect-error" class="error" hidden></p>
    </section>
  `;

  const form = container.querySelector('#connect-form');
  const errorEl = container.querySelector('#connect-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const token = form.pat.value.trim();
    const submitBtn = form.querySelector('button');
    submitBtn.disabled = true;
    try {
      setToken(token);
      const user = await getCurrentUser();
      setUserLogin(user.login);
      location.hash = '#/courses';
    } catch (err) {
      clearToken();
      errorEl.textContent =
        err instanceof GitHubApiError && err.status === 401
          ? 'That token was rejected by GitHub. Check it and try again.'
          : `Could not verify token: ${err.message}`;
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });
}
