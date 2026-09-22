// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useLocaleStore } from '@/stores/locale-store';
import { createPageContextDraftStore } from './page-context-draft';
import { PageContextPreview } from './page-context-preview';

describe('page context preview and removal', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useLocaleStore.setState({ language: 'en' });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

  it('provides an expandable safe text preview and removes only the pending context', async () => {
    const state = createPageContextDraftStore();
    state.put('chat', state.capture({ title: 'Selected Note', text: '<img src=x onerror=alert(1)>',
      resourceRefs: [{ kind: 'note', id: 'one', revision: '2' }], selection: { text: 'Edited draft', draft: true } }));
    function Harness() {
      const draft = state.store(value => value.drafts.chat);
      return <><input aria-label="Message" defaultValue="Keep my prompt" />
        {draft ? <PageContextPreview draft={draft} onRemove={() => state.remove('chat', draft)} /> : null}</>;
    }
    await act(async () => root.render(<Harness />));
    expect(container.querySelector('summary')?.textContent).toContain('Selected Note');
    expect(container.querySelector('details')?.open).toBe(false);
    await act(async () => container.querySelector('summary')!.click());
    expect(container.querySelector('details')?.open).toBe(true);
    expect(container.textContent).toContain('Unsaved draft (user-provided)');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Remove page context: Selected Note"]')!.click());
    expect(container.querySelector('section')).toBeNull();
    expect(container.querySelector('input')?.value).toBe('Keep my prompt');
    expect(state.store.getState().drafts).toEqual({});
  });

  it('labels waiting state and disables removal during submission', async () => {
    const state = createPageContextDraftStore();
    const draft = state.capture({ title: 'Note', text: '', resourceRefs: [] });
    await act(async () => root.render(<PageContextPreview draft={draft} onRemove={() => { throw new Error('Unexpected removal'); }} disabled waiting />));
    expect(container.querySelector('button')?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('after the current run');
  });
});
