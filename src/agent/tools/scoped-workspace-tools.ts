import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from '@sinclair/typebox';

import { checkedFilePath, readWorkspaceFile, writeWorkspaceFile } from '../sandbox/fileAccess.js';

/** Bounded file capability shared by background task executors; no command authority. */
export function createScopedWorkspaceTools(input: { workspace: string; writable: boolean; signal: AbortSignal; guard: () => void }): AgentTool[] {
    const readVersions = new Map<string, string>();
    const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
    const guard = () => {
      input.signal.throwIfAborted(); input.guard();

    };
    const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], details: {} });
    const path = (value: string, operation: 'read' | 'write') => {
      if (value.split(/[\\/]/).some(segment => segment === '.git' || segment === '.xopc')) throw new Error('Protected project metadata');
      const checked = checkedFilePath(input.workspace, resolve(input.workspace, value), operation);
      if (checked.split(/[\\/]/).some(segment => segment === '.git')) throw new Error('Protected project metadata');
      return checked;
    };
    const tools: AgentTool[] = [{
      name: 'read_file', label: 'Read workspace file', description: 'Read a UTF-8 file inside the authorized workspace (maximum 256 KB).',
      parameters: Type.Object({ path: Type.String() }),
      async execute(_id, args: { path: string }) {
        guard(); const file = path(args.path, 'read'); const content = readWorkspaceFile(input.workspace, file, 262144);
        readVersions.set(file, hash(content)); return result(content.toString('utf8'));
      },
    }, {
      name: 'list_directory', label: 'List workspace directory', description: 'List one workspace directory, maximum 500 entries.',
      parameters: Type.Object({ path: Type.String() }),
      async execute(_id, args: { path: string }) { guard(); return result(readdirSync(path(args.path, 'read'), { withFileTypes: true })
        .filter(entry => !['.git', '.xopc', '.env'].includes(entry.name)).slice(0, 500).map(entry => ({ name: entry.name, directory: entry.isDirectory() }))); },
    }];
    if (input.writable) tools.push({
      name: 'write_file', label: 'Write workspace file', description: 'Write a UTF-8 file only inside the authorized workspace. Read existing content before editing. Maximum 256 KB.',
      parameters: Type.Object({ path: Type.String(), content: Type.String({ maxLength: 262144 }) }),
      async execute(_id, args: { path: string; content: string }) {
        guard(); if (Buffer.byteLength(args.content) > 262144) throw new Error('File write budget exceeded');
        const file = path(args.path, 'write');
        if (existsSync(file)) {
          if (!readVersions.has(file)) throw new Error('Read the existing file before editing');
          if (readVersions.get(file) !== hash(readWorkspaceFile(input.workspace, file, 262144))) throw new Error('File changed since read; inspect the new content before editing');
        } else if (readVersions.has(file)) throw new Error('File was removed after read; do not recreate without review');
        writeWorkspaceFile(input.workspace, file, args.content); readVersions.set(file, hash(args.content)); return result('Saved');
      },
    });
    return tools;
}
