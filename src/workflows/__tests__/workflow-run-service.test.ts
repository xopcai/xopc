import { describe, expect, it } from 'vitest';

import type { WorkflowDefinition } from '../domain/index.js';
import {
  buildWorkflowRunDefinitionSnapshot,
  buildWorkflowRunInputEnvelope,
  buildWorkflowRunMetadata,
} from '../service/workflow-run-service.js';

function createDefinition(): WorkflowDefinition {
  return {
    id: 'release-check',
    name: 'release-check',
    title: 'Release Check',
    description: 'Check a release',
    version: '1.2.3',
    phases: [
      { id: 'inspect', title: 'Inspect' },
      { id: 'summarize', title: 'Summarize' },
    ],
    runtime: { kind: 'script', source: 'return true' },
    defaults: {
      concurrency: 2,
      timeoutSec: 60,
      maxSubagents: 8,
    },
    metadata: {
      tags: ['release'],
      builtIn: true,
      source: 'builtin',
      estimatedAgents: { min: 1, max: 2 },
      createdAtMs: 1_000,
      updatedAtMs: 2_000,
    },
  };
}

describe('WorkflowRunService helpers', () => {
  it('wraps legacy input into a stable input envelope', () => {
    const envelope = buildWorkflowRunInputEnvelope({ branch: 'main' }, 'Check release');

    expect(envelope).toEqual({
      payload: { branch: 'main' },
      goal: 'Check release',
    });
  });

  it('preserves an existing input envelope', () => {
    const existingEnvelope = {
      payload: { branch: 'main' },
      variables: { releaseType: 'patch' },
      context: { actor: 'cron' },
    };

    expect(buildWorkflowRunInputEnvelope(existingEnvelope)).toBe(existingEnvelope);
  });

  it('builds a stable definition snapshot for run metadata', () => {
    const snapshot = buildWorkflowRunDefinitionSnapshot(createDefinition());

    expect(snapshot).toEqual({
      id: 'release-check',
      name: 'release-check',
      title: 'Release Check',
      version: '1.2.3',
      source: 'builtin',
      tags: ['release'],
      phaseCount: 2,
      estimatedAgents: { min: 1, max: 2 },
    });
  });

  it('builds metadata with cron schedule and correlation fields', () => {
    const input = buildWorkflowRunInputEnvelope({ branch: 'main' }, 'Check release');
    const metadata = buildWorkflowRunMetadata({
      definition: createDefinition(),
      agentId: 'main',
      sessionKey: 'agent:main:webchat:default:direct:wf_run-abc',
      source: { kind: 'cron', scheduleId: 'nightly', fireId: 'fire-1', scheduledAtMs: 123 },
      input,
      retryOfRunId: 'run-previous',
      idempotencyKey: 'idem-1',
    });

    expect(metadata).toMatchObject({
      sessionKey: 'agent:main:webchat:default:direct:wf_run-abc',
      triggerSource: 'cron',
      agentId: 'main',
      retryOfRunId: 'run-previous',
      input,
      correlation: { idempotencyKey: 'idem-1' },
      origin: { channel: 'cron', scheduleId: 'nightly', fireId: 'fire-1' },
      schedule: { scheduleId: 'nightly', fireId: 'fire-1' },
    });
  });
});
