import type { Component, TUI } from '@earendil-works/pi-tui';
import {
  CombinedAutocompleteProvider,
  type AutocompleteItem,
  type AutocompleteProvider,
  type AutocompleteSuggestions,
} from '@earendil-works/pi-tui';

import type { ExtensionRegistryImpl } from '../../extensions/loader.js';
import type {
  TuiAutocompleteProvider,
  TuiAutocompleteSuggestion,
  TuiNotifyLevel,
  TuiSlashCommandHandler,
} from '../../extensions/types/tui.js';
import type { ChatLog } from '../components/chat-log.js';
import type { TuiHeader } from '../components/tui-header.js';
import type { TuiBottomBar } from '../components/tui-bottom-bar.js';
import type { TuiState } from '../tui-types.js';
import { theme } from '../theme.js';
import { createSkillsAutocompleteProvider } from '../tui-skills-autocomplete.js';
import { createTuiExtensionHost, invokeTuiExtensionRegistrars } from './host.js';
import { clearTuiToolRenderers } from './tool-renderers.js';
import { TuiExtensionSurface } from './surface.js';

export interface TuiExtensionSlashCommand {
  name: string;
  description: string;
  handler: TuiSlashCommandHandler;
}

export interface TuiExtensionRuntime {
  surface: TuiExtensionSurface;
  slashCommands: TuiExtensionSlashCommand[];
  autocompleteProvider: AutocompleteProvider;
  activate(): Promise<void>;
  dispose(): void;
}

export interface CreateTuiExtensionRuntimeOptions {
  registry?: ExtensionRegistryImpl;
  tui: TUI;
  chatLog: ChatLog;
  header: TuiHeader;
  bottomBar: TuiBottomBar;
  getState: () => TuiState;
  baseSlashCommands: Array<{ name: string; description: string }>;
  cwd: string;
  fdPath: string | null;
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  onInvalidate: () => void;
}

class ChainedAutocompleteProvider implements AutocompleteProvider {
  constructor(
    private readonly primary: AutocompleteProvider,
    private readonly extraProviders: TuiAutocompleteProvider[],
    private readonly extensionSlashCommands: TuiExtensionSlashCommand[],
    private readonly getSessionKey: () => string,
    private readonly cwd: string,
  ) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    const primary = await this.primary.getSuggestions(lines, cursorLine, cursorCol, options);

    const line = lines[cursorLine] ?? '';
    const beforeCursor = line.slice(0, cursorCol);

    const slashMatch = beforeCursor.match(/^\/([\w-]*)$/);
    if (slashMatch && this.extensionSlashCommands.length > 0) {
      const query = (slashMatch[1] ?? '').toLowerCase();
      const prefix = `/${slashMatch[1] ?? ''}`;
      const items: AutocompleteItem[] = this.extensionSlashCommands
        .filter((c) => !query || c.name.startsWith(query))
        .map((c) => ({
          value: `/${c.name}`,
          label: c.name,
          description: c.description,
        }));
      if (items.length > 0) {
        const merged = primary?.items ? [...primary.items, ...items] : items;
        const seen = new Set<string>();
        const deduped = merged.filter((item) => {
          if (seen.has(item.value)) return false;
          seen.add(item.value);
          return true;
        });
        return { prefix, items: deduped.slice(0, 30) };
      }
    }

    const atMatch = beforeCursor.match(/@([\w.-]*)$/);
    if (!atMatch) {
      return primary;
    }

    const query = atMatch[1] ?? '';
    const prefix = `@${query}`;
    const sessionKey = this.getSessionKey();
    const items: AutocompleteItem[] = [];

    for (const provider of this.extraProviders) {
      const suggestions = await provider(query, { cwd: this.cwd, sessionKey });
      for (const s of suggestions) {
        items.push({
          value: `@${s.name}`,
          label: s.name,
          description: s.description,
        });
      }
    }

    if (items.length === 0) {
      return primary;
    }

    const filtered = query
      ? items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
      : items;

    return {
      prefix,
      items: filtered.slice(0, 20),
    };
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ) {
    if (prefix.startsWith('@')) {
      const line = lines[cursorLine] ?? '';
      const before = line.slice(0, cursorCol);
      const start = before.length - prefix.length;
      const nextLine = line.slice(0, start) + item.value + line.slice(cursorCol);
      const nextLines = [...lines];
      nextLines[cursorLine] = nextLine;
      return {
        lines: nextLines,
        cursorLine,
        cursorCol: start + item.value.length,
      };
    }
    return this.primary.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  shouldTriggerFileCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean {
    return this.primary.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
  }
}

function notifyInChatLog(chatLog: ChatLog, tui: TUI, message: string, level?: TuiNotifyLevel) {
  const prefix = level === 'error' ? theme.error('✖ ') : level === 'warn' ? '⚠ ' : '';
  chatLog.addSystem(`${prefix}${message}`);
  tui.requestRender();
}

function suggestionsToAutocompleteItems(
  suggestions: TuiAutocompleteSuggestion[],
): AutocompleteItem[] {
  return suggestions.map((s) => ({
    value: `@${s.name}`,
    label: s.name,
    description: s.description,
  }));
}

export function createTuiExtensionRuntime(
  opts: CreateTuiExtensionRuntimeOptions,
): TuiExtensionRuntime {
  const surface = new TuiExtensionSurface();
  const slashCommands: TuiExtensionSlashCommand[] = [];
  const autocompleteProviders: TuiAutocompleteProvider[] = [
    createSkillsAutocompleteProvider(),
  ];
  const disposers: Array<() => void> = [];

  const baseProvider = new CombinedAutocompleteProvider(
    opts.baseSlashCommands.map((c) => ({ name: c.name, description: c.description })),
    opts.cwd,
    opts.fdPath,
  );

  const chainedProvider = new ChainedAutocompleteProvider(
    baseProvider,
    autocompleteProviders,
    slashCommands,
    () => opts.getState().currentSessionKey,
    opts.cwd,
  );

  const invalidate = () => {
    opts.header.setExtensionLines(surface.getHeaderLines());
    opts.bottomBar.setExtensionLines(surface.getFooterLines());
    opts.bottomBar.setExtensionStatusParts(surface.getStatusParts());
    opts.onInvalidate();
  };

  const createHost = (extensionId: string) =>
    createTuiExtensionHost({
      extensionId,
      surface,
      getSessionKey: () => opts.getState().currentSessionKey,
      notify: (message, level) => notifyInChatLog(opts.chatLog, opts.tui, message, level),
      showOverlay: opts.openOverlay,
      hideOverlay: opts.closeOverlay,
      onAutocompleteProviderAdded: (provider) => {
        autocompleteProviders.push(provider);
        return () => {
          const idx = autocompleteProviders.indexOf(provider);
          if (idx >= 0) autocompleteProviders.splice(idx, 1);
        };
      },
      onSlashCommandAdded: (name, description, handler) => {
        const normalized = name.replace(/^\//, '').toLowerCase();
        const entry: TuiExtensionSlashCommand = { name: normalized, description, handler };
        slashCommands.push(entry);
        return () => {
          const idx = slashCommands.indexOf(entry);
          if (idx >= 0) slashCommands.splice(idx, 1);
        };
      },
      onInvalidate: invalidate,
    });

  return {
    surface,
    slashCommands,
    autocompleteProvider: chainedProvider,
    async activate() {
      const registrars = opts.registry?.getTuiRegistrations() ?? [];
      await invokeTuiExtensionRegistrars(registrars, createHost, (extensionId, errorMessage) => {
        notifyInChatLog(
          opts.chatLog,
          opts.tui,
          `[${extensionId}] TUI init failed: ${errorMessage}`,
          'error',
        );
      });
      invalidate();
    },
    dispose() {
      for (const dispose of disposers) dispose();
      disposers.length = 0;
      clearTuiToolRenderers();
      surface.headerWidgets.clear();
      surface.footerWidgets.clear();
      surface.statusSlots.clear();
    },
  };
}

/** Exported for tests */
export { suggestionsToAutocompleteItems };
