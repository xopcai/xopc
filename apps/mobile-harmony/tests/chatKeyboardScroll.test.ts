import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { chatReplySpaceBudget, consumeChatReplySpace } from '../entry/src/main/ets/common/chatReplySpace.ets';

const source = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  onMessageChange(): void'), source.indexOf('  private async loadOlder()'))
  .replace(/@Monitor\([^\n]+\)\n/g, '');
const navigationMethods = source.slice(source.indexOf('  onActivityChange(): void'), source.indexOf("  @Monitor('focusRevision'"))
  .replace(/@Monitor\([^\n]+\)\n/g, '');
const compiled = ts.transpileModule(`class ScrollHandlers { ${methods} ${navigationMethods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const Handler = new Function('Edge', 'ScrollAlign', 'chatReplySpaceBudget', 'consumeChatReplySpace', 'ScrollSource', 'ScrollState', `${compiled}; return ScrollHandlers;`)(
  { Bottom: 'bottom' }, { END: 'end' }, chatReplySpaceBudget, consumeChatReplySpace,
  { SCROLLER: 'scroller', SCROLLER_ANIMATION: 'animation', DRAG: 'drag', FLING: 'fling', EDGE_EFFECT: 'edge', OTHER_USER_INPUT: 'other', SCROLL_BAR: 'bar', SCROLL_BAR_FLING: 'bar-fling' }, { Idle: 'idle' });

function setup() {
  vi.useFakeTimers();
  return Object.assign(new Handler(), {
    visible: true, atBottom: true, initialScrollPending: false, loadingOlder: false,
    renderKeys: { update() {} }, chat: { selectedId: 'one', loading: false, cachedHistory: false }, scrollTimer: -1,
    olderGeneration: 0, initialScrollAttempts: 0,
    layoutScrollAnimating: false, layout: { reduceMotion: false }, presentationRows: [{ id: 'last' }],
    messagesScroller: { scrollEdge: vi.fn(), scrollToIndex: vi.fn(), isAtEnd: vi.fn(() => false), currentOffset: () => ({ yOffset: 2000 }) },
    replyAnchorId: '', replySpaceHeight: 0, replyBudget: 0, messageViewportHeight: 720,
    bottomRegionHeight: 96, chatTopInset: 0, replyRowHeights: new Map(),
  });
}

afterEach(() => { vi.useRealTimers(); });

describe('chat keyboard viewport following', () => {
  it('targets the actual virtual-list tail and waits for layout before ending initial alignment', () => {
    const view = setup(); view.resetMessagePosition(); view.chat.hasOlder = true;
    view.presentationRows = Array.from({ length: 200 }, (_, index) => ({ id: String(index) }));
    view.onMessageChange(); vi.advanceTimersByTime(50);
    expect(view.messagesScroller.scrollToIndex).toHaveBeenLastCalledWith(201, false, 'end');
    expect(view.initialScrollPending).toBe(true);
    view.messagesScroller.isAtEnd.mockReturnValue(true); vi.advanceTimersByTime(50);
    expect(view.initialScrollPending).toBe(false);
  });

  it('reopens the selected conversation at the tail and invalidates an old prepend anchor', () => {
    const view = setup(); view.atBottom = false; view.loadingOlder = true;
    Object.assign(view, { requestedId: 'one', requestRevision: 2, appliedRequestRevision: 1,
      dismissComposer: vi.fn(), olderGeneration: 7 });
    view.onTargetChange();
    expect(view.atBottom).toBe(true); expect(view.loadingOlder).toBe(false);
    expect(view.olderGeneration).toBe(8);
    vi.advanceTimersByTime(50);
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledWith(1, false, 'end');
  });

  it('restores a cancelled follow operation on reactivation but preserves an intentional history position', () => {
    const view = setup();
    Object.assign(view, { activePage: true, bindBack: vi.fn(),
      onHistoryReady: vi.fn(), options: { resume: vi.fn() }, prompt: { resume: vi.fn() } });
    view.chat.activate = vi.fn();
    view.visible = false; view.onActivityChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).toHaveBeenCalledOnce();
    view.atBottom = false; view.visible = false; view.onActivityChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).toHaveBeenCalledOnce();
  });

  it('ignores edge-effect callbacks and lets an upward gesture cancel pending initial alignment', () => {
    const view = setup(); view.resetMessagePosition(); view.onMessageChange();
    view.onMessageScrollSource('edge'); view.onMessageScroll(-10, 'scroll');
    expect(view.atBottom).toBe(true);
    view.onMessageScrollSource('drag'); view.onMessageScroll(-10, 'scroll');
    expect(view.atBottom).toBe(false); expect(view.initialScrollPending).toBe(false);
    vi.runAllTimers(); expect(view.messagesScroller.scrollToIndex).not.toHaveBeenCalled();
  });

  it('does not apply an old deferred alignment to a newly selected conversation', () => {
    const view = setup(); view.resetMessagePosition(); view.onMessageChange();
    view.chat.selectedId = 'two'; vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).not.toHaveBeenCalled();
    expect(view.messagesScroller.scrollEdge).not.toHaveBeenCalled();
  });

  it('lets the reader stop following cached history while its network refresh is pending', () => {
    const view = setup(); view.chat.loading = true; view.chat.cachedHistory = true;
    view.onMessageScrollSource('drag'); view.onMessageScroll(-10, 'scroll');
    expect(view.atBottom).toBe(false); expect(view.showJumpBottom).toBe(true);
    view.onMessageChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).not.toHaveBeenCalled();
  });

  it('moves a bottom-following send up, consumes reply growth, and freezes when reading history', () => {
    const view = setup();
    view.presentationRows = [{ id: 'question' }];
    view.reserveReplySpace('question', 'next');
    expect(view.replySpaceHeight).toBeCloseTo(226.8);
    view.presentationRows.push({ id: 'reply' });
    view.recordReplyRowHeight('reply', 20);
    expect(view.replySpaceHeight).toBeCloseTo(186.8);
    view.onMessageScrollSource('drag'); view.onMessageScroll(-20, 'scroll');
    view.recordReplyRowHeight('reply', 300);
    expect(view.replySpaceHeight).toBeCloseTo(186.8);
    view.atBottom = true; view.updateReplySpace();
    expect(view.replySpaceHeight).toBe(0);
    view.atBottom = false; view.reserveReplySpace('history-question', 'next');
    expect(view.replyAnchorId).toBe('history-question');
    expect(view.atBottom).toBe(true);
    expect(view.initialScrollPending).toBe(true);
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
  it('reserves the actual status bar inset only for full-screen chats', () => {
    const view = setup();
    view.chatTopInset = 32;
    view.reserveReplySpace('last', 'next');
    expect(view.replySpaceHeight).toBeCloseTo(212.4);
    view.embedded = true;
    view.reserveReplySpace('last', 'next');
    expect(view.replySpaceHeight).toBeCloseTo(259.2);
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
