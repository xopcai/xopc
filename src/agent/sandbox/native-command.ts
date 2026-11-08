import { access, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter } from 'node:path';

export type NativeCommandSandbox = { access: 'read-only' | 'workspace-write'; network: boolean; workspace: string };

/** The selected OS boundary must be available; execution never falls back to an unrestricted host. */
export async function sandboxCommand(launch: { executable: string; args: string[]; shell: boolean }, sandbox: NativeCommandSandbox) {
  const workspace = await realpath(sandbox.workspace);
  const program = launch.shell ? '/bin/sh' : launch.executable;
  const args = launch.shell ? ['-c', launch.executable] : launch.args;
  if (process.platform === 'darwin') {
    await access('/usr/bin/sandbox-exec');
    const writePaths = sandbox.access === 'workspace-write' ? [workspace, await realpath(tmpdir())] : [];
    const profile = `(version 1) (allow default) (deny file-write*) ${writePaths.map(path => `(allow file-write* (subpath ${JSON.stringify(path)}))`).join(' ')} ${sandbox.network ? '' : '(deny network*)'}`;
    return { executable: '/usr/bin/sandbox-exec', args: ['-p', profile, program, ...args], shell: false };
  }
  if (process.platform === 'linux') {
    const candidates = (process.env.PATH ?? '/usr/bin:/bin').split(delimiter).map(path => `${path}/bwrap`);
    let bwrap: string | undefined;
    for (const path of candidates) { try { await access(path); bwrap = path; break; } catch {} }
    if (!bwrap) throw new Error('OS sandbox requires bubblewrap (bwrap) on Linux. Install it before selecting sandboxed execution.');
    return { executable: bwrap, shell: false, args: ['--die-with-parent', '--new-session', '--unshare-pid', '--unshare-uts', '--unshare-ipc',
      ...(sandbox.network ? [] : ['--unshare-net']), '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc',
      ...(sandbox.access === 'workspace-write' ? ['--bind', workspace, workspace, '--tmpfs', '/tmp'] : []), '--', program, ...args] };
  }
  throw new Error(`Native OS sandbox is unavailable on ${process.platform}. Choose an available execution environment explicitly.`);
}
