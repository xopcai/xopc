// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSystemAudioMixSupported } from '@/features/discussions/audio-capture-mixer';

import { NoteMarkdownView, toggleMarkdownTaskAtIndex } from '../note-markdown-view';

describe('mobile notes reading and capture ergonomics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('toggles GFM task list items by index while skipping fenced code blocks', () => {
    const md = [
      '# 今日事项',
      '',
      '```md',
      '- [ ] 代码块里的示例不能被误改',
      '```',
      '',
      '- [ ] 第一项待办',
      '- [x] 第二项已完成',
      '1. [ ] 编号待办',
    ].join('\n');

    const checkedFirst = toggleMarkdownTaskAtIndex(md, 0, true);
    expect(checkedFirst).toContain('- [ ] 代码块里的示例不能被误改');
    expect(checkedFirst).toContain('- [x] 第一项待办');

    const uncheckedSecond = toggleMarkdownTaskAtIndex(checkedFirst, 1, false);
    expect(uncheckedSecond).toContain('- [ ] 第二项已完成');

    const checkedNumbered = toggleMarkdownTaskAtIndex(uncheckedSecond, 2, true);
    expect(checkedNumbered).toContain('1. [x] 编号待办');
  });

  it('enables direct tap-to-toggle on rendered checkboxes in reading mode', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onToggle = vi.fn();

    try {
      await act(async () => {
        root.render(
          <MemoryRouter>
            <NoteMarkdownView
              content={'- [ ] 准备评审材料\n- [x] 发送邀请'}
              onToggleTaskIndex={onToggle}
            />
          </MemoryRouter>,
        );
      });

      const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(2);
      expect(checkboxes[0].disabled).toBe(false);

      await act(async () => {
        checkboxes[0].click();
      });
      expect(onToggle).toHaveBeenCalledWith(0, true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('hides desktop tab/system audio mixing on iPhone and Android mobile browsers', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    );
    expect(isSystemAudioMixSupported()).toBe(false);
  });
});
