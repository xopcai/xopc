import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { ImportError, type ImportFile } from './types.js';

export const IMPORT_LIMITS = { file: 15 * 1024 * 1024, total: 100 * 1024 * 1024, count: 5000, depth: 16 };
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function fileHash(files: ImportFile[]): string {
  return digest([...files].sort((a, b) => a.path.localeCompare(b.path, 'en')));
}
export function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\'));
}
export function safePath(path: string): boolean {
  return !!path && !path.includes('\\') && !path.includes('\0') && !path.startsWith('/')
    && path.split('/').every(p => !!p && p !== '.' && p !== '..' && !/[<>:"|?*]/.test(p) && !/[. ]$/.test(p)
      && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
export function readRegularFile(path: string, limit = IMPORT_LIMITS.file): Buffer {
  if (!lstatSync(path).isFile()) throw new ImportError('unsafe_file', 'Only regular files are supported');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > limit) throw new ImportError('limit_exceeded', 'File exceeds import limit', 413);
    const data = readFileSync(fd);
    const after = fstatSync(fd);
    if (data.length > limit || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new ImportError('source_changed', 'Source changed while reading', 409);
    }
    return data;
  } finally { closeSync(fd); }
}
export function readTree(rootPath: string): ImportFile[] {
  const root = realpathSync(rootPath);
  const files: ImportFile[] = [];
  let total = 0;
  const names = new Set<string>();
  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > IMPORT_LIMITS.depth) throw new ImportError('limit_exceeded', 'Directory is too deep', 413);
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (['.git', '.DS_Store', '__MACOSX'].includes(entry.name)) continue;
      const rel = prefix + entry.name;
      if (!safePath(rel)) throw new ImportError('unsafe_file', 'Unsupported file name');
      const key = rel.normalize('NFC').toLowerCase();
      if (names.has(key)) throw new ImportError('conflict', 'File names collide on the target filesystem', 409);
      names.add(key);
      if (names.size > IMPORT_LIMITS.count) throw new ImportError('limit_exceeded', 'Too many files', 413);
      const path = join(dir, entry.name);
      // Links are rejected rather than expanding an untrusted tree outside its selected root.
      if (entry.isSymbolicLink() || !inside(root, realpathSync(path))) throw new ImportError('unsafe_file', 'Symbolic links must be replaced with local files before importing');
      if (entry.isDirectory()) walk(path, rel + '/', depth + 1);
      else {
        const data = readRegularFile(path);
        total += data.length;
        if (total > IMPORT_LIMITS.total) throw new ImportError('limit_exceeded', 'Import is too large', 413);
        files.push({ path: rel, data: data.toString('base64'), executable: (lstatSync(path).mode & 0o111) !== 0 });
      }
    }
  }
  walk(root, '', 0);
  return files;
}
