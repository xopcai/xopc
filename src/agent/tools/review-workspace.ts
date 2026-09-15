import { execFile } from 'node:child_process';
import { lstat, readlink, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { checkedFilePath, readWorkspaceFile } from '../sandbox/fileAccess.js';
import { evaluateFilePolicy } from '../sandbox/exec-policy.js';
import { prepareSafeToolEnv } from '../sandbox/sanitize-env-vars.js';
import { readWorkspaceRevision } from '../coding/workspace-revision.js';

const exec = promisify(execFile);
export function createReviewWorkspaceTool(workspace: string): AgentTool {
  return {
    name: 'review_workspace', label: 'Review workspace', parameters: Type.Object({}),
    description: 'Inspect the complete Git workspace diff against HEAD, including untracked text files. Includes pre-existing changes. A truncated view is explicitly incomplete; inspect large files separately. Does not modify Git state.',
    supportsParallel: true, idempotent: true,
    async execute(_id, _args, signal) {
      let cwd = checkedFilePath(workspace, workspace, 'read');
      const git = async (args: string[]) => (await exec('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, env: prepareSafeToolEnv(process.env), signal, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
      cwd = checkedFilePath(workspace, await realpath((await git(['rev-parse', '--show-toplevel'])).trim()), 'read');
      const startRevision = await readWorkspaceRevision(cwd);
      const head = await git(['rev-parse', '--verify', 'HEAD']).catch(() => '');
      const changedNames = head
        ? await git(['diff', '--no-renames', '--name-only', '-z', 'HEAD', '--'])
        : (await Promise.all([git(['diff', '--name-only', '-z', '--cached', '--']), git(['diff', '--name-only', '-z', '--'])])).join('');
      const safePaths: string[] = [];
      let complete = true;
      for (const path of new Set(changedNames.split('\0').filter(Boolean))) {
        const file = resolve(cwd, path);
        if (!evaluateFilePolicy({ workspaceRoot: workspace, path: file, operation: 'read' }).allowed) { complete = false; continue; }
        const info = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (info && (!info.isFile() || info.nlink !== 1)) { complete = false; continue; }
        safePaths.push(`:(literal)${path}`);
      }
      if (safePaths.length > 1000) throw new Error('Too many changed files for a bounded workspace review');
      const [diff, names] = await Promise.all([
        safePaths.length === 0 ? Promise.resolve('') : head
          ? git(['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--', ...safePaths])
          : Promise.all([git(['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--binary', '--cached', '--', ...safePaths]),
            git(['diff', '--no-renames', '--no-ext-diff', '--no-textconv', '--binary', '--', ...safePaths])]).then(parts => parts.join('\n')),
        git(['ls-files', '--others', '--exclude-standard', '-z']),
      ]);
      let text = diff.slice(0, 200_000);
      complete &&= diff.length <= 200_000;
      for (const path of names.split('\0').filter(Boolean)) {
        signal?.throwIfAborted();
        if (text.length >= 200_000) { complete = false; break; }
        const file = resolve(cwd, path);
        if (!evaluateFilePolicy({ workspaceRoot: workspace, path: file, operation: 'read' }).allowed) { complete = false; continue; }
        const info = await lstat(file);
        if (info.isFile() && info.nlink !== 1) { complete = false; continue; }
        text += `\nUntracked file: ${path}\n`;
        if (info.isSymbolicLink()) text += `Symlink to ${await readlink(file)}\n`;
        else if (info.isFile() && info.size <= 50_000) {
          const content = readWorkspaceFile(workspace, file, 50_000);
          if (content.includes(0)) { text += '(binary file; inspect separately)\n'; complete = false; }
          else text += content.toString('utf8');
        } else { text += '(large file; inspect separately)\n'; complete = false; }
      }
      complete &&= text.length <= 200_000;
      const endRevision = await readWorkspaceRevision(cwd);
      return { content: [{ type: 'text', text: `Workspace changes against HEAD (including pre-existing changes):\n${text.slice(0, 200_000) || '(clean)'}${complete ? '' : '\n[Incomplete view]'}` }],
        details: { status: 'success', command: 'review_workspace', complete, exitCode: 0, startRevision, endRevision } };
    },
  } as AgentTool;
}
