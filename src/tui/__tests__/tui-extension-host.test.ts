import { describe, expect, it, vi } from 'vitest';

import { ExtensionApiImpl, createExtensionLogger, createPathResolver } from '../../extensions/api.js';
import { ExtensionRegistryImpl } from '../../extensions/loader.js';
import { createTuiExtensionHost } from '../extension-host/host.js';
import { TuiExtensionSurface } from '../extension-host/surface.js';
import { ExtensionInputDialog, ExtensionSelectDialog } from '../components/extension-dialog.js';
import { XopcKeybindingsManager } from '../tui-keybindings-file.js';
import {
  extensionCustomMessageContentToText,
  extensionCustomMessageToTurnText,
  extensionUserMessageContentToText,
} from '../tui-extension-user-message.js';

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('TuiExtensionSurface', () => {
  it('collects header and footer widget lines', () => {
    const surface = new TuiExtensionSurface();
    surface.headerWidgets.set('b', ['line-b']);
    surface.headerWidgets.set('a', ['line-a']);
    surface.footerWidgets.set('b', ['footer-b']);
    surface.footerWidgets.set('a', ['footer-a']);
    surface.statusSlots.set('c', 'status\nc');
    surface.statusSlots.set('a', 'status\ta');
    expect(surface.getHeaderLines()).toEqual(['line-a', 'line-b']);
    expect(surface.getFooterLines()).toEqual(['footer-a', 'footer-b']);
    expect(surface.getStatusParts()).toEqual(['status a', 'status c']);
  });
});

describe('createTuiExtensionHost', () => {
  it('registers widgets and slash commands via host API', () => {
    const surface = new TuiExtensionSurface();
    const slashCommands: Array<{ name: string; description: string; handler: (args: string) => void }> =
      [];
    const shortcuts: Array<{ key: string; description: string; handler: () => void }> = [];
    const hiddenThinkingLabels: Array<string | undefined> = [];
    const workingMessages: Array<string | undefined> = [];
    const workingVisible: boolean[] = [];
    const workingIndicators: Array<{ frames?: string[]; intervalMs?: number } | undefined> = [];
    const headerFactories: unknown[] = [];
    const footerFactories: unknown[] = [];
    const messageRenderers: Array<{ customType: string; renderer: unknown }> = [];
    const disposeWidgetA = vi.fn();
    const disposeWidgetB = vi.fn();
    let editorFactory: unknown;
    const host = createTuiExtensionHost({
      extensionId: 'test-ext',
      surface,
      getSessionKey: () => 'agent:main:main',
      notify: () => {},
      onTerminalInputAdded: () => () => {},
      showOverlay: () => {},
      hideOverlay: () => {},
      custom: async () => undefined,
      createWidgetComponent: (factory) => factory({}, {}),
      setFooter: (factory) => {
        footerFactories.push(factory);
      },
      setHeader: (factory) => {
        headerFactories.push(factory);
      },
      setTitle: () => {},
      pasteToEditor: () => {},
      setEditorText: () => {},
      getEditorText: () => '',
      editor: async () => undefined,
      setEditorComponent: (factory) => {
        editorFactory = factory;
      },
      getEditorComponent: () => editorFactory as never,
      getThemeObject: () => ({ name: 'active' }),
      getAllThemes: () => [{ name: 'dark', path: undefined }],
      getTheme: (name) => ({ name }),
      setTheme: () => ({ success: true }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
      onAutocompleteProviderAdded: () => () => {},
      onAutocompleteProviderFactoryAdded: () => () => {},
      onMessageRendererAdded: (customType, renderer) => {
        messageRenderers.push({ customType, renderer });
        return () => {};
      },
      onSlashCommandAdded: (name, description, handler) => {
        slashCommands.push({ name, description, handler });
        return () => {};
      },
      onShortcutAdded: (key, description, handler) => {
        shortcuts.push({ key, description, handler });
        return () => {};
      },
      setWorkingMessage: (message) => workingMessages.push(message),
      setWorkingVisible: (visible) => workingVisible.push(visible),
      setWorkingIndicator: (indicator) => workingIndicators.push(indicator),
      setHiddenThinkingLabel: (label) => hiddenThinkingLabels.push(label),
      onInvalidate: () => {},
    });

    host.setHeaderWidget('banner', ['Extension banner']);
    host.setFooterWidget('hint', ['Footer hint']);
    host.setHeader(() => ({ render: () => ['custom-header'] }));
    host.setFooter(() => ({ render: () => ['custom-footer'] }));
    const nextEditorFactory = () => ({
      render: () => ['custom-editor'],
      getText: () => '',
      setText: () => {},
      handleInput: () => {},
    });
    host.setEditorComponent(nextEditorFactory);
    host.setWidget('above', ['Above editor']);
    host.setWidget('below', ['Below editor'], { placement: 'belowEditor' });
    host.setWidget('move', ['Move above']);
    host.setWidget('move', ['Move below'], { placement: 'belowEditor' });
    host.setWidget('clear', ['Clear me']);
    host.setWidget('clear', undefined);
    host.setWidget('component', () => ({
      render: () => ['component-a'],
      dispose: disposeWidgetA,
    }));
    host.setWidget('component', () => ({
      render: () => ['component-b'],
      dispose: disposeWidgetB,
    }), { placement: 'belowEditor' });
    host.setWidget('long', Array.from({ length: 12 }, (_, index) => `Line ${index + 1}`));
    host.setStatus('sync', 'ok');
    host.registerMessageRenderer('status-update', () => ({ render: () => ['status-rendered'] }));
    host.registerSlashCommand('demo', 'Demo command', () => {});
    host.registerShortcut('x', 'Demo shortcut', () => {});
    host.setHiddenThinkingLabel('Working...');
    host.setHiddenThinkingLabel(null);
    host.setWorkingMessage('Indexing...');
    host.setWorkingMessage(null);
    host.setWorkingVisible(false);
    host.setWorkingVisible(true);
    host.setWorkingIndicator({ frames: ['●'], intervalMs: 250 });
    host.setWorkingIndicator(null);

    expect(surface.getHeaderLines()).toEqual([
      'Above editor',
      'Extension banner',
      'Line 1',
      'Line 2',
      'Line 3',
      'Line 4',
      'Line 5',
      'Line 6',
      'Line 7',
      'Line 8',
      'Line 9',
      'Line 10',
      '... (widget truncated)',
    ]);
    expect(surface.getFooterLines()).toEqual(['Below editor', 'Footer hint', 'Move below']);
    expect(surface.getHeaderComponents()).toEqual([]);
    expect(surface.getFooterComponents().map((component) => component.render(80))).toEqual([
      ['component-b'],
    ]);
    expect(disposeWidgetA).toHaveBeenCalledOnce();
    expect(disposeWidgetB).not.toHaveBeenCalled();
    expect(surface.getStatusParts()).toEqual(['ok']);
    expect(headerFactories).toHaveLength(1);
    expect(footerFactories).toHaveLength(1);
    expect(host.getEditorComponent()).toBe(nextEditorFactory);
    expect(host.theme).toEqual({ name: 'active' });
    expect(host.getAllThemes()).toEqual([{ name: 'dark', path: undefined }]);
    expect(host.getTheme('dark')).toEqual({ name: 'dark' });
    expect(host.setTheme('dark')).toEqual({ success: true });
    expect(host.getToolsExpanded()).toBe(false);
    expect(messageRenderers).toHaveLength(1);
    expect(messageRenderers[0]?.customType).toBe('status-update');
    expect(slashCommands).toHaveLength(1);
    expect(slashCommands[0]?.name).toBe('demo');
    expect(shortcuts).toHaveLength(1);
    expect(shortcuts[0]?.key).toBe('x');
    expect(hiddenThinkingLabels).toEqual(['Working...', undefined]);
    expect(workingMessages).toEqual(['Indexing...', undefined]);
    expect(workingVisible).toEqual([false, true]);
    expect(workingIndicators).toEqual([{ frames: ['●'], intervalMs: 250 }, undefined]);
  });
});

describe('extension dialogs', () => {
  it('renders keybinding-aware hints and countdown state', () => {
    const keybindings = new XopcKeybindingsManager({
      'tui.select.confirm': 'x',
      'tui.select.cancel': 'z',
    });
    const select = new ExtensionSelectDialog(
      'Pick target',
      ['alpha', 'beta'],
      { onSelect: () => {}, onCancel: () => {} },
      keybindings,
    );
    select.setCountdownSeconds(3);

    const selectText = stripAnsi(select.render(80).join('\n'));
    expect(selectText).toContain('Pick target (3s)');
    expect(selectText).toContain('X select');
    expect(selectText).toContain('Z cancel');

    const input = new ExtensionInputDialog(
      'Enter value',
      'placeholder',
      { onSubmit: () => {}, onCancel: () => {} },
      keybindings,
    );
    input.setCountdownSeconds(2);
    const inputText = stripAnsi(input.render(80).join('\n'));
    expect(inputText).toContain('Enter value (2s)');
    expect(inputText).toContain('placeholder');
    expect(inputText).toContain('X submit');
    expect(inputText).toContain('Z cancel');
  });
});

describe('ExtensionApi.registerTui', () => {
  it('stores deferred registrars on the shared registry', () => {
    const registry = new ExtensionRegistryImpl();
    const api = new ExtensionApiImpl(
      'demo',
      'Demo',
      '1.0.0',
      '/tmp/demo',
      {},
      {},
      createExtensionLogger('demo'),
      createPathResolver('/tmp/demo', process.cwd()),
      registry,
      { tui: ['demo'] },
    );

    api.registerTui(() => {});
    expect(registry.getTuiRegistrations()).toHaveLength(1);
    expect(registry.getTuiRegistrations()[0]?.extensionId).toBe('demo');
  });

  it('forwards setLabel to the active runtime when available', () => {
    const registry = new ExtensionRegistryImpl();
    const setLabel = vi.fn();
    const api = new ExtensionApiImpl(
      'demo',
      'Demo',
      '1.0.0',
      '/tmp/demo',
      {},
      {},
      createExtensionLogger('demo'),
      createPathResolver('/tmp/demo', process.cwd()),
      registry,
      { tui: ['demo'] },
      { config: {}, log: createExtensionLogger('demo'), setLabel },
    );

    api.setLabel('row-2', 'important');
    api.setLabel('row-2', undefined);

    expect(setLabel).toHaveBeenNthCalledWith(1, 'row-2', 'important');
    expect(setLabel).toHaveBeenNthCalledWith(2, 'row-2', undefined);
  });

  it('forwards sendUserMessage to the active runtime when available', () => {
    const registry = new ExtensionRegistryImpl();
    const sendUserMessage = vi.fn();
    const api = new ExtensionApiImpl(
      'demo',
      'Demo',
      '1.0.0',
      '/tmp/demo',
      {},
      {},
      createExtensionLogger('demo'),
      createPathResolver('/tmp/demo', process.cwd()),
      registry,
      { tui: ['demo'] },
      { config: {}, log: createExtensionLogger('demo'), sendUserMessage },
    );

    api.sendUserMessage('hello');
    api.sendUserMessage('next', { deliverAs: 'next' });

    expect(sendUserMessage).toHaveBeenNthCalledWith(1, 'hello', undefined);
    expect(sendUserMessage).toHaveBeenNthCalledWith(2, 'next', { deliverAs: 'next' });
  });

  it('forwards appendEntry to the active runtime when available', () => {
    const registry = new ExtensionRegistryImpl();
    const appendEntry = vi.fn();
    const api = new ExtensionApiImpl(
      'demo',
      'Demo',
      '1.0.0',
      '/tmp/demo',
      {},
      {},
      createExtensionLogger('demo'),
      createPathResolver('/tmp/demo', process.cwd()),
      registry,
      { tui: ['demo'] },
      { config: {}, log: createExtensionLogger('demo'), appendEntry },
    );

    api.appendEntry('preset-state', { name: 'fast' });

    expect(appendEntry).toHaveBeenCalledWith('preset-state', { name: 'fast' });
  });

  it('forwards sendMessage to the active runtime when available', () => {
    const registry = new ExtensionRegistryImpl();
    const sendMessage = vi.fn();
    const api = new ExtensionApiImpl(
      'demo',
      'Demo',
      '1.0.0',
      '/tmp/demo',
      {},
      {},
      createExtensionLogger('demo'),
      createPathResolver('/tmp/demo', process.cwd()),
      registry,
      { tui: ['demo'] },
      { config: {}, log: createExtensionLogger('demo'), sendMessage },
    );

    api.sendMessage(
      { customType: 'status-update', content: 'ready', display: true },
      { triggerTurn: true, deliverAs: 'next' },
    );

    expect(sendMessage).toHaveBeenCalledWith(
      { customType: 'status-update', content: 'ready', display: true },
      { triggerTurn: true, deliverAs: 'next' },
    );
  });
});

describe('extensionUserMessageContentToText', () => {
  it('joins text content blocks for pi-style sendUserMessage payloads', () => {
    expect(extensionUserMessageContentToText([
      { type: 'text', text: 'hello' },
      { type: 'text', text: ' world' },
      { type: 'image', image: 'ignored' } as never,
    ])).toBe('hello world');
  });

  it('joins text blocks for custom message payloads', () => {
    expect(extensionCustomMessageContentToText([
      { type: 'text', text: 'custom' },
      { type: 'text', text: ' message' },
      { type: 'image', image: 'ignored' },
    ])).toBe('custom message');
  });

  it('formats custom messages for extension-triggered turns', () => {
    expect(extensionCustomMessageToTurnText({
      customType: 'status-update',
      content: [{ type: 'text', text: 'ready' }],
      details: { phase: 'index' },
    })).toBe('Extension message: status-update\n\nContent:\nready\n\nDetails:\n{\n  "phase": "index"\n}');
  });
});
