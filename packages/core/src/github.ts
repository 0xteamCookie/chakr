// Real GitHub for the live demo, over the REST API with a personal access token.
// Reads are real: open issues of one public repo, the repos the token can see, and file contents. Opening a
// pull request is simulated unless GITHUB_ALLOW_WRITE=1, because with the Shield off the injected issue makes the
// agent publish private code in a public PR. Only enable writes on throwaway demo repos.
//
// GITHUB_TOKEN          fine-grained token: Contents read (write too if GITHUB_ALLOW_WRITE), Issues read, Metadata read,
//                       Pull requests write (only with GITHUB_ALLOW_WRITE)
// GITHUB_REPO           the public repo whose issues the agent works on, as owner/name
// GITHUB_ALLOW_WRITE    1 to really create the branch, commit and pull request (default: simulated)

import type { LiveEmail } from "./live.js";

const API = "https://api.github.com";
const MAX_BODY = 4000;

export const githubConfigured = () => !!(process.env.GITHUB_TOKEN && process.env.GITHUB_REPO);
export const githubRepo = () => process.env.GITHUB_REPO ?? null;
export const githubWrites = () => process.env.GITHUB_ALLOW_WRITE === "1";

/** Visibility of every repo seen so far: tool specs read it synchronously to label file contents. */
export const repoPrivacy = new Map<string, boolean>();

// New accounts can get as little as 60 requests an hour, so reads are cached: after the first load, repeat runs
// (shield off, then on) cost nothing. GITHUB_CACHE_SECONDS=0 turns it off.
const cache = new Map<string, { at: number; value: unknown }>();
const ttl = () => Number(process.env.GITHUB_CACHE_SECONDS ?? 600) * 1000;

async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
  const read = !init.method || init.method === "GET";
  const hit = read ? cache.get(path) : undefined;
  if (hit && Date.now() - hit.at < ttl()) {
    if (hit.value instanceof Error) throw hit.value;
    return hit.value as T;
  }
  try {
    const value = await ghFetch<T>(path, init);
    if (read) cache.set(path, { at: Date.now(), value });
    return value;
  } catch (e) {
    // remember "not found" too (issue probing, missing files), but never a rate-limit or network error
    if (read && /GitHub 404/.test((e as Error).message)) cache.set(path, { at: Date.now(), value: e });
    throw e;
  }
}

/** Drop cached reads, e.g. after editing issues or files on GitHub. */
export const clearGithubCache = () => cache.clear();

async function ghFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "User-Agent": "agentshield-live-demo",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const at = new Date(Number(res.headers.get("x-ratelimit-reset")) * 1000).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    throw new Error(`GitHub rate limit reached (${res.headers.get("x-ratelimit-limit")}/hour for this account), resets at ${at}`);
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} on ${path.split("?")[0]}: ${(await res.text()).slice(0, 160)}`);
  return res.json() as Promise<T>;
}

const repoPath = (repo: string) => {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error(`not a repo: ${repo}`);
  return `/repos/${repo}`;
};

/** Open issues (not pull requests) of GITHUB_REPO, oldest first, shaped like inbox items. */
export async function fetchGithubIssues(): Promise<LiveEmail[]> {
  if (!githubConfigured()) throw new Error("GitHub is not configured: set GITHUB_TOKEN and GITHUB_REPO in the root .env");
  const repo = githubRepo()!;
  // issues are always fetched fresh, so edits on GitHub show up; file reads stay cached
  for (const k of cache.keys()) if (k.includes("/issues")) cache.delete(k);
  const meta = await gh<{ private: boolean; full_name: string }>(repoPath(repo));
  repoPrivacy.set(meta.full_name, meta.private);
  type Issue = { number: number; title: string; body: string | null; state: string; user: { login: string }; pull_request?: unknown };
  let issues = await gh<Issue[]>(`${repoPath(repo)}/issues?state=open&per_page=12&sort=created&direction=asc`);
  if (!issues.length) {
    // Brand-new accounts are often hidden from listings by GitHub's spam filter, while single issues still load.
    // Probe by number until three misses in a row.
    issues = [];
    for (let n = 1, miss = 0; n <= 30 && miss < 3; n++) {
      try { const i = await gh<Issue>(`${repoPath(repo)}/issues/${n}`); miss = 0; if (i.state === "open") issues.push(i); }
      catch { miss++; }
    }
  }
  return issues.filter((i) => !i.pull_request).slice(0, 12).map((i) => ({
    from: `@${i.user.login}`, subject: `#${i.number} ${i.title}`.slice(0, 300),
    body: (i.body ?? "").slice(0, MAX_BODY) || "(no description)", kind: "issue" as const, github: true, repo: meta.full_name,
  }));
}

export async function listRepos(): Promise<{ repo: string; private: boolean }[]> {
  const rs = await gh<{ full_name: string; private: boolean }[]>("/user/repos?per_page=50&sort=updated&affiliation=owner,collaborator,organization_member");
  rs.forEach((r) => repoPrivacy.set(r.full_name, r.private));
  return rs.map((r) => ({ repo: r.full_name, private: r.private }));
}

export async function readFile(repo: string, path: string): Promise<{ content: string; private: boolean } | { error: string }> {
  try {
    if (!repoPrivacy.has(repo)) repoPrivacy.set(repo, (await gh<{ private: boolean }>(repoPath(repo))).private);
    const f = await gh<{ content?: string; encoding?: string }>(`${repoPath(repo)}/contents/${encodeURI(path.replace(/^\/+/, ""))}`);
    if (!f.content) return { error: "not a file" };
    return { content: Buffer.from(f.content, "base64").toString("utf8").slice(0, MAX_BODY), private: repoPrivacy.get(repo)! };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Branch + commit + pull request. Only called when GITHUB_ALLOW_WRITE=1. */
export async function openPullRequest(repo: string, pr: { title: string; body: string; path: string; content: string }): Promise<string> {
  const r = await gh<{ default_branch: string }>(repoPath(repo));
  const base = await gh<{ object: { sha: string } }>(`${repoPath(repo)}/git/ref/heads/${r.default_branch}`);
  const branch = `agent/${Date.now().toString(36)}`;
  await gh(`${repoPath(repo)}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: base.object.sha }) });
  const path = pr.path.replace(/^\/+/, "");
  let sha: string | undefined;
  try { sha = (await gh<{ sha: string }>(`${repoPath(repo)}/contents/${encodeURI(path)}?ref=${branch}`)).sha; } catch { /* new file */ }
  await gh(`${repoPath(repo)}/contents/${encodeURI(path)}`, { method: "PUT", body: JSON.stringify({
    message: pr.title, branch, sha, content: Buffer.from(pr.content).toString("base64") }) });
  const out = await gh<{ html_url: string }>(`${repoPath(repo)}/pulls`, { method: "POST", body: JSON.stringify({
    title: pr.title, body: pr.body, head: branch, base: r.default_branch }) });
  return out.html_url;
}
