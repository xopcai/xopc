import { execFile } from 'node:child_process';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { readWorkspaceRevision } from '../coding/workspace-revision.js';

const exec = promisify(execFile);
export function createReviewWorkspaceTool(workspace: string): AgentTool {
  return {
    name: 'review_workspace', label: 'Review workspace', parameters: Type.Object({}),
    description: 'Inspect the complete Git workspace diff against HEAD, including untracked text files. Includes pre-existing changes. A truncated view is explicitly incomplete; inspect large files separately. Does not modify Git state.',
    supportsParallel: true, idempotent: true,
    async execute(_id, _args, signal) {
      let cwd = workspace;
      const git = async (args: string[]) => (await exec('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, signal, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
      cwd = await realpath((await git(['rev-parse', '--show-toplevel'])).trim());
      const startRevision = await readWorkspaceRevision(cwd);
      const head = await git(['rev-parse', '--verify', 'HEAD']).catch(() => '');
      const [diff, names] = await Promise.all([
        head ? git(['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'])
          : Promise.all([git(['diff', '--no-ext-diff', '--no-textconv', '--binary', '--cached', '--']), git(['diff', '--no-ext-diff', '--no-textconv', '--binary', '--'])]).then(parts => parts.join('\n')),
        git(['ls-files', '--others', '--exclude-standard', '-z']),
      ]);
      let text = diff.slice(0, 200_000), complete = diff.length <= 200_000;
      for (const path of names.split('\0').filter(Boolean)) {
        signal?.throwIfAborted();
        if (text.length >= 200_000) { complete = false; break; }
        const file = resolve(cwd, path), info = await lstat(file);
        text += `\nUntracked file: ${path}\n`;
        if (info.isSymbolicLink()) text += `Symlink to ${await readlink(file)}\n`;
        else if (info.isFile() && info.size <= 50_000) {
          const content = await readFile(file);
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
