import { getToken } from './session.js';

// Maintained per Phase 0 of docs/plan1.md — a public repo, marked "Template
// repository", seeded from this repo's template/ directory. Instructors
// generate their own course repo from it directly on GitHub (see
// templateGenerateUrl below) — the app never calls the generate API itself.
export const TEMPLATE_OWNER = 'IngSoft-DA1';
export const TEMPLATE_REPO = 'DAxInClassGrading-course-template';

export function templateGenerateUrl() {
  return `https://github.com/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/generate`;
}

const API_BASE = 'https://api.github.com';

export class GitHubApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = 'GitHubApiError';
    this.status = status;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const message = (data && data.message) || res.statusText || `HTTP ${res.status}`;
    throw new GitHubApiError(res.status, message, data);
  }

  return data;
}

export function getCurrentUser() {
  return request('/user');
}

export async function getContents(owner, repo, path) {
  try {
    const data = await request(`/repos/${owner}/${repo}/contents/${path}`);
    if (Array.isArray(data)) {
      throw new Error(`${path} is a directory, not a file`);
    }
    return { sha: data.sha, content: decodeBase64Utf8(data.content) };
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return null;
    throw err;
  }
}

export function putContents(owner, repo, path, content, message, sha) {
  return request(`/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: {
      message,
      content: encodeBase64Utf8(content),
      ...(sha ? { sha } : {}),
    },
  });
}

// Binary-safe counterparts of getContents/putContents — content is passed
// through as raw base64 rather than round-tripped through TextEncoder/
// TextDecoder, which would corrupt non-UTF-8 bytes (e.g. JPEG data). Used
// by the student-photos feature; every other file in the app is text and
// keeps using getContents/putContents.
export async function getContentsBase64(owner, repo, path) {
  try {
    const data = await request(`/repos/${owner}/${repo}/contents/${path}`);
    if (Array.isArray(data)) {
      throw new Error(`${path} is a directory, not a file`);
    }
    return { sha: data.sha, base64: data.content.replace(/\n/g, '') };
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return null;
    throw err;
  }
}

export function putContentsBase64(owner, repo, path, base64Content, message, sha) {
  return request(`/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    body: {
      message,
      content: base64Content,
      ...(sha ? { sha } : {}),
    },
  });
}

// Lists a directory's immediate entries via the same Contents API endpoint
// (GitHub returns an array instead of a single file object when the path
// is a directory). Returns [] for a path that doesn't exist yet — lets
// callers treat "directory never created" and "directory exists but empty"
// the same way, matching how lazily-created data files are treated
// elsewhere in this app (see AGENTS.md).
export async function listDirectory(owner, repo, path) {
  try {
    const data = await request(`/repos/${owner}/${repo}/contents/${path}`);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return [];
    throw err;
  }
}

export async function listCollaborators(owner, repo) {
  const collaborators = await request(`/repos/${owner}/${repo}/collaborators?affiliation=direct`);
  return collaborators.filter(
    (c) => c.permissions && (c.permissions.push || c.permissions.maintain || c.permissions.admin)
  );
}

export function addCollaborator(owner, repo, username, permission = 'push') {
  return request(`/repos/${owner}/${repo}/collaborators/${username}`, {
    method: 'PUT',
    body: { permission },
  });
}

export async function getOrgMembership(org, username) {
  try {
    return await request(`/orgs/${org}/memberships/${username}`);
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 404) return null;
    throw err;
  }
}

export function setOrgMembership(org, username, role = 'member') {
  return request(`/orgs/${org}/memberships/${username}`, {
    method: 'PUT',
    body: { role },
  });
}

export function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

export function decodeBase64Utf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
