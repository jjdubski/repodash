export async function fetchUserRepos(username, token) {
  const headers = { 'User-Agent': 'repodash', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = 'Bearer ' + token;

  let allRepos = [];
  let page = 1;
  while (true) {
    const url = `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    const repos = await res.json();
    allRepos.push(...repos);
    const link = res.headers.get('link');
    if (!link || !link.includes('rel="next"')) break;
    page++;
  }

  return allRepos
    .filter((r) => r.pushed_at)
    .map((r) => ({
      name: r.name,
      fullName: r.full_name,
      cloneUrl: r.clone_url,
      pushedAt: r.pushed_at,
      defaultBranch: r.default_branch
    }));
}
