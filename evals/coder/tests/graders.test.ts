import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runGrader } from '@agent-evals/graders';
import { ArtifactStore, EvalStore } from '@agent-evals/storage';
import { afterEach, describe, expect, it } from 'vitest';

describe('unchanged grader', () => {
  it('grades final answers without requiring the agent to write an artifact', async () => {
    const context = { finalText: 'Owner: ALICE. Status: partial.', runId: 'r' } as any;
    expect((await runGrader({ type: 'answer_contains', all: ['alice', 'partial'], none: ['complete'] }, 0, context)).passed).toBe(true);
    expect((await runGrader({ type: 'answer_contains', all: ['bob'] }, 0, context)).passed).toBe(false);
    expect((await runGrader({ type: 'answer_contains', all: ['alice'], none: ['partial'] }, 0, context)).passed).toBe(false);
    expect((await runGrader({ type: 'answer_contains', all: ['alice'] }, 0, { ...context, finalText: undefined })).passed).toBe(false);
  });
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it('fails when a protected path is newly created and untracked', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-evals-grader-'));
    roots.push(root);
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'eval@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Eval Test'], { cwd: root });
    execFileSync('git', ['commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
    writeFileSync(join(root, 'protected-new.txt'), 'unexpected\n');
    const store = new EvalStore(join(root, 'evals.db'));

    const result = await runGrader(
      { type: 'unchanged', paths: ['protected-new.txt'] },
      0,
      {
        runId: 'run',
        workspace: root,
        artifactStore: new ArtifactStore(join(root, 'artifacts')),
        store,
      },
    );

    expect(result.passed).toBe(false);
    expect(result.summary).toContain('protected-new.txt');
    expect(result).toMatchObject({
      category: 'scope',
      required: true,
      weight: 1,
    });
    store.close();
  });

  it('injects hidden command files only for verification and removes them afterward', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-evals-hidden-grader-'));
    roots.push(root);
    const hiddenSource = join(root, 'hidden-source.mjs');
    writeFileSync(hiddenSource, 'process.exit(0);\n');
    const workspace = join(root, 'workspace');
    mkdirSync(workspace);
    execFileSync('git', ['init', '-q'], { cwd: workspace });

    const result = await runGrader(
      {
        type: 'command',
        command: 'node .xopc-eval-hidden/check.mjs',
        hiddenFiles: [{
          source: hiddenSource,
          target: '.xopc-eval-hidden/check.mjs',
        }],
      },
      0,
      {
        runId: 'run',
        workspace,
        artifactStore: new ArtifactStore(join(root, 'artifacts')),
        store: { recordArtifact() {} } as unknown as EvalStore,
      },
    );

    expect(result.passed).toBe(true);
    expect(existsSync(join(workspace, '.xopc-eval-hidden', 'check.mjs'))).toBe(false);
  });
  it('exports evaluator-owned hydrated traces only inside the hidden directory and cleans up on rejection', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-evals-trace-grader-'));
    roots.push(root);
    const workspace = join(root, 'workspace'); mkdirSync(workspace);
    const payloadPath = join(root, 'payload.json');
    writeFileSync(payloadPath, JSON.stringify({payload:{result:{details:{verification:{status:'passed'}}}}}));
    const checkPath = join(root, 'check.mjs');
    writeFileSync(checkPath, `import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';const trace=JSON.parse(readFileSync('.xopc-eval-hidden/trace.json'));assert.equal(trace.events[0].payload.payload.result.details.verification.status,'passed');`);
    const context = {runId:'r',workspace,artifactStore:new ArtifactStore(join(root,'artifacts')),
      store:{recordArtifact(){},getRun(){return {events:[{type:'tool.finished',payload_json:'{"truncated":true}',artifact_refs_json:'["payload"]'}],artifacts:[{id:'payload',kind:'trace-payload-tool.finished',path:payloadPath}]};}} as unknown as EvalStore};
    const spec = {type:'command' as const,command:'node .xopc-eval-hidden/check.mjs',traceFile:'.xopc-eval-hidden/trace.json',hiddenFiles:[{source:checkPath,target:'.xopc-eval-hidden/check.mjs'}]};
    expect((await runGrader(spec,0,context)).passed).toBe(true);
    expect(existsSync(join(workspace,'.xopc-eval-hidden'))).toBe(false);
    await expect(runGrader({...spec,traceFile:'leaked.json'},0,context)).rejects.toThrow('Trace snapshot must stay inside');
    expect(existsSync(join(workspace,'leaked.json'))).toBe(false);
    expect(existsSync(join(workspace,'.xopc-eval-hidden'))).toBe(false);
  });

});
