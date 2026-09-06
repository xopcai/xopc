import { execFile } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Reload scoped instructions on content changes; never follow instruction links outside the repository. */
export class RepositoryInstructions {
  private readonly seen = new Map<string, string>();
  private readonly pending = new Map<string, string>();

  acknowledge(): void {
    for (const [path, content] of this.pending) this.seen.set(path, content);
    this.pending.clear();
  }
  private constructor(private readonly root: string, private readonly workspace: string) {}

  static async open(workspace: string): Promise<RepositoryInstructions> {
    let root = resolve(workspace);
    try { root = await realpath(root); } catch { /* Missing workspace is handled by the tool. */ }
    const canonicalWorkspace = root;
    try {
      const result = await exec('git', ['rev-parse', '--show-toplevel'], { cwd: root, timeout: 5_000 });
      root = await realpath(result.stdout.trim());
    } catch { /* Non-Git workspaces still support scoped instructions. */ }
    return new RepositoryInstructions(root, canonicalWorkspace);
  }

  async forTool(name: string, input: unknown): Promise<string> {
    const args = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    if (name === 'apply_patch') {
      const paths = [...String(args.patch ?? '').matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map(match => match[1]!.trim());
      return (await Promise.all(paths.map(path => this.load(path, false)))).filter(Boolean).join('\n\n');
    }
    if (['read_file', 'write_file'].includes(name) && typeof args.path === 'string') return this.load(args.path, false);
    if (name === 'exec_command' || name === 'managed_job' && args.action === 'start') return this.load(typeof args.cwd === 'string' ? args.cwd : '.', true);
    return '';
  }

  async load(path: string, directory: boolean): Promise<string> {
    const target = resolve(this.workspace, path);
    if (!inside(this.root, target)) return '';
    const leaf = directory ? target : dirname(target);
    const directories: string[] = [];
    for (let current = leaf; inside(this.root, current); current = dirname(current)) {
      directories.unshift(current);
      if (current === this.root) break;
    }
    const sections: string[] = [];
    for (const dir of directories) {
      const file = resolve(dir, 'AGENTS.md');
      try {
        const canonical = await realpath(file);
        if (!inside(this.root, canonical)) throw new Error(`Instruction file escapes repository: ${file}`);
        if ((await stat(canonical)).size > 32_768) throw new Error(`Instruction file is too large; read it explicitly: ${file}`);
        const content = await readFile(canonical, 'utf8');
        if (this.seen.get(file) === content) continue;
        this.pending.set(file, content);
        if (content.trim()) sections.push(`Instructions for ${dir} and its descendants (${file}):\n${content}`);
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException).code))) continue;
        throw error;
      }
    }
    return sections.length ? `Repository instructions (more specific directory rules take precedence within their scope):\n\n${sections.join('\n\n')}` : '';
  }
}
