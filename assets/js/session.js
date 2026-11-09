const NS = 'daxg';
const TOKEN_KEY = `${NS}:token`;
const USER_LOGIN_KEY = `${NS}:userLogin`;
const RECENT_KEY = `${NS}:recentCourses`;
const ACTIVE_KEY = `${NS}:activeCourse`;

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_LOGIN_KEY);
  localStorage.removeItem(ACTIVE_KEY);
}

export function getUserLogin() {
  return localStorage.getItem(USER_LOGIN_KEY);
}

export function setUserLogin(login) {
  localStorage.setItem(USER_LOGIN_KEY, login);
}

export function getRecentCourses() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

export function addRecentCourse(course) {
  const existing = getRecentCourses().filter(
    (c) => !(c.org === course.org && c.repo === course.repo)
  );
  existing.unshift(course);
  localStorage.setItem(RECENT_KEY, JSON.stringify(existing.slice(0, 20)));
}

export function getActiveCourse() {
  try {
    return JSON.parse(localStorage.getItem(ACTIVE_KEY) || 'null');
  } catch {
    return null;
  }
}

export function setActiveCourse(course) {
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(course));
}

export function clearActiveCourse() {
  localStorage.removeItem(ACTIVE_KEY);
}
