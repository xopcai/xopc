import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

const source = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  private async loadOlder()'), source.indexOf("  @Monitor('chat.loading', 'chat.rows', 'activePage')"));
const compiled = ts.transpileModule(`class Handler { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const Handler = new Function('ScrollAlign', 'LengthMetrics', `${compiled}; return Handler;`)({ START: 'start' }, { vp: (value: number) => value });

describe('history prefetch scrolling', () => {
  it('anchors to the current visible message when the network returns, not where loading began', async () => {
    vi.useFakeTimers();
    try {
      let finish!: () => void;
      const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const view = Object.assign(new Handler(), {
        loadingOlder: false, initialScrollPending: false, olderGeneration: 0, firstVisible: 1, visible: true,
        pauseAutomaticScroll: vi.fn(), messageHeaderClearance: 64, presentationRows: rows, chat: { hasOlder: true, loading: false, selectedId: 'one', rows, error: '' },
        messagesScroller: { getItemRect: vi.fn(() => ({ y: -17 })), scrollToIndex: vi.fn() },
      });
      view.chat.loadHistory = vi.fn((_older, beforePrepend) => new Promise<void>(resolve => {
        finish = () => {
          beforePrepend();
          view.chat.rows = [{ id: 'older' }, ...rows]; view.presentationRows = view.chat.rows; resolve();
        };
      }));
      const loading = view.loadOlder();
      view.firstVisible = 2;
      finish(); await loading; await vi.advanceTimersByTimeAsync(30);
      expect(view.messagesScroller.getItemRect).toHaveBeenCalledWith(2);
      expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledWith(3, false, 'start', { extraOffset: 81 });
      expect(view.loadingOlder).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
