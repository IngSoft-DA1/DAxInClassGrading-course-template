const PAGES_HOSTNAME = /^([^.]+)\.github\.io$/;

// Each course repo hosts its own copy of this app on its own GitHub Pages
// site (https://<org>.github.io/<repo>/), so the org/repo can be inferred
// from the page's own location instead of asking the instructor to pick a
// course. Falls back to ?org=&repo= query params (used by local dev, where
// the hostname won't match the Pages pattern) or null if neither resolves.
export function resolveCourseContext(loc = window.location) {
  const hostMatch = loc.hostname.match(PAGES_HOSTNAME);
  if (hostMatch) {
    const [, owner] = hostMatch;
    const [repo] = loc.pathname.split('/').filter(Boolean);
    if (repo) return { org: owner, repo };
  }

  const params = new URLSearchParams(loc.search);
  const org = params.get('org');
  const repo = params.get('repo');
  return org && repo ? { org, repo } : null;
}
