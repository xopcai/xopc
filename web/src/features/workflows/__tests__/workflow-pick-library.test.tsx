// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { BUILTIN_WORKFLOWS } from '../../../../../src/agent/workflow/builtins/index';
import { useLocaleStore } from '@/stores/locale-store';

import type { WorkflowRunSummary } from '../workflow-api';
import { WorkflowPickLibrary } from '../workflow-pick-library';

const audit = BUILTIN_WORKFLOWS.find((definition) => definition.name === 'audit_repo')!;
const recentRun = { id: 'recent', definitionId: audit.id, createdAtMs: Date.now() } as WorkflowRunSummary;

function Library() {
  const language = useLocaleStore((state) => state.language);
  return <WorkflowPickLibrary definitions={[audit]} runs={[recentRun]} language={language} onPick={() => {}} onDetail={() => {}} onEdit={() => {}} />;
}

describe('workflow library language switching', () => {
  it('updates localized copy and keeps bilingual search working across language switches', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const originalLanguage = useLocaleStore.getState().language;
    const originalDefinition = structuredClone(audit);
    try {
      useLocaleStore.setState({ language: 'en' });
      await act(async () => root.render(<Library />));
      expect(container.textContent).toContain(audit.title);
      expect(container.querySelector('article p')?.textContent).toBe(audit.description);
      for (const language of ['zh', 'en', 'zh'] as const) {
        await act(async () => { useLocaleStore.setState({ language }); });
        const title = language === 'zh' ? audit.metadata.i18n!.zh.title! : audit.title;
        const description = language === 'zh' ? audit.metadata.i18n!.zh.description! : audit.description;
        expect(container.querySelector('article button')?.textContent).toBe(title);
        expect(container.querySelector('article p')?.textContent).toBe(description);
        expect(container.querySelector('article button[aria-label]')?.getAttribute('aria-label')).toContain(title);
        expect(container.querySelector('section button span span')?.textContent).toBe(title);
      }
      const search = container.querySelector<HTMLInputElement>('input[placeholder]')!;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      for (const [query, count] of [['no-matching-workflow', 0], ['代码仓库审查', 1], ['REPOSITORY AUDIT', 1], ['audit_repo', 1]] as const) {
        await act(async () => {
          setValue.call(search, query);
          search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(container.querySelectorAll('article')).toHaveLength(count);
        await act(async () => { useLocaleStore.setState({ language: 'en' }); });
        expect(search.value).toBe(query);
        expect(container.querySelectorAll('article')).toHaveLength(count);
        await act(async () => { useLocaleStore.setState({ language: 'zh' }); });
        expect(container.querySelectorAll('article')).toHaveLength(count);
      }
      expect(audit).toEqual(originalDefinition);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      useLocaleStore.setState({ language: originalLanguage });
    }
  });
});
