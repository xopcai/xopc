// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TabCompletionInput, TabCompletionTextarea } from './tab-completion-input';
import { suggestionFromExample } from './tab-completion-input.utils';

describe('TabCompletionInput', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('extracts the accepted value from localized example placeholders', () => {
    expect(suggestionFromExample('例如：整理会议记录…')).toBe('整理会议记录');
    expect(suggestionFromExample('For example: summarize meeting notes')).toBe('summarize meeting notes');
    expect(suggestionFromExample('e.g. Reading list')).toBe('Reading list');
  });

  it.each(['Tab', 'Enter'])('accepts an input recommendation with %s only while empty', (key) => {
    const accept = vi.fn();
    act(() => root.render(
      <TabCompletionInput value="" onChange={() => {}} suggestion="Recommended value" onAcceptSuggestion={accept} />,
    ));

    const input = container.querySelector('input')!;
    const firstTab = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => input.dispatchEvent(firstTab));
    expect(firstTab.defaultPrevented).toBe(true);
    expect(accept).toHaveBeenCalledWith('Recommended value');
    expect(input.getAttribute('aria-keyshortcuts')).toBe('Tab Enter');

    input.value = 'Already entered';
    const secondTab = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    act(() => input.dispatchEvent(secondTab));
    expect(secondTab.defaultPrevented).toBe(false);
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('accepts textarea suggestions with Enter while preserving modified and composing keys', () => {
    const accept = vi.fn();
    act(() => root.render(
      <TabCompletionTextarea value="" onChange={() => {}} suggestion="Recommended value" onAcceptSuggestion={accept} />,
    ));
    const textarea = container.querySelector('textarea')!;
    for (const modifiers of [
      { shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true },
    ]) {
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...modifiers });
      act(() => textarea.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(accept).not.toHaveBeenCalled();
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => textarea.dispatchEvent(enter));
    expect(enter.defaultPrevented).toBe(true);
    expect(accept).toHaveBeenCalledExactlyOnceWith('Recommended value');
  });

  it('preserves modified Tab navigation and an existing prevented handler', () => {
    const accept = vi.fn();
    const onKeyDown = vi.fn((event: React.KeyboardEvent<HTMLTextAreaElement>) => event.preventDefault());
    act(() => root.render(
      <TabCompletionTextarea
        value=""
        onChange={() => {}}
        suggestion="Recommended value"
        onAcceptSuggestion={accept}
        onKeyDown={onKeyDown}
      />,
    ));

    const textarea = container.querySelector('textarea')!;
    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    act(() => textarea.dispatchEvent(shiftTab));
    expect(accept).not.toHaveBeenCalled();

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => textarea.dispatchEvent(tab));
    expect(onKeyDown).toHaveBeenCalledTimes(2);
    expect(accept).not.toHaveBeenCalled();
  });
});
