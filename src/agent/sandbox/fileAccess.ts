import { closeSync, constants, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { evaluateFilePolicy } from './exec-policy.js';

/** Revalidate at I/O time; never truncate a file before checking the opened inode. */
export function checkedFilePath(workspaceRoot: string, path: string, operation: 'read' | 'write' | 'delete'): string {
  const policy = evaluateFilePolicy({ workspaceRoot, path, operation });
  if (!policy.allowed || !policy.canonicalPath) throw new Error(`Sandbox: ${policy.reason ?? 'Cannot resolve file'}`);
  return policy.canonicalPath;
}

function mkdirChecked(workspace: string, directory: string): void {
  const path = checkedFilePath(workspace, directory, 'write');
  try {
    if (!lstatSync(path).isDirectory()) throw new Error('Expected a directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    mkdirChecked(workspace, dirname(path));
    if (checkedFilePath(workspace, path, 'write') !== path) throw new Error('Directory changed during operation');
    mkdirSync(path);
  }
}

function openChecked(workspace: string, inputPath: string, write: boolean): number {
  const operation = write ? 'write' : 'read';
  const path = checkedFilePath(workspace, inputPath, operation);
  if (write) mkdirChecked(workspace, dirname(path));
  if (checkedFilePath(workspace, path, operation) !== path) throw new Error('Path changed during operation');
  const flags = (write ? constants.O_WRONLY : constants.O_RDONLY) | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  let fd: number;
  try { fd = openSync(path, flags); }
  catch (error) {
    if (!write || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    fd = openSync(path, flags | constants.O_CREAT | constants.O_EXCL, 0o600);
  }
  try {
    const opened = fstatSync(fd);
    const currentPath = checkedFilePath(workspace, inputPath, operation);
    const current = statSync(currentPath);
    if (currentPath !== path || current.dev !== opened.dev || current.ino !== opened.ino) throw new Error('File changed during operation');
    if (!opened.isFile() || opened.nlink !== 1) throw new Error('Sandbox requires a regular file without hard links');
    return fd;
  } catch (error) { closeSync(fd); throw error; }
}

export function readWorkspaceFile(workspace: string, path: string, maxBytes = 10 * 1024 * 1024): Buffer {
  const fd = openChecked(workspace, path, false);
  try {
    if (fstatSync(fd).size > maxBytes) throw new Error(`File too large: maximum ${maxBytes} bytes`);
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - total + 1));
      const count = readSync(fd, chunk);
      if (count === 0) break;
      total += count;
      if (total > maxBytes) throw new Error(`File too large: maximum ${maxBytes} bytes`);
      chunks.push(chunk.subarray(0, count));
    }
    return Buffer.concat(chunks);
  } finally { closeSync(fd); }
}

export function writeWorkspaceFile(workspace: string, path: string, content: string | Buffer): void {
  const fd = openChecked(workspace, path, true);
  try { ftruncateSync(fd, 0); writeFileSync(fd, content, 'utf8'); }
  finally { closeSync(fd); }
}

export function deleteWorkspaceFile(workspace: string, path: string): void {
  const target = checkedFilePath(workspace, path, 'delete');
  if (!lstatSync(target).isFile()) throw new Error('Expected a regular file');
  if (checkedFilePath(workspace, resolve(target), 'delete') !== target) throw new Error('File changed during operation');
  unlinkSync(target);
}

/** Refuse publication of directory trees containing protected or escaping entries. */
export function assertWorkspaceTreeReadable(workspace: string, path: string): void {
  const seen = new Set<string>();
  let count = 0;
  const visit = (input: string) => {
    if (++count > 200_000) throw new Error('Share exceeds safe traversal limit');
    const target = checkedFilePath(workspace, input, 'read');
    if (seen.has(target)) return;
    seen.add(target);
    const stat = lstatSync(target);
    if (stat.isDirectory()) {
      for (const name of readdirSync(target)) visit(join(target, name));
    } else {
      const fd = openChecked(workspace, target, false);
      closeSync(fd);
    }
  };
  visit(path);
}
