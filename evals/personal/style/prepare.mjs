import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.xopc-evals/style-upstream');
const pins = JSON.parse(readFileSync(new URL('./upstreams.json', import.meta.url), 'utf8'));
mkdirSync(root, { recursive: true });
for (const [name, pin] of Object.entries(pins)) {
  const path = resolve(root, name);
  if (!existsSync(path)) {
    execFileSync('git', ['clone', '--no-checkout', pin.url, path], { stdio: 'inherit' });
    execFileSync('git', ['-C', path, 'checkout', '--detach', pin.commit], { stdio: 'inherit' });
  }
  const commit = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (commit !== pin.commit) throw new Error(`${name}: expected ${pin.commit}, found ${commit}`);
  if (execFileSync('git', ['-C', path, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) {
    throw new Error(`${name}: tracked source differs from pinned revision`);
  }
  console.log(`${name}: ${commit} (${pin.license})`);
}
execFileSync('uv', ['sync', '--frozen', '--project', resolve(root, 'eqbench4')], { stdio: 'inherit' });
