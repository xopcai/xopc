import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { chatReplySpaceBudget, consumeChatReplySpace } from '../entry/src/main/ets/common/chatReplySpace.ets';

const source = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  onMessageChange(): void'), source.indexOf('  private async loadOlder()'))
  .replace(/@Monitor\([^\n]+\)\n/g, '');
const compiled = ts.transpileModule(`class ScrollHandlers { ${methods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Handler = new Function('Edge', 'ScrollAlign', 'chatReplySpaceBudget', 'consumeChatReplySpace', 'ScrollSource', 'ScrollState', `${compiled}; return ScrollHandlers;`)(
  { Bottom: 'bottom' }, { END: 'end' }, chatReplySpaceBudget, consumeChatReplySpace,
  { SCROLLER: 'scroller', SCROLLER_ANIMATION: 'animation', DRAG: 'drag' }, { Idle: 'idle' });

function setup() {
  vi.useFakeTimers();
  return Object.assign(new Handler(), {
    visible: true, atBottom: true, initialScrollPending: false, loadingOlder: false,
    chat: { loading: false, cachedHistory: false }, scrollTimer: -1,
    layoutScrollAnimating: false, layout: { reduceMotion: false }, presentationRows: [{ id: 'last' }],
    messagesScroller: { scrollEdge: vi.fn(), scrollToIndex: vi.fn(), isAtEnd: () => false },
    replyAnchorId: '', replySpaceHeight: 0, replyBudget: 0, messageViewportHeight: 720,
    bottomRegionHeight: 96, replyRowHeights: new Map(),
  });
}

afterEach(() => { vi.useRealTimers(); });

describe('chat keyboard viewport following', () => {
  it('moves a bottom-following send up, consumes reply growth, and freezes when reading history', () => {
    const view = setup();
    view.presentationRows = [{ id: 'question' }];
    view.reserveReplySpace('question', 'next');
    expect(view.replySpaceHeight).toBeCloseTo(226.8);
    view.presentationRows.push({ id: 'reply' });
    view.recordReplyRowHeight('reply', 20);
    expect(view.replySpaceHeight).toBeCloseTo(186.8);
    view.atBottom = false;
    view.recordReplyRowHeight('reply', 300);
    expect(view.replySpaceHeight).toBeCloseTo(186.8);
    view.reserveReplySpace('history-question', 'next');
    expect(view.replyAnchorId).toBe('question');
    view.atBottom = true;
    view.updateReplySpace();
    expect(view.replySpaceHeight).toBe(0);
  });

  it('does not reserve space for queued follow-ups or disturb a short completed reply', () => {
    const view = setup();
    view.chat.runId = 'running';
    view.reserveReplySpace('queued', 'next');
    expect(view.replySpaceHeight).toBe(0);
    view.chat.runId = '';
    view.presentationRows = [{ id: 'question' }];
    view.reserveReplySpace('question', 'next');
    view.presentationRows.push({ id: 'reply' });
    view.recordReplyRowHeight('reply', 20);
    view.onMessageChange();
    expect(view.replySpaceHeight).toBeCloseTo(186.8);
  });
  it('corrects late streamed row growth even after the temporary reply space is exhausted', () => {
    const view = setup();
    view.replySpaceHeight = 0;
    view.recordReplyRowHeight('last', 500);
    vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).toHaveBeenCalledOnce();
    view.atBottom = false;
    view.recordReplyRowHeight('last', 700);
    vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).toHaveBeenCalledOnce();
  });

  it('keeps following through controller scrolls and stops when the reader scrolls away', () => {
    const view = setup();
    view.onMessageScrollSource('scroller');
    view.onMessageScroll(20, 'fling');
    expect(view.atBottom).toBe(true);
    view.onMessageScrollSource('animation');
    view.onMessageScroll(20, 'fling');
    expect(view.atBottom).toBe(true);
    view.onMessageScrollSource('drag');
    view.onMessageScroll(20, 'scroll');
    expect(view.atBottom).toBe(false);
    expect(view.showJumpBottom).toBe(true);
  });

  it('follows the bottom after keyboard resize without requiring new messages', () => {
    const view = setup();
    view.onMessageViewportChange({ width: 375, height: 700 }, { width: 375, height: 420 });
    expect(view.messagesScroller.scrollEdge).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledExactlyOnceWith(1, true, 'end');
  });

  it('coalesces viewport and composer changes and follows keyboard dismissal', () => {
    const view = setup();
    view.onMessageViewportChange({ width: 375, height: 700 }, { width: 375, height: 420 });
    view.onMessageLayoutChange();
    vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledTimes(1);
    view.onMessageViewportChange({ width: 375, height: 420 }, { width: 375, height: 700 });
    vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledTimes(2);
  });

  it('does not jump away from older messages or while loading history', () => {
    for (const state of [{ atBottom: false }, { loadingOlder: true }, { visible: false }]) {
      const view = Object.assign(setup(), state);
      view.onMessageViewportChange({ width: 375, height: 700 }, { width: 375, height: 420 });
      vi.runAllTimers();
      expect(view.messagesScroller.scrollEdge).not.toHaveBeenCalled();
      expect(view.messagesScroller.scrollToIndex).not.toHaveBeenCalled();
    }
  });

  it('rechecks follow intent before applying the deferred scroll', () => {
    const view = setup();
    view.onMessageViewportChange({ width: 375, height: 700 }, { width: 375, height: 420 });
    view.atBottom = false;
    vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).not.toHaveBeenCalled();
    expect(view.messagesScroller.scrollToIndex).not.toHaveBeenCalled();
  });

  it('ignores position-only callbacks and binds both geometry change sources', () => {
    const view = setup();
    view.onMessageViewportChange({ width: 375, height: 420 }, { width: 375, height: 420 });
    vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).not.toHaveBeenCalled();
    expect(source).toContain("@Monitor('bottomRegionHeight')");
    expect(source).toContain('.onAreaChange((previous: Area, current: Area): void => { this.onMessageViewportChange(previous, current); })');
    expect(source).toContain(".id('chat-reply-clearance')");
  });

  it('does not interrupt a keyboard animation for every streaming token', () => {
    const view = setup();
    view.onMessageLayoutChange(); vi.runAllTimers();
    view.onMessageChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).not.toHaveBeenCalled();
    view.finishLayoutScroll(); vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).toHaveBeenCalledOnce();
  });

  it('respects reduced motion and includes the older-history header in the target', () => {
    const view = setup(); view.layout.reduceMotion = true;
    view.onMessageLayoutChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).toHaveBeenCalledOnce();
    expect(view.messagesScroller.scrollToIndex).not.toHaveBeenCalled();
    view.layout.reduceMotion = false; view.chat.hasOlder = true;
    view.onMessageLayoutChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledWith(2, true, 'end');
  });
});
