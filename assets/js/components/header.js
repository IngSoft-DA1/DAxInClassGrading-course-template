import { clearToken, getUserLogin } from '../session.js';
import { escapeHtml } from '../util.js';

export function renderHeader(container, course) {
  if (!container) return;

  if (!course) {
    container.innerHTML = '<div class="banner"><span class="app-title">DAxInClassGrading</span></div>';
    return;
  }

  const base = `#/course/${encodeURIComponent(course.org)}/${encodeURIComponent(course.repo)}`;
  const login = getUserLogin();

  container.innerHTML = `
    <div class="banner">
      <span class="app-title">DAxInClassGrading</span>
      <span class="session-id">${escapeHtml(course.sessionId)}</span>
      <span class="course-repo">${escapeHtml(course.org)}/${escapeHtml(course.repo)}</span>
      <nav class="header-nav">
        <a href="${base}">Home</a>
        <a href="${base}/participation/picker">Pick a Student</a>
        <a href="${base}/participation">Participation</a>
        <a href="${base}/bonus">Bonus</a>
        <a href="${base}/written-activity">Written Activity</a>
        <a href="${base}/grades">Grades</a>
        <a href="${base}/roster">Roster</a>
        <a href="${base}/photos">Photos</a>
      </nav>
      <span class="spacer"></span>
      ${login ? `<span class="signed-in-as">Signed in as ${escapeHtml(login)}</span>` : ''}
      <button type="button" id="sign-out">Sign out</button>
    </div>
  `;

  container.querySelector('#sign-out').addEventListener('click', () => {
    clearToken();
    location.hash = '#/connect';
  });
}
