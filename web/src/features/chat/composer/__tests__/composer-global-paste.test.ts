// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import { shouldRouteGlobalComposerPaste } from '@/features/chat/composer/composer-global-paste';

function pasteEvent(target: EventTarget, defaultPrevented = false): ClipboardEvent {
  return {
    target,
    defaultPrevented,
  } as ClipboardEvent;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('shouldRouteGlobalComposerPaste', () => {
  it('routes paste from non-editable chat content', () => {
    const message = document.createElement('div');
    document.body.append(message);

    expect(
      shouldRouteGlobalComposerPaste(pasteEvent(message), {
        disabled: false,
        editorHidden: false,
      }),
    ).toBe(true);
  });

  it.each(['input', 'textarea', 'select'])(
    'does not steal paste from an active %s',
    (tagName) => {
      const editable = document.createElement(tagName);
      document.body.append(editable);
      editable.focus();

      expect(
        shouldRouteGlobalComposerPaste(pasteEvent(editable), {
          disabled: false,
          editorHidden: false,
        }),
      ).toBe(false);
    },
  );

  it('does not steal paste from contenteditable or textbox widgets', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    editor.setAttribute('role', 'textbox');
    document.body.append(editor);

    expect(
      shouldRouteGlobalComposerPaste(pasteEvent(editor), {
        disabled: false,
        editorHidden: false,
      }),
    ).toBe(false);
  });

  it('does not route when another editor is active even if the event targets the page', () => {
    const message = document.createElement('div');
    const textarea = document.createElement('textarea');
    document.body.append(message, textarea);
    textarea.focus();

    expect(
      shouldRouteGlobalComposerPaste(pasteEvent(message), {
        disabled: false,
        editorHidden: false,
      }),
    ).toBe(false);
  });

  it('still routes paste when a normal button has focus', () => {
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();

    expect(
      shouldRouteGlobalComposerPaste(pasteEvent(button), {
        disabled: false,
        editorHidden: false,
      }),
    ).toBe(true);
  });

  it('does not route while a modal dialog is open', () => {
    const message = document.createElement('div');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.append(message, dialog);

    expect(
      shouldRouteGlobalComposerPaste(pasteEvent(message), {
        disabled: false,
        editorHidden: false,
      }),
    ).toBe(false);
  });

  it('does not route handled, disabled, or hidden-editor paste', () => {
    const message = document.createElement('div');
    document.body.append(message);

    expect(
      shouldRouteGlobalComposerPaste(pasteEvent(message, true), {
        disabled: false,
        editorHidden: false,
      }),
    ).toBe(false);
    expect(
      shouldRouteGlobalComposerPaste(pasteEvent(message), {
        disabled: true,
        editorHidden: false,
      }),
    ).toBe(false);
    expect(
      shouldRouteGlobalComposerPaste(pasteEvent(message), {
        disabled: false,
        editorHidden: true,
      }),
    ).toBe(false);
  });
});
