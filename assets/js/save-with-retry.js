import { getContents, putContents, GitHubApiError } from './github-api.js';

// Applies `mutate(rows)` to the caller's current `rows`/`sha`, PUTs the
// result, and on a 409 (stale sha — e.g. a concurrent write from another
// instructor's tab) refetches the file once and reapplies the *same*
// `mutate` on top of the fresh data before retrying. Safe because every
// mutation used here is a single student/category upsert or clear, which is
// always valid to reapply on newer data.
export async function saveWithRetry({ org, repo, path, parse, serialize, rows, sha, message, mutate }) {
  const attempt = async (currentRows, currentSha) => {
    const nextRows = mutate(currentRows);
    const result = await putContents(org, repo, path, serialize(nextRows), message, currentSha);
    return { rows: nextRows, sha: result.content.sha };
  };

  try {
    return await attempt(rows, sha);
  } catch (err) {
    if (!(err instanceof GitHubApiError) || err.status !== 409) throw err;
    const fresh = await getContents(org, repo, path);
    const freshRows = fresh ? parse(fresh.content) : [];
    return attempt(freshRows, fresh ? fresh.sha : undefined);
  }
}
