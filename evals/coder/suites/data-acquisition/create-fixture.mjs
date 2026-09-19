import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'xopc-data-eval-'));
await mkdir(join(root, 'notes'));
await mkdir(join(root, 'src'));
for (const [name, text] of Object.entries({
  'notes/alpha.md': 'Owner: Alice\nDecision: delay launch until accessibility review.\n',
  'notes/beta.md': 'Owner: Bob\nDecision: finish the migration on Friday.\n',
  'notes/gamma.md': 'Owner: Carol\nDecision: reduce the report to three pages.\n',
  'src/registry.ts': 'export const registry = { active: true };\n',
  'src/experimental.ts': 'export function experimental() { return "ready"; }\n',
})) await writeFile(join(root, name), text);
execFileSync('git', ['init', '-q'], { cwd: root });
execFileSync('git', ['add', '.'], { cwd: root });
execFileSync('git', ['-c', 'user.name=Eval', '-c', 'user.email=eval@example.invalid', 'commit', '-qm', 'fixture'], { cwd: root });
console.log(root);
