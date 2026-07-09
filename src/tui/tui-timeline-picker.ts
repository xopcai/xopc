import type {
  Component,
  Focusable,
  KeybindingsManager,
  SelectItem,
} from '@earendil-works/pi-tui';

import { SearchableSelectList } from './components/searchable-select-list.js';
import { formatKeyIds } from './format-tui-hotkeys.js';
import { searchableSelectListTheme, theme } from './theme.js';
import {
  formatTimelineToolSummary,
  type TuiTimelineTurn,
} from './tui-timeline.js';

type TimelineSelectItem = SelectItem & {
  searchText?: string;
  turn: TuiTimelineTurn;
};

function formatTime(timestamp?: number): string {
  if (timestamp === undefined) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function timelineSelectItems(
  turns: readonly TuiTimelineTurn[],
  activeDisplayIndex?: number,
): TimelineSelectItem[] {
  const activeTurn = activeDisplayIndex === undefined
    ? undefined
    : [...turns].reverse().find((turn) => turn.displayIndex <= activeDisplayIndex);

  return turns.map((turn) => {
    const current = activeTurn?.id === turn.id;
    const description = [
      formatTimelineToolSummary(turn.toolCount),
      formatTime(turn.timestamp),
      turn.running ? 'running' : '',
      current ? 'current' : '',
    ].filter(Boolean).join(' · ');
    return {
      value: turn.id,
      label: `${String(turn.turn).padStart(3, ' ')}  ${turn.preview}`,
      description,
      searchText: `${turn.turn} ${turn.preview} ${description}`,
      turn,
    };
  });
}

export function formatTimelineOpenedHint(keybindings: KeybindingsManager): string {
  const up = formatKeyIds(keybindings, 'tui.select.up', { capitalize: true });
  const down = formatKeyIds(keybindings, 'tui.select.down', { capitalize: true });
  const confirm = formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true });
  const cancel = formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true });
  return `Timeline (${up}/${down} · type to filter · ${confirm} jump · ${cancel} close)`;
}

export class TimelineSelectList implements Component, Focusable {
  private readonly list: SearchableSelectList;
  private readonly items: TimelineSelectItem[];

  onSelect?: (turn: TuiTimelineTurn) => void;
  onCancel?: () => void;

  constructor(
    turns: readonly TuiTimelineTurn[],
    options: {
      activeDisplayIndex?: number;
      initialQuery?: string;
      keybindings: KeybindingsManager;
    },
  ) {
    this.items = timelineSelectItems(turns, options.activeDisplayIndex);
    this.list = new SearchableSelectList(
      this.items,
      Math.min(14, Math.max(1, this.items.length)),
      searchableSelectListTheme,
      {
        searchPromptText: 'timeline: ',
        wrapNavigation: true,
        ...(options.initialQuery ? { initialQuery: options.initialQuery } : {}),
      },
    );
    this.list.onSelect = (item) => {
      const turn = (item as TimelineSelectItem).turn;
      if (turn) this.onSelect?.(turn);
    };
    this.list.onCancel = () => this.onCancel?.();

    const activeItem = this.items.find((item) => item.description?.includes('current'));
    if (activeItem) this.list.setSelectedValue(activeItem.value);
  }

  get focused(): boolean {
    return this.list.focused;
  }

  set focused(value: boolean) {
    this.list.focused = value;
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    const count = this.items.length;
    return [
      theme.dim(`Timeline · ${count} turn${count === 1 ? '' : 's'}`),
      '',
      ...this.list.render(width),
    ];
  }

  handleInput(keyData: string): void {
    this.list.handleInput(keyData);
  }
}
