// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HomeEvidence, HomeEvidencePresentation } from '@xopcai/gateway-contract';

import { useLocaleStore } from '@/stores/locale-store';
import { HomeEvidenceList } from '../home-evidence-list';

const records: HomeEvidence[] = [
  { id: 'one', sourceType: 'task', sourceRef: 'task', revision: '1',
    observation: 'Source documents conflict on whether 拾光 is to be published externally.',
    observedAt: 1_000, freshUntil: 90_000, href: '/tasks/task-1' },
  { id: 'two', sourceType: 'user_model', sourceRef: 'knowledge', revision: '2',
    observation: 'Source docs conflict on publishing intent; unresolved.',
    observedAt: 2_000, freshUntil: 90_000, href: 'javascript:alert(1)' },
];
const presentation: HomeEvidencePresentation = {
  version: 1, locale: 'zh', groups: [{ summary: '发布口径存在冲突，尚未确认。', evidenceIds: ['one', 'two'] }],
};

describe('HomeEvidenceList', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const previousLanguage = useLocaleStore.getState().language;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'zh' });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useLocaleStore.setState({ language: previousLanguage });
  });
  const render = async (evidencePresentation?: HomeEvidencePresentation, evidence = records) => {
    await act(async () => root.render(<MemoryRouter>
      <HomeEvidenceList opportunity={{ evidence, evidencePresentation }} />
    </MemoryRouter>));
  };

  it('shows Chinese summaries and retains independently traceable original records', async () => {
    await render(presentation);
    expect(container.textContent).toContain('发布口径存在冲突，尚未确认。');
    expect(container.textContent).toContain('2 条记录');
    const details = container.querySelector('details')!;
    expect(details.open).toBe(false);
    await act(async () => details.querySelector('summary')!.click());
    expect(details.open).toBe(true);
    expect(details.textContent).toContain(records[0].observation);
    expect(details.textContent).toContain(records[1].observation);
    expect(details.querySelectorAll('time')).toHaveLength(2);
    expect(details.querySelector('a')?.getAttribute('href')).toBe('/?task=task-1');
    expect(details.querySelectorAll('a')).toHaveLength(1);
    expect(details.textContent).toContain('暂无可打开的来源');
  });

  it('keeps legacy records accessible and explicitly falls back after language changes', async () => {
    await render();
    expect(container.textContent).toContain('此记录尚无中文摘要');
    await render(presentation);
    await act(async () => useLocaleStore.setState({ language: 'en' }));
    expect(container.textContent).toContain('No English summary is available');
    expect(container.textContent).not.toContain(presentation.groups[0].summary);
    expect(container.textContent).toContain(records[0].observation);
  });

  it('escapes source text, opens external links safely, and collapses groups beyond three', async () => {
    const evidence = Array.from({ length: 4 }, (_, i) => ({
      ...records[0], id: String(i), observation: '<img src=x onerror=alert(1)>', href: 'https://example.com/source',
    }));
    await render({ version: 1, locale: 'zh', groups: evidence.map((record) => ({
      summary: `第 ${record.id} 条依据尚待确认。`, evidenceIds: [record.id],
    })) }, evidence);
    const more = [...container.querySelectorAll('details')].find((item) => item.querySelector('summary')?.textContent === '展开其余 1 组');
    expect(more?.open).toBe(false);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
