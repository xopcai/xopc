// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';

import { AgentRunErrorBanner } from '../agent-run-error-banner';
import { useLocaleStore } from '@/stores/locale-store';

it.each([
  ['en', 'Model connection interrupted', 'Review any completed tool actions'],
  ['zh', '模型连接中断', '请先确认执行结果'],
] as const)('explains provider connection errors in %s', (language, title, guidance) => {
  const originalLanguage = useLocaleStore.getState().language;
  const originalActEnvironment = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  useLocaleStore.setState({ language });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    act(() => root.render(<MemoryRouter><AgentRunErrorBanner errorText={JSON.stringify({
      kind: 'provider_connection_error', code: 'provider_connection_error', message: 'Connection error.',
    })} /></MemoryRouter>));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(title);
    expect(container.textContent).toContain(guidance);
    expect(container.querySelector('pre')?.textContent).toBe('Connection error.');
  } finally {
    act(() => root.unmount());
    useLocaleStore.setState({ language: originalLanguage });
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
  }
});
