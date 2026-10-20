/** Freeze dirty working-tree sources without changing the user's checkout. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || existsSync(destination)) throw new Error('Pass a new snapshot directory');
const origin = process.cwd();
const files = [...new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean))];
mkdirSync(destination, { recursive: true });
const hashes = {};
for (const file of files) {
  if (!existsSync(file)) continue;
  if (!lstatSync(file).isFile()) throw new Error(`Snapshot only accepts regular source files: ${file}`);
  const target = resolve(destination, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(file, target);
  hashes[file] = createHash('sha256').update(readFileSync(target)).digest('hex');
}
writeFileSync(resolve(destination, '.xopc-source-origin.json'), JSON.stringify({
  origin, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
  sourceHash: createHash('sha256').update(JSON.stringify(hashes)).digest('hex'), copiedFiles: files.length,
}, null, 2));
execFileSync('git', ['init', '--quiet'], { cwd: destination });
execFileSync('git', ['add', '--all'], { cwd: destination });
execFileSync('git', ['-c', 'user.name=Eval snapshot', '-c', 'user.email=eval@localhost', 'commit', '--quiet', '-m', 'Freeze local evaluation sources'], { cwd: destination });
execFileSync('pnpm', ['install', '--offline', '--ignore-scripts', '--frozen-lockfile'], { cwd: destination, stdio: 'inherit' });
console.log(`Frozen source: ${destination}`);
