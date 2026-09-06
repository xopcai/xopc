import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function createFixture(parent = tmpdir()) {
  mkdirSync(parent, { recursive: true });
  const repo = mkdtempSync(join(parent, 'xopc-coding-core-'));
  cpSync(fileURLToPath(new URL('./fixture/', import.meta.url)), repo, { recursive: true });
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=Coder Eval', '-c', 'user.email=eval@xopc.ai', 'commit', '-qm', 'Coding fixture v1']);
  return { repo, commit: git(['rev-parse', 'HEAD']) };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(createFixture(process.argv[2]), null, 2));
}
