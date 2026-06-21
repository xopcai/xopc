#!/usr/bin/env node

const GITHUB_REPO = 'xopcai/xopc';
const NPM_PACKAGE = '@xopcai/xopc';

const args = new Set(process.argv.slice(2));
const outputJson = args.has('--json');

async function fetchJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'user-agent': 'xopc-growth-snapshot',
      accept: 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return await res.json();
}

async function main() {
  const [github, npmDownloads, npmMeta] = await Promise.all([
    fetchJson(`https://api.github.com/repos/${GITHUB_REPO}`),
    fetchJson(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(NPM_PACKAGE)}`),
    fetchJson(`https://registry.npmjs.org/${encodeURIComponent(NPM_PACKAGE)}`),
  ]);

  const snapshot = {
    capturedAt: new Date().toISOString(),
    github: {
      repo: GITHUB_REPO,
      url: github.html_url,
      stars: github.stargazers_count,
      forks: github.forks_count,
      watchers: github.subscribers_count,
      openIssues: github.open_issues_count,
      defaultBranch: github.default_branch,
      pushedAt: github.pushed_at,
    },
    npm: {
      package: NPM_PACKAGE,
      latest: npmMeta?.['dist-tags']?.latest ?? null,
      lastWeekDownloads: npmDownloads.downloads,
      downloadsWindow: {
        start: npmDownloads.start,
        end: npmDownloads.end,
      },
      modifiedAt: npmMeta?.time?.modified ?? null,
    },
    target: {
      starsGoal: 100,
      starsRemaining: Math.max(0, 100 - Number(github.stargazers_count ?? 0)),
    },
  };

  if (outputJson) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log(`xopc growth snapshot (${snapshot.capturedAt})`);
  console.log('');
  console.log(`GitHub: ${snapshot.github.url}`);
  console.log(`  stars:       ${snapshot.github.stars} / ${snapshot.target.starsGoal} (${snapshot.target.starsRemaining} remaining)`);
  console.log(`  forks:       ${snapshot.github.forks}`);
  console.log(`  watchers:    ${snapshot.github.watchers}`);
  console.log(`  open issues: ${snapshot.github.openIssues}`);
  console.log(`  pushed at:   ${snapshot.github.pushedAt}`);
  console.log('');
  console.log(`npm: ${snapshot.npm.package}`);
  console.log(`  latest:      ${snapshot.npm.latest}`);
  console.log(`  downloads:   ${snapshot.npm.lastWeekDownloads} (${snapshot.npm.downloadsWindow.start}..${snapshot.npm.downloadsWindow.end})`);
  console.log(`  modified at: ${snapshot.npm.modifiedAt}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
