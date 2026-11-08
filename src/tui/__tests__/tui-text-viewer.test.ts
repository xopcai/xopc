import { visibleWidth } from '@earendil-works/pi-tui';
import { expect, it } from 'vitest';

import { TextViewer } from '../components/text-viewer.js';
import { createXopcTuiKeybindingsManager } from '../tui-keybindings-file.js';

it('keeps output within the terminal after resize, including long titles and the navigation footer', () => {
  const viewer = new TextViewer('Very long workspace path /工作区/代码/项目/changed-file.ts'.repeat(3), '你好\ncontent', {
    rows: () => 20, close: () => {}, render: () => {}, keybindings: createXopcTuiKeybindingsManager(),
  });
  for (const width of [110, 93, 40, 20]) for (const line of viewer.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
});
