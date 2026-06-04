import { describe, expect, it } from 'vitest';

import { ExtensionApiImpl, createExtensionLogger, createPathResolver } from '../../extensions/api.js';
import { ExtensionRegistryImpl } from '../../extensions/loader.js';
import { createTuiExtensionHost } from '../extension-host/host.js';
import { TuiExtensionSurface } from '../extension-host/surface.js';
import {
  clearTuiToolRenderers,
  registerTuiToolRenderer,
  renderToolWithExtensions,
} from '../extension-host/tool-renderers.js';

describe('TuiExtensionSurface', () => {
  it('collects header and footer widget lines', () => {
    const surface = new TuiExtensionSurface();
    surface.headerWidgets.set('a', ['line-a']);
    surface.footerWidgets.set('b', ['line-b']);
    surface.statusSlots.set('c', 'status-c');
    expect(surface.getHeaderLines()).toEqual(['line-a']);
    expect(surface.getFooterLines()).toEqual(['line-b']);
    expect(surface.getStatusParts()).toEqual(['status-c']);
  });
});

describe('createTuiExtensionHost', () => {
  it('registers widgets and slash commands via host API', () => {
    const surface = new TuiExtensionSurface();
    const slashCommands: Array<{ name: string; description: string; handler: (args: string) => void }> =
      [];
    const host = createTuiExtensionHost({
      extensionId: 'test-ext',
      surface,
      getSessionKey: () => 'agent:main:main',
      notify: () => {},
      showOverlay: () => {},
      hideOverlay: () => {},
      onAutocompleteProviderAdded: () => () => {},
      onSlashCommandAdded: (name, description, handler) => {
        slashCommands.push({ name, description, handler });
        return () => {};
      },
      onInvalidate: () => {},
    });

    host.setHeaderWidget('banner', ['Extension banner']);
    host.setFooterWidget('hint', ['Footer hint']);
    host.setStatus('sync', 'ok');
    host.registerSlashCommand('demo', 'Demo command', () => {});

    expect(surface.getHeaderLines()).toEqual(['Extension banner']);
    expect(surface.getFooterLines()).toEqual(['Footer hint']);
    expect(surface.getStatusParts()).toEqual(['ok']);
    expect(slashCommands).toHaveLength(1);
    expect(slashCommands[0]?.name).toBe('demo');
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
    );

    api.registerTui(() => {});
    expect(registry.getTuiRegistrations()).toHaveLength(1);
    expect(registry.getTuiRegistrations()[0]?.extensionId).toBe('demo');
  });
});

describe('tui tool renderers', () => {
  it('invokes extension renderer for matching tool names', () => {
    clearTuiToolRenderers();
    registerTuiToolRenderer('custom_tool', (ctx) => [
      `custom:${ctx.toolName}:${ctx.resultText}`,
    ]);
    const rendered = renderToolWithExtensions({
      toolName: 'custom_tool',
      args: {},
      resultText: 'done',
      isError: false,
      expanded: true,
    });
    expect(rendered).toEqual(['custom:custom_tool:done']);
    clearTuiToolRenderers();
  });
});
