import { describe, expect, it } from 'vitest';

import {
  formatLocalAppRuntimeIssue,
  getLocalAppAcceptanceFailures,
  parseLocalAppRuntimeMessage,
} from '@/features/local-apps/runtime-health';

describe('local app runtime health messages', () => {
  it('accepts bounded diagnostics from the preview bridge', () => {
    const message = parseLocalAppRuntimeMessage({
      source: 'xopc-local-app-preview',
      version: 1,
      type: 'error',
      detail: { kind: 'script_error', message: 'boom', filename: 'ui/app.js', line: 12, column: 4 },
    });
    expect(message).toEqual({
      type: 'error',
      detail: { kind: 'script_error', message: 'boom', filename: 'ui/app.js', line: 12, column: 4 },
    });
    if (message?.type === 'error') {
      expect(formatLocalAppRuntimeIssue(message.detail)).toBe('boom (ui/app.js:12:4)');
    }
  });

  it('rejects unrelated window messages', () => {
    expect(parseLocalAppRuntimeMessage({ source: 'extension', version: 1, type: 'ready' })).toBeNull();
    expect(parseLocalAppRuntimeMessage('ready')).toBeNull();
  });

  it('accepts bounded automatic acceptance results', () => {
    const message = parseLocalAppRuntimeMessage({
      source: 'xopc-local-app-preview',
      version: 1,
      type: 'acceptance',
      detail: {
        status: 'failed',
        interactiveCount: 2,
        checks: [
          { id: 'document', status: 'passed', message: 'Preview document loaded' },
          { id: 'interaction', status: 'failed', message: 'One control needs a name' },
        ],
      },
    });
    expect(message).toEqual({
      type: 'acceptance',
      detail: {
        status: 'failed',
        interactiveCount: 2,
        checks: [
          { id: 'document', status: 'passed', message: 'Preview document loaded' },
          { id: 'interaction', status: 'failed', message: 'One control needs a name' },
        ],
      },
    });
    expect(message?.type === 'acceptance' ? getLocalAppAcceptanceFailures(message.detail) : []).toEqual([
      'One control needs a name',
    ]);
  });

  it('rejects malformed automatic acceptance checks', () => {
    expect(parseLocalAppRuntimeMessage({
      source: 'xopc-local-app-preview',
      version: 1,
      type: 'acceptance',
      detail: {
        status: 'passed',
        checks: [{ id: 'network', status: 'passed', message: 'Unexpected check' }],
      },
    })).toBeNull();
  });

  it('accepts bounded product scenario results', () => {
    expect(parseLocalAppRuntimeMessage({
      source: 'xopc-local-app-preview',
      version: 1,
      type: 'criteria',
      detail: {
        status: 'failed',
        scenarioCount: 1,
        scenarios: [{
          id: 'create-item',
          name: 'Create an item',
          status: 'failed',
          message: 'Step 2: expected text was not found',
        }],
      },
    })).toEqual({
      type: 'criteria',
      detail: {
        status: 'failed',
        scenarioCount: 1,
        scenarios: [{
          id: 'create-item',
          name: 'Create an item',
          status: 'failed',
          message: 'Step 2: expected text was not found',
        }],
      },
    });
  });
});
