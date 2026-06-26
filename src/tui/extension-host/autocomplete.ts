import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
} from '@earendil-works/pi-tui';

import type {
  TuiAutocompleteProvider,
  TuiAutocompleteProviderApi,
  TuiAutocompleteProviderFactory,
} from '../../extensions/types/tui.js';

export interface ExtensionSlashCommandAutocompleteItem {
  originalName?: string;
  name: string;
  description: string;
}

export function dedupeAutocompleteItems(items: AutocompleteItem[]): AutocompleteItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.value)) return false;
    seen.add(item.value);
    return true;
  });
}

export class ChainedAutocompleteProvider implements AutocompleteProvider {
  constructor(
    private readonly primary: AutocompleteProvider,
    private readonly extraProviders: TuiAutocompleteProvider[],
    private readonly extensionSlashCommands: ExtensionSlashCommandAutocompleteItem[],
    private readonly baseSlashCommandNames: Set<string>,
    private readonly getSessionKey: () => string,
    private readonly cwd: string,
    private readonly additionalSlashCommands: ExtensionSlashCommandAutocompleteItem[] = [],
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

    const slashMatch = beforeCursor.match(/^\/([\w:-]*)$/);
    const slashCommands = [...this.additionalSlashCommands, ...this.extensionSlashCommands];
    if (slashMatch && slashCommands.length > 0) {
      const query = (slashMatch[1] ?? '').toLowerCase();
      const prefix = `/${slashMatch[1] ?? ''}`;
      const items: AutocompleteItem[] = slashCommands
        .filter((c) => !this.baseSlashCommandNames.has(c.originalName ?? c.name))
        .filter((c) => !query || c.name.toLowerCase().startsWith(query))
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

    const atMatch = beforeCursor.match(/@([^\s]*)$/);
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
        const value = s.value ?? `@${s.name}`;
        items.push({
          value,
          label: s.label ?? s.name,
          description: s.description,
        });
      }
    }

    if (items.length === 0) {
      return primary;
    }

    const primaryItems = primary?.prefix.startsWith('@') ? primary.items : [];
    const merged = dedupeAutocompleteItems([...primaryItems, ...items]);

    return {
      prefix: primary?.prefix.startsWith('@') ? primary.prefix : prefix,
      items: merged.slice(0, 30),
    };
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ) {
    if (prefix.startsWith('/') && item.value.startsWith('/')) {
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
    if (prefix.startsWith('@')) {
      const line = lines[cursorLine] ?? '';
      const before = line.slice(0, cursorCol);
      const start = before.length - prefix.length;
      const suffix = item.value.startsWith('@file:') && !item.value.endsWith('/') ? ' ' : '';
      const nextLine = line.slice(0, start) + item.value + suffix + line.slice(cursorCol);
      const nextLines = [...lines];
      nextLines[cursorLine] = nextLine;
      return {
        lines: nextLines,
        cursorLine,
        cursorCol: start + item.value.length + suffix.length,
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

export class WrappedAutocompleteProvider implements AutocompleteProvider {
  constructor(
    private readonly baseProvider: AutocompleteProvider,
    private readonly factories: TuiAutocompleteProviderFactory[],
  ) {}

  private currentProvider(): AutocompleteProvider {
    let provider = this.baseProvider as TuiAutocompleteProviderApi;
    const triggerCharacters: string[] = [];
    for (const factory of this.factories) {
      provider = factory(provider);
      triggerCharacters.push(...(provider.triggerCharacters ?? []));
    }
    if (triggerCharacters.length > 0) {
      provider.triggerCharacters = [...new Set(triggerCharacters)];
    }
    return provider as AutocompleteProvider;
  }

  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteSuggestions | null> {
    return this.currentProvider().getSuggestions(lines, cursorLine, cursorCol, options);
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return this.currentProvider().applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  shouldTriggerFileCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean {
    return this.currentProvider().shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? false;
  }
}
