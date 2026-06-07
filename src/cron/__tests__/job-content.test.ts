import { describe, it, expect } from 'vitest';
import { getCronPayloadText } from '../job-content.js';

describe('getCronPayloadText', () => {
  it('reads systemEvent text', () => {
    expect(
      getCronPayloadText({
        payload: { kind: 'systemEvent', text: 'hello' },
      })
    ).toBe('hello');
  });

  it('reads agentTurn message', () => {
    expect(
      getCronPayloadText({
        payload: { kind: 'agentTurn', message: 'prompt' },
      })
    ).toBe('prompt');
  });

  it('reads workflowRun goal when available', () => {
    expect(
      getCronPayloadText({
        payload: { kind: 'workflowRun', definitionId: 'release-check', goal: 'Check release' },
      })
    ).toBe('Check release');
  });

  it('falls back to workflowRun definition id', () => {
    expect(
      getCronPayloadText({
        payload: { kind: 'workflowRun', definitionId: 'release-check' },
      })
    ).toBe('release-check');
  });
});
