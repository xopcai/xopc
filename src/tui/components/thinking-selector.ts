import {
  Container,
  SelectList,
  Spacer,
  Text,
  type Component,
  type KeybindingsManager,
  type SelectItem,
  type SelectListLayoutOptions,
} from '@earendil-works/pi-tui';

import type { ThinkLevel } from '../../agent/transcript/thinking-types.js';
import { formatKeyIds } from '../format-tui-hotkeys.js';
import { selectListTheme, theme } from '../theme.js';

const THINKING_SELECT_LIST_LAYOUT: SelectListLayoutOptions = {
  minPrimaryColumnWidth: 12,
  maxPrimaryColumnWidth: 32,
};

export const TUI_THINKING_LEVEL_DESCRIPTIONS: Record<ThinkLevel, string> = {
  off: 'No reasoning',
  minimal: 'Very brief reasoning',
  low: 'Light reasoning',
  medium: 'Moderate reasoning',
  high: 'Deep reasoning',
  xhigh: 'Maximum reasoning',
  adaptive: 'Adapt to task complexity',
};

export type ThinkingSelectorCallbacks = {
  onSelect: (level: ThinkLevel) => void;
  onCancel: () => void;
};

export class ThinkingSelector extends Container implements Component {
  private readonly selectList: SelectList;

  constructor(
    currentLevel: string | undefined,
    levels: ThinkLevel[],
    callbacks: ThinkingSelectorCallbacks,
    keybindings?: KeybindingsManager,
  ) {
    super();

    this.addChild(new Text(theme.bold(theme.accent('Thinking level')), 0, 0));
    this.addChild(new Spacer(1));

    const items: SelectItem[] = levels.map((level) => ({
      value: level,
      label: level,
      description: TUI_THINKING_LEVEL_DESCRIPTIONS[level],
    }));

    this.selectList = new SelectList(
      items,
      Math.min(items.length, 8),
      selectListTheme,
      THINKING_SELECT_LIST_LAYOUT,
    );

    const normalizedCurrent = currentLevel?.toLowerCase();
    const idx = items.findIndex((item) => item.value === normalizedCurrent);
    if (idx >= 0) this.selectList.setSelectedIndex(idx);

    this.selectList.onSelect = (item) => callbacks.onSelect(item.value as ThinkLevel);
    this.selectList.onCancel = callbacks.onCancel;
    this.addChild(this.selectList);
    this.addChild(new Spacer(1));
    const confirm = keybindings
      ? formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true })
      : 'Enter';
    const cancel = keybindings
      ? formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true })
      : 'Esc';
    this.addChild(new Text(theme.dim(`  ${confirm} select · ${cancel} close`), 0, 0));
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}
