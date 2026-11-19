import { getToken, getActiveCourse } from './session.js';
import { renderConnect } from './views/connect.js';
import { renderCoursePicker } from './views/course-picker.js';
import { renderCourseHome } from './views/course-home.js';
import { renderRoster } from './views/roster.js';
import { renderParticipationRecord } from './views/participation-record.js';
import { renderParticipationHistory } from './views/participation-history.js';
import { renderParticipationPicker } from './views/participation-picker.js';
import { renderWrittenActivity } from './views/written-activity.js';
import { renderBonusRecord } from './views/bonus-record.js';
import { renderBonusHistory } from './views/bonus-history.js';
import { renderBonusByDate } from './views/bonus-by-date.js';
import { renderGradesSummary } from './views/grades-summary.js';
import { renderRosterPhotos } from './views/roster-photos.js';
import { renderHeader } from './components/header.js';
import { resolveCourseContext } from './course-context.js';

const appEl = document.getElementById('app');
const headerEl = document.getElementById('header');

function parseHash() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

function route() {
  const parts = parseHash();
  const token = getToken();

  // Only the roster view needs the wider container — reset it here so
  // every other branch (including the early returns below) stays narrow.
  appEl.classList.remove('wide');

  if (!token || parts[0] === 'connect') {
    renderHeader(headerEl, null);
    renderConnect(appEl);
    return;
  }

  if (parts[0] === 'course' && parts[1] && parts[2]) {
    const org = decodeURIComponent(parts[1]);
    const repo = decodeURIComponent(parts[2]);
    const cached = getActiveCourse();
    renderHeader(
      headerEl,
      cached && cached.org === org && cached.repo === repo ? cached : { org, repo, sessionId: '…' }
    );
    const section = parts[3];
    appEl.classList.toggle(
      'wide',
      section === 'roster' ||
        section === 'participation' ||
        section === 'written-activity' ||
        section === 'bonus' ||
        section === 'grades' ||
        section === 'photos'
    );
    if (section === 'roster') {
      renderRoster(appEl, { org, repo }, headerEl);
    } else if (section === 'photos') {
      renderRosterPhotos(appEl, { org, repo }, headerEl);
    } else if (section === 'participation' && parts[4] === 'history') {
      renderParticipationHistory(appEl, { org, repo }, headerEl);
    } else if (section === 'participation' && parts[4] === 'picker') {
      renderParticipationPicker(appEl, { org, repo }, headerEl);
    } else if (section === 'participation') {
      renderParticipationRecord(appEl, { org, repo }, headerEl);
    } else if (section === 'written-activity') {
      renderWrittenActivity(appEl, { org, repo }, headerEl);
    } else if (section === 'bonus' && parts[4] === 'history') {
      renderBonusHistory(appEl, { org, repo }, headerEl);
    } else if (section === 'bonus' && parts[4] === 'by-date') {
      renderBonusByDate(appEl, { org, repo }, headerEl);
    } else if (section === 'bonus') {
      renderBonusRecord(appEl, { org, repo }, headerEl);
    } else if (section === 'grades') {
      renderGradesSummary(appEl, { org, repo }, headerEl);
    } else {
      renderCourseHome(appEl, { org, repo }, headerEl);
    }
    return;
  }

  // Each course repo hosts its own copy of this app on its own Pages site,
  // so the org/repo can usually be inferred from the URL — skip the picker
  // entirely for that primary case. Falls through to the picker (used for
  // local dev, or if the host isn't a recognized Pages URL) otherwise.
  const detected = resolveCourseContext();
  if (detected) {
    location.hash = `#/course/${encodeURIComponent(detected.org)}/${encodeURIComponent(detected.repo)}`;
    return;
  }

  renderHeader(headerEl, null);
  renderCoursePicker(appEl);
}

window.addEventListener('hashchange', route);
route();
