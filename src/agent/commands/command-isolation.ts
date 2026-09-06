import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
export type CommandIsolation = { mode: 'host' } | { mode: 'docker'; image: string; network?: boolean };

/** Docker is opt-in and never falls back to host execution or pulls an image implicitly. */
export async function isolatedCommand(input: {
  id: string; command: string; cwd: string; workspace: string; isolation?: CommandIsolation;
}): Promise<{ executable: string; args: string[]; shell: boolean; containerName?: string }> {
  if (!input.isolation || input.isolation.mode === 'host') return { executable: input.command, args: [], shell: true };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(input.isolation.image)) throw new Error('Docker command isolation requires an image pinned by sha256 digest.');
  const [workspace, cwd] = await Promise.all([realpath(input.workspace), realpath(input.cwd)]);
  const rel = relative(workspace, cwd);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Container cwd must be inside the workspace.');
  if (workspace.includes(',')) throw new Error('Container workspace paths cannot contain commas.');
  const containerName = `xopc-command-${input.id}`;
  return {
    executable: 'docker', shell: false, containerName,
    args: ['run', '--rm', '--pull=never', '--name', containerName, '--interactive', '--init',
      '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=256', '--memory=2g', '--cpus=2',
      '--network', input.isolation.network ? 'bridge' : 'none', '--user', `${process.getuid?.() || 65534}:${process.getgid?.() || 65534}`,
      '--mount', `type=bind,source=${workspace},target=/workspace`, '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m',
      '--env', 'HOME=/tmp', '--env', 'CI=true', '--workdir', `/workspace${rel ? `/${rel.split(sep).join('/')}` : ''}`,
      '--entrypoint', '/bin/sh', input.isolation.image, '-lc', input.command],
  };
}

export async function removeCommandContainer(name: string): Promise<void> {
  if (!/^xopc-command-[a-f0-9-]{36}$/.test(name)) throw new Error('Invalid command container name');
  await exec('docker', ['rm', '--force', name], { timeout: 10_000 }).catch(error => {
    if (!String(error.stderr).includes('No such container')) throw error;
  });
}
