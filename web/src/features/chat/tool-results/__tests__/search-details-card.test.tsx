// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { messages } from '@/i18n/messages';
import { SearchDetailsCard } from '../search-details-card';
import { readSearchDetails } from '../search-details';
import { normalizeAgentMessages } from '@/features/chat/messages/agent-messages';

describe('expanded search details', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const info = { provider: 'xopc-cloud', upstream: 'tavily', cached: false, attemptCount: 2,
    attempts: [{ provider: 'xopc-cloud', upstream: 'deepseek', outcome: 'error', reason: 'timeout' },
      { provider: 'xopc-cloud', upstream: 'tavily', outcome: 'success' }] };
  const render = (developer = false, details: unknown = { searchInfo: info }, language: 'en' | 'zh' = 'en') => act(() => root.render(
    <SearchDetailsCard block={{ details }} summary="Step details" labels={messages(language).chat.searchDetails}
      developer={developer} language={language} />,
  ));
  const expand = async () => act(async () => {
    const disclosure = container.querySelector('details')!;
    disclosure.open = true;
    disclosure.dispatchEvent(new Event('toggle'));
  });
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('leaves the collapsed summary unchanged and hides provenance until expanded', async () => {
    render();
    expect(container.textContent).toBe('Step details');
    await expand();
    expect(container.textContent).toContain('XOPC Cloud · Tavily');
    expect(container.textContent).toContain('Fetched this time');
    expect(container.textContent).not.toContain('DeepSeek');
    expect(container.textContent).not.toContain('Timed out');
    expect(container.textContent).not.toContain('Attempt count');
  });

  it('shows the fallback route only in developer mode and removes it when toggled off', async () => {
    render(true); await expand();
    expect(container.textContent).toContain('Attempt count：2');
    expect(container.textContent).toContain('DeepSeek');
    expect(container.textContent).toContain('Timed out');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    render(false);
    expect(container.textContent).toContain('XOPC Cloud · Tavily');
    expect(container.textContent).not.toContain('DeepSeek');
    expect(container.querySelector('ol')).toBeNull();
  });

  it('identifies cache hits as the original provider without claiming a new network request', async () => {
    render(true, { searchInfo: { ...info, cached: true } }); await expand();
    expect(container.textContent).toContain('Cached result');
    expect(container.textContent).toContain('original source');
    expect(container.textContent).toContain('Original request attempts');
    expect(container.textContent).not.toContain('Fetched this time');
  });

  it('shows direct DeepSeek and localized cache state', async () => {
    render(false, { provider: 'deepseek', cached: false }, 'zh'); await expand();
    expect(container.textContent).toContain('搜索服务：DeepSeek');
    expect(container.textContent).toContain('本次获取');
    expect(container.textContent).not.toContain('XOPC Cloud');
  });

  it('does not infer provenance or cache status for old history', async () => {
    render(false, { persistedDetailsTruncated: true }); await expand();
    expect(container.textContent).toContain('Search provider：Unknown');
    expect(container.textContent).toContain('Cache status unknown');
    expect(container.textContent).not.toContain('DeepSeek');
  });

  it('supports serialized results, mixed live metadata and missing cloud upstream', () => {
    const result = JSON.stringify({ details: { provider: 'deepseek', cached: false }, content: [] });
    expect(readSearchDetails({ result, details: {} })).toMatchObject({ provider: 'deepseek', cached: false });
    expect(readSearchDetails({ details: { searchInfo: info } })).toMatchObject({ upstream: 'tavily', attempts: info.attempts });
    expect(readSearchDetails({ result: 'Old plain text' })).toMatchObject({ provider: undefined, cached: undefined });
  });

  it('preserves provider and cached origin when rehydrating compact history', () => {
    const history = normalizeAgentMessages([{ role: 'assistant', content: 'Done', timestamp: 1, toolCalls: [{
      id: 'search-1', name: 'web_search', args: { query: 'query' }, result: 'Search results',
      details: { persistedDetailsTruncated: true, searchInfo: { ...info, cached: true } },
    }] }]);
    const block = history[0]?.content.find(part => part.type === 'tool_use');
    expect(block?.type).toBe('tool_use');
    if (block?.type === 'tool_use') expect(readSearchDetails(block)).toMatchObject({ provider: 'xopc-cloud', upstream: 'tavily', cached: true });
  });

  it('uses the deployed cloud headers without inventing unavailable fallback steps', async () => {
    render(true, { searchInfo: { provider: 'xopc-cloud', upstream: 'tavily', cached: false, attemptCount: 2, attempts: [] } });
    await expand();
    expect(container.textContent).toContain('XOPC Cloud · Tavily');
    expect(container.textContent).toContain('Some attempt details are unavailable');
    expect(container.querySelector('ol')).toBeNull();
  });

  it('does not display arbitrary upstream payloads as technical details', async () => {
    render(true, { searchInfo: { ...info, upstream: 'sk-sensitive-value', attempts: [{ provider: 'xopc-cloud', upstream: 'deepseek',
      outcome: 'error', reason: 'private error with a query and key' }] } }); await expand();
    expect(container.textContent).not.toContain('sk-sensitive-value');
    expect(container.textContent).not.toContain('private error');
  });
});
