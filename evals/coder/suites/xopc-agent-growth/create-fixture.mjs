import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createFixture(parent = tmpdir()) {
  mkdirSync(parent, { recursive: true });
  const repo = mkdtempSync(join(parent, 'xopc-agent-growth-'));
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: {
    ...process.env, GIT_AUTHOR_DATE: '2026-10-17T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-17T00:00:00Z',
  } }).trim();
  git(['init', '-q', '-b', 'fixture']);
  const caseCommits = {};
  for (const id of ['I01', 'I02', 'E01', 'E02', 'P01', 'P02']) {
    for (const entry of readdirSync(repo)) if (entry !== '.git') rmSync(join(repo, entry), { recursive: true, force: true });
    cpSync(fileURLToPath(new URL(`./fixture/${id}/`, import.meta.url)), repo, { recursive: true });
    git(['add', '-A']);
    git(['-c', 'user.name=Xopc Benchmark', '-c', 'user.email=eval@xopc.ai', 'commit', '-qm', `Agent growth fixture ${id}`]);
    caseCommits[id] = git(['rev-parse', 'HEAD']);
  }
  return { repo, commit: caseCommits.P02, caseCommits };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(createFixture(process.argv[2]), null, 2));
}
