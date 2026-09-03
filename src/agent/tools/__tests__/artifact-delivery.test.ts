import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseProductDeliveryEnvelope } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMediaReference } from '../../../media/media-reference.js';
import type { TranscriptStoredRow } from '../../../session/session-context-for-llm.js';
import { projectTurnOutcome } from '../../../session/turn-outcome-projector.js';
import { createExecCommandTool } from '../exec-command.js';
import { createPublishArtifactsTool, publishArtifactPaths } from '../publish-artifacts.js';
import { createWriteFileTool } from '../write.js';

function toolRow(details: unknown): TranscriptStoredRow {
  return { role: 'toolResult', turnId: 'turn-1', details, timestamp: 1 } as TranscriptStoredRow;
}

describe('file artifact delivery', () => {
  let fixture: string;
  let workspace: string;

  beforeEach(async () => {
    fixture = await mkdtemp(join(tmpdir(), 'xopc-artifact-delivery-'));
    workspace = join(fixture, 'workspace');
    await mkdir(workspace);
    vi.stubEnv('XOPC_STATE_DIR', join(fixture, 'state'));
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(fixture, { recursive: true, force: true });
  });

  it('shows one readable HTML artifact after writing and publishing it twice', async () => {
    const path = 'docs/进展总览.html';
    const content = '<!doctype html><title>进展总览</title>';
    const written = await createWriteFileTool(workspace).execute('write-1', { path, content });
    const publisher = createPublishArtifactsTool(workspace);
    const first = await publisher.execute('publish-1', { paths: [path] });
    const latest = await publisher.execute('publish-2', { paths: [`./${path}`] });
    const rows = [written, first, latest].map((result) => toolRow(result.details));
    const outcome = projectTurnOutcome({ turnId: 'turn-1', rows });

    expect(outcome.deliverables).toEqual(latest.details.artifacts);
    expect(outcome.deliverables).toHaveLength(1);
    const artifact = outcome.deliverables[0]!;
    const delivery = parseProductDeliveryEnvelope((written.details as { delivery: unknown }).delivery);
    expect(artifact.sourceFileId).toBe(delivery?.primary?.id);
    expect((await readMediaReference(artifact.uri!)).buffer.toString()).toBe(content);
  });

  it('matches command outputs from a subdirectory to the workspace file', async () => {
    const written = await createWriteFileTool(workspace).execute('write-1', {
      path: 'docs/report.html', content: '<title>Report</title>',
    });
    const executed = await createExecCommandTool(workspace).execute('exec-1', {
      cmd: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
      cwd: 'docs', outputs: ['report.html'], timeoutMs: 10_000,
    });
    expect(executed.details.status).toBe('success');
    const outcome = projectTurnOutcome({
      turnId: 'turn-1', rows: [toolRow(written.details), toolRow(executed.details)],
    });
    expect(outcome.deliverables).toHaveLength(1);
    expect(outcome.deliverables[0]?.location).toBe('artifact_store');
    expect(outcome.deliverables).toEqual(executed.details.artifacts);
  });

  it('keeps same-named files from different directories separate', async () => {
    const writer = createWriteFileTool(workspace);
    const a = await writer.execute('write-a', { path: 'a/report.html', content: 'a' });
    const b = await writer.execute('write-b', { path: 'b/report.html', content: 'b' });
    const published = await createPublishArtifactsTool(workspace).execute('publish', {
      paths: ['a/report.html', 'b/report.html'],
    });
    const outcome = projectTurnOutcome({
      turnId: 'turn-1', rows: [a, b, published].map((result) => toolRow(result.details)),
    });
    expect(outcome.deliverables).toEqual(published.details.artifacts);
    expect(new Set(outcome.deliverables.map((item) => item.sourceFileId)).size).toBe(2);
  });

  it.skipIf(process.platform === 'win32')('identifies an internal symlink and its target as the same source', async () => {
    const written = await createWriteFileTool(workspace).execute('write', { path: 'report.html', content: 'report' });
    await symlink(join(workspace, 'report.html'), join(workspace, 'alias.html'));
    const published = await createPublishArtifactsTool(workspace).execute('publish', { paths: ['alias.html'] });
    const outcome = projectTurnOutcome({ turnId: 'turn-1', rows: [toolRow(written.details), toolRow(published.details)] });
    expect(outcome.deliverables).toEqual(published.details.artifacts);
    expect(outcome.deliverables).toHaveLength(1);
  });

  it('deduplicates an external file without using its name or exposing its host path', async () => {
    const external = join(fixture, 'report.html');
    await writeFile(external, 'external');
    const first = await publishArtifactPaths({ paths: [external], baseDir: workspace, workspaceRoot: workspace, toolCallId: 'first' });
    const second = await publishArtifactPaths({ paths: [external], baseDir: workspace, workspaceRoot: workspace, toolCallId: 'second' });
    expect(first[0]?.availability).toBe('available');
    expect(first[0]?.sourceFileId).toBe(second[0]?.sourceFileId);
    expect(first[0]?.sourceFileId).not.toContain(fixture);
    expect(projectTurnOutcome({
      turnId: 'turn-1', rows: [toolRow({ artifacts: first }), toolRow({ artifacts: second })],
    }).deliverables).toEqual(second);
  });

  it('can still publish an external file when the workspace is unavailable', async () => {
    const path = join(fixture, 'external.html');
    await writeFile(path, 'external');
    const published = await createPublishArtifactsTool(join(fixture, 'missing-workspace'))
      .execute('publish', { paths: [path] });
    expect(published.details.artifacts[0]).toMatchObject({ availability: 'available', location: 'artifact_store' });
    expect((await readMediaReference(published.details.artifacts[0]!.uri!)).buffer.toString()).toBe('external');
  });
});
