import { spawn } from 'node:child_process';
import { lstat, mkdir, readlink, readdir, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve } from 'node:path';

import AdmZip from 'adm-zip';

import { RuntimeError } from './errors.js';
import type { RuntimeKind } from './types.js';

const MAX_ARCHIVE_ENTRIES = 50_000;
const MAX_TAR_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;

function validateMemberPath(memberPath: string): void {
  const portablePath = memberPath.replaceAll('\\', '/');
  const normalized = posix.normalize(portablePath);
  if (
    !memberPath
    || isAbsolute(memberPath)
    || portablePath.startsWith('/')
    || normalized === '..'
    || normalized.startsWith('../')
  ) {
    throw new Error(`Unsafe archive member: ${memberPath}`);
  }
}

async function validateExtractedTree(root: string, current = root): Promise<number> {
  let totalBytes = 0;
  for (const entry of await readdir(current)) {
    const entryPath = join(current, entry);
    const details = await lstat(entryPath);
    if (details.isSymbolicLink()) {
      const target = resolve(current, await readlink(entryPath));
      const relativeTarget = relative(root, target);
      if (relativeTarget.split(/[\\/]/)[0] === '..' || isAbsolute(relativeTarget)) {
        throw new Error(`Archive symlink escapes extraction root: ${entryPath}`);
      }
      continue;
    }
    totalBytes += details.isDirectory()
      ? await validateExtractedTree(root, entryPath)
      : details.size;
    if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error('Extracted archive exceeds size limit');
  }
  return totalBytes;
}

async function runTar(args: string[]): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('tar', args, { shell: false, windowsHide: true });
    const append = (current: string, chunk: Buffer) => {
      if (Buffer.byteLength(current) + chunk.byteLength > MAX_TAR_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        reject(new Error('tar output exceeds size limit'));
        return current;
      }
      return current + chunk.toString();
    };
    child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(stderr.trim() || `tar exited with code ${code}`));
    });
  });
}

async function extractZip(archivePath: string, destination: string): Promise<void> {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('Archive contains too many entries');
  const expandedBytes = entries.reduce((total, entry) => total + entry.header.size, 0);
  if (expandedBytes > MAX_EXTRACTED_BYTES) throw new Error('Extracted archive exceeds size limit');
  for (const entry of entries) validateMemberPath(entry.entryName);
  zip.extractAllTo(destination, true, false);
}

async function extractTarGz(archivePath: string, destination: string): Promise<void> {
  const listing = await runTar(['-tzf', archivePath]);
  const entries = listing.split(/\r?\n/).filter(Boolean);
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('Archive contains too many entries');
  for (const entry of entries) validateMemberPath(entry);
  await runTar(['-xzf', archivePath, '-C', destination]);
}

async function singleArchiveRoot(destination: string): Promise<string> {
  const entries = (await readdir(destination)).filter((entry) => entry !== '__MACOSX');
  if (entries.length !== 1) throw new Error('Archive must contain one top-level directory');
  const root = join(destination, entries[0]!);
  if (!(await stat(root)).isDirectory()) throw new Error('Archive root is not a directory');
  return root;
}

export async function extractRuntimeArchive(params: {
  runtime: RuntimeKind;
  archivePath: string;
  archiveType: 'zip' | 'tar.gz';
  stagingDir: string;
}): Promise<string> {
  await rm(params.stagingDir, { recursive: true, force: true });
  await mkdir(params.stagingDir, { recursive: true });
  try {
    if (params.archiveType === 'zip') await extractZip(params.archivePath, params.stagingDir);
    else await extractTarGz(params.archivePath, params.stagingDir);
    await validateExtractedTree(params.stagingDir);
    return await singleArchiveRoot(params.stagingDir);
  } catch (error) {
    await rm(params.stagingDir, { recursive: true, force: true });
    throw new RuntimeError(
      `Invalid ${params.runtime} archive: ${error instanceof Error ? error.message : String(error)}`,
      'RUNTIME_ARCHIVE_INVALID',
      params.runtime,
      'extract',
      true,
      [],
      { cause: error },
    );
  }
}

export async function atomicInstallRuntime(extractedRoot: string, installDir: string): Promise<void> {
  await mkdir(resolve(installDir, '..'), { recursive: true });
  await rm(installDir, { recursive: true, force: true });
  await rename(extractedRoot, installDir);
}
