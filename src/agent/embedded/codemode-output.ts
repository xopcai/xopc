import { constants } from 'node:fs';
import { mkdir, open, realpath, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';

/** Adopt only pi's own spill file, never a path printed by a script or an MCP server. */
export async function retainCodemodeOutput(workspace: string, source: unknown): Promise<string | undefined> {
  if (typeof source !== 'string' || dirname(source) !== tmpdir() || !/^pi-codemode-[a-f0-9]{16}\.txt$/.test(basename(source))) return;
  const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('Codemode output file exceeds 64 MiB');
    const root = await realpath(workspace);
    const directory = join(root, '.xopc', 'codemode-output');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const resolved = await realpath(directory);
    const location = relative(root, resolved);
    if (location === '..' || location.startsWith(`..${sep}`) || location.startsWith(sep)) throw new Error('Codemode output directory escapes workspace');
    const name = `${randomUUID()}.txt`;
    await writeFile(join(resolved, name), await handle.readFile(), { flag: 'wx', mode: 0o600 });
    return `.xopc/codemode-output/${name}`;
  } finally { await handle.close(); }
}
