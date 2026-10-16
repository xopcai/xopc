// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import type { AgentDefaults } from '../../types/agent-gateway';

vi.mock('../agent-defaults-voice-summary', () => ({ AgentDefaultsVoiceSummary: () => null }));
import { AgentDefaultsModelsPanel } from '../agent-defaults-models-panel';

it('shows inherited global models as links without another model editor', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div');
  const root = createRoot(container);
  const models = { chat: { primary: 'qwen-token-plan-cn/qwen3.8-flash', fallbacks: [] }, imageUnderstanding: { primary: 'qwen-token-plan-cn/qwen3.8-flash', fallbacks: [] }, background: { primary: 'xopc-cloud/auto', fallbacks: [] }, intents: {} };
  const original = structuredClone(models);
  try {
    await act(async () => root.render(<MemoryRouter><AgentDefaultsModelsPanel zh draft={{ models } as unknown as AgentDefaults} /></MemoryRouter>));
    expect(container.textContent).toContain('qwen-token-plan-cn/qwen3.8-flash');
    expect(container.querySelector('button, input, [role="combobox"]')).toBeNull();
    expect(container.querySelector('a[href="/settings/capabilities/models?use=chat"]')).not.toBeNull();
    expect(container.querySelector('a[href="/settings/capabilities/models?use=background"]')).not.toBeNull();
    expect(models).toEqual(original);
  } finally { await act(async () => root.unmount()); }
});
