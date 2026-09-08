import { describe, expect, it, vi } from 'vitest';

import type { BrowserControlResult, BrowserObservation } from '@xopcai/browser-control-contract';

import type { BrowserRuntime } from '../../runtime/browser-runtime.js';
import { runBrowserAutomation, resolveBrowserAutomationInputs } from '../runner.js';
import { BrowserAutomationDefinitionSchema } from '../schema.js';
import type { BrowserAutomationDefinition } from '../types.js';

const definition: BrowserAutomationDefinition = {
  id: 'search-example',
  name: 'Search example',
  allowedDomains: ['example.com'],
  risk: 'draft',
  inputs: { query: { type: 'string', default: 'xopc' } },
  steps: [
    { action: 'navigate', url: 'https://example.com' },
    { action: 'fill', target: { role: 'textbox', name: 'Search' }, value: '${input.query}' },
  ],
};

describe('BrowserAutomationDefinitionSchema', () => {
  it('accepts semantic targets and declared input templates', () => {
    expect(BrowserAutomationDefinitionSchema.safeParse(definition).success).toBe(true);
  });

  it('rejects selector-based targets, URL-shaped domains, and undeclared templates', () => {
    expect(BrowserAutomationDefinitionSchema.safeParse({
      ...definition,
      allowedDomains: ['https://example.com'],
      steps: [{ action: 'click', target: { role: 'button', selector: '#submit' } }],
    }).success).toBe(false);
    expect(BrowserAutomationDefinitionSchema.safeParse({
      ...definition,
      steps: [{ action: 'navigate', url: 'https://example.com/${input.missing}' }],
    }).success).toBe(false);
  });

  it('applies defaults without mutating caller input', () => {
    const provided = {};
    expect(resolveBrowserAutomationInputs(definition, provided)).toEqual({ query: 'xopc' });
    expect(provided).toEqual({});
  });
});

describe('runBrowserAutomation', () => {
  it('fails the step when navigation redirects outside its exact domain allowlist', async () => {
    const observation: BrowserObservation = {
      sessionId: 'session-1',
      tabId: 'tab-1',
      revision: 1,
      documentId: 'document-1',
      url: 'https://evil.example',
      title: 'Redirected',
      nodes: [],
      changes: { added: [], changed: [], removed: [] },
    };
    const success: BrowserControlResult = {
      ok: true,
      receipt: {
        action: 'navigate',
        risk: 'read',
        durationMs: 1,
        verified: true,
        observation,
      },
    };
    const execute = vi.fn().mockResolvedValue(success);
    const onStep = vi.fn();

    const result = await runBrowserAutomation({
      definition: { ...definition, steps: [definition.steps[0]!] },
      inputs: {},
      runtime: { execute } as unknown as BrowserRuntime,
      taskKey: 'automation-run-1',
      signal: new AbortController().signal,
      onStep,
    });

    expect(result).toMatchObject({ ok: false, error: { code: 'BLOCKED_URL' } });
    expect(onStep.mock.calls.map(([event]) => event.status)).toEqual(['started', 'failed']);
  });
});
