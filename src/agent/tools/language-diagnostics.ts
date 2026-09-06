import { relative, resolve, sep } from 'node:path';
import { access } from 'node:fs/promises';

import { Type } from '@sinclair/typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import { createExecCommandTool, type CreateExecCommandToolOptions } from './exec-command.js';

export interface LanguageDiagnostic { file: string; line: number; column: number; code: string; message: string }
export function parseTypeScriptDiagnostics(output: string): LanguageDiagnostic[] {
  return [...output.matchAll(/^(.+)\((\d+),(\d+)\): error (TS\d+): (.+)$/gm)].slice(0, 200).map(match => ({
    file: match[1]!, line: Number(match[2]), column: Number(match[3]), code: match[4]!, message: match[5]!,
  }));
}
function quote(value: string): string {
  if (process.platform === 'win32') {
    if (/[%!"\r\n]/.test(value)) throw new Error('Unsupported character in diagnostic path');
    return `"${value}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createLanguageDiagnosticsTool(workspace: string, options?: CreateExecCommandToolOptions): AgentTool {
  const exec = createExecCommandTool(workspace, options);
  return {
    name: 'language_diagnostics', label: 'TypeScript diagnostics',
    description: 'Run the repository-installed TypeScript compiler without emitting code. Returns compiler exit status, bounded file/line diagnostics, and a durable command log. Supports tsconfig projects; other languages use their normal check command.',
    parameters: Type.Object({ project: Type.Optional(Type.String({ description: 'tsconfig path relative to the workspace; defaults to tsconfig.json' })) }),
    supportsParallel: false, idempotent: false,
    async execute(id, input: { project?: string }, signal, onUpdate) {
      const project = resolve(workspace, input.project ?? 'tsconfig.json');
      const projectRelative = relative(workspace, project);
      if (projectRelative === '..' || projectRelative.startsWith(`..${sep}`)) throw new Error('Project must be inside the workspace');
      await access(project);
      let compiler: string;
      try { compiler = resolve(workspace, 'node_modules/typescript/lib/tsc.js'); await access(compiler); }
      catch { throw new Error('This workspace has no installed TypeScript compiler. Install its declared dependencies first.'); }
      const isolated = options?.getCommandIsolation?.()?.mode === 'docker';
      const compilerPath = isolated ? relative(workspace, compiler).split(sep).join('/') : compiler;
      if (isolated && compilerPath.startsWith('../')) throw new Error('Container diagnostics require TypeScript installed inside the workspace.');
      const result = await exec.execute(id, {
        cmd: `${quote(isolated ? 'node' : process.execPath)} ${quote(compilerPath)} --project ${quote(projectRelative)} --noEmit --pretty false`,
        timeoutMs: 120_000,
      }, signal, onUpdate);
      return { ...result, details: { ...result.details, diagnosticEngine: 'typescript',
        diagnostics: parseTypeScriptDiagnostics(String(result.details.aggregatedOutput ?? '')) } };
    },
  } as AgentTool;
}
