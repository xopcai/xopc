import Ajv from 'ajv';

import { describe, expect, it } from 'vitest';

import { createTaskResultTool } from '../task-result-tool.js';
import { withTaskEvidenceIdentity } from '../task-evidence.js';
import { bindResearchSources } from '../../../tasks/task-research-result.js';

describe('Task source identity', () => {
  it('exposes the host protocol ID while retaining the exact read and result metadata', async () => {
    const tool = { name: 'exec_command', label: 'Run', description: '', parameters: {} as never,
      execute: async () => ({ content: [{ type: 'text' as const, text: 'Fixture files verified\nEXIT=0' }], details: { id: 'command-run-id', status: 'success' } }) };
    const result = await withTaskEvidenceIdentity(tool).execute('call_00_actual', {});
    expect(result.details.id).toBe('command-run-id');
    expect(result.content).toContainEqual({ type: 'text', text: 'Task source toolCallId: call_00_actual' });
    const rangeReceipt = result.content.find(item => item.type === 'text' && item.text.includes('excerptRanges'));
    expect(rangeReceipt).toBeDefined();
    const evidence = JSON.parse((rangeReceipt as { text: string }).text).evidence;
    const ranged = bindResearchSources({ sources: [{ id: 'ranged', toolCallId: evidence.toolCallId,
      excerptRange: evidence.excerptRanges[0] }], claims: [] },
      [{ toolCallId: 'call_00_actual', toolName: 'exec_command', body: result.content.map(item => item.text).join('\n'), observedAt: 1 }]);
    expect(ranged[0].excerpt).toBe('Fixture files verified\nEXIT=0');
    const source = bindResearchSources({ sources: [{ id: 'run', toolCallId: 'call_00_actual', excerpt: 'Fixture files verified\nEXIT=0' }], claims: [] },
      [{ toolCallId: 'call_00_actual', toolName: 'exec_command', body: result.content.map(item => item.text).join('\n'), observedAt: 1 }]);
    expect(source[0].toolCallId).toBe('call_00_actual');
  });

  it('exposes exact published artifact IDs so final selection never requires guessing filenames', async () => {
    const tool = { name: 'publish_artifacts', label: 'Publish', description: '', parameters: {} as never,
      execute: async () => ({ content: [{ type: 'text' as const, text: '1 artifact published: report.md' }],
        details: { artifacts: [{ artifactId: 'opaque-id', title: 'report.md', availability: 'available' }] } }) };
    const result = await withTaskEvidenceIdentity(tool).execute('actual-call', {});
    expect(JSON.stringify(result.content)).toContain('opaque-id');
    expect(JSON.stringify(result.content)).toContain('report.md');
  });

  it('keeps the model submission schema aligned with the strict host ledger schema', () => {
    const validate = new Ajv({ strict: false }).compile(createTaskResultTool(() => undefined).parameters);
    const valid = { sources: [{ id: 's', excerpt: 'Observed fact' }], claims: [{ id: 'c', statement: 'Fact', kind: 'fact', sourceIds: ['s'] }] };
    expect(validate(valid)).toBe(true);
    expect(validate({ ...valid, sources: [{ id: 's', toolCallId: 'actual', excerptRange: { start: 0, end: 20 } }] })).toBe(true);
    expect(validate({ ...valid, sources: [{ id: 's', excerptRange: { start: 0, end: 20 } }] })).toBe(false);
    expect(validate({ ...valid, sources: [{ id: 's', excerpt: 'quote', toolCallId: 'actual', excerptRange: { start: 0, end: 20 } }] })).toBe(false);
    expect(validate({ ...valid, claims: [{ ...valid.claims[0], note: 'Reviewer note cannot be resubmitted' }] })).toBe(false);
    expect(validate({ ...valid, sources: [{ ...valid.sources[0], support: 'supported' }] })).toBe(false);
  });
  it('leaves non-evidence tools unchanged', () => {
    const tool = { name: 'personal_task' };
    expect(withTaskEvidenceIdentity(tool as never)).toBe(tool);
  });
  it('offers ranges for completed managed jobs but never for running or failed job status', async () => {
    for (const status of ['running', 'failed', 'cancelled', 'success']) {
      const tool = { name: 'managed_job', label: 'Job', parameters: {} as never, description: '',
        execute: async () => ({ content: [{ type: 'text' as const, text: 'Fixture files verified' }],
          details: { status, exitCode: status === 'success' ? 0 : null } }) };
      const result = await withTaskEvidenceIdentity(tool).execute(`job-${status}`, { action: 'wait' });
      expect(JSON.stringify(result.content).includes('excerptRanges')).toBe(status === 'success');
    }
  });
});
