import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

const source = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');
const methods = source.slice(source.indexOf('  onMessageChange(): void'), source.indexOf('  private async loadOlder()'))
  .replace(/@Monitor\([^\n]+\)\n/g, '');
const navigationMethods = source.slice(source.indexOf('  onActivityChange(): void'), source.indexOf("  @Monitor('focusRevision'"))
  .replace(/@Monitor\([^\n]+\)\n/g, '');
const compiled = ts.transpileModule(`class ScrollHandlers { ${methods} ${navigationMethods} }`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const anchors = new Map();
const Handler = new Function('Edge', 'ScrollAlign', 'chatReadingAnchors', 'LengthMetrics',
  'ScrollSource', 'ScrollState', `${compiled}; return ScrollHandlers;`)(
  { Bottom: 'bottom' }, { START: 'start', END: 'end' }, anchors, { vp: (value: number) => value },
  { SCROLLER: 'scroller', SCROLLER_ANIMATION: 'animation', DRAG: 'drag', FLING: 'fling', EDGE_EFFECT: 'edge', OTHER_USER_INPUT: 'other', SCROLL_BAR: 'bar', SCROLL_BAR_FLING: 'bar-fling' }, { Idle: 'idle' });

function setup() {
  vi.useFakeTimers();
  anchors.clear();
  return Object.assign(new Handler(), {
    activePage: true, visible: true, atBottom: true, showJumpBottom: false, initialScrollPending: false, loadingOlder: false,
    renderKeys: { update() {} }, chat: { selectedId: 'one', transcriptId: 'transcript', loading: false, cachedHistory: false }, scrollTimer: -1,
    olderGeneration: 0, initialScrollAttempts: 0,
    draftScope: 'account-one', firstVisible: 0, generatedMediaGroups: new Map(),
    layout: { reduceMotion: false }, presentationRows: [{ id: 'last' }],
    messagesScroller: { scrollEdge: vi.fn(), scrollToIndex: vi.fn(), isAtEnd: vi.fn(() => false),
      getItemRect: vi.fn(() => ({ y: 0, height: 0 })), currentOffset: () => ({ yOffset: 2000 }) },
    messageViewportHeight: 720,
    bottomRegionHeight: 96, messageHeaderClearance: 0,
  });
}

afterEach(() => { vi.useRealTimers(); });

describe('chat keyboard viewport following', () => {
  it('targets the actual virtual-list tail and waits for layout before ending initial alignment', () => {
    const view = setup(); view.resetMessagePosition(); view.chat.hasOlder = true;
    view.presentationRows = Array.from({ length: 200 }, (_, index) => ({ id: String(index) }));
    view.onMessageChange(); vi.advanceTimersByTime(16);
    expect(view.messagesScroller.scrollToIndex).toHaveBeenLastCalledWith(201, false, 'end');
    expect(view.initialScrollPending).toBe(true);
    view.messagesScroller.isAtEnd.mockReturnValue(true); vi.advanceTimersByTime(50);
    expect(view.initialScrollPending).toBe(false);
  });

  it('preserves the reading position when a request targets the selected conversation', () => {
    const view = setup(); view.atBottom = false; view.loadingOlder = true;
    Object.assign(view, { requestedId: 'one', requestRevision: 2, appliedRequestRevision: 1,
      dismissComposer: vi.fn(), olderGeneration: 7 });
    view.onTargetChange();
    expect(view.atBottom).toBe(false); expect(view.loadingOlder).toBe(true);
    expect(view.olderGeneration).toBe(7);
    vi.advanceTimersByTime(50);
    expect(view.messagesScroller.scrollToIndex).not.toHaveBeenCalled();
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

  it('follows the footer after sending from history and continues following the reply', () => {
    const view = setup();
    view.atBottom = false;
    view.saveReadingPosition();
    view.presentationRows = [{ id: 'history' }, { id: 'question' }];
    view.followAfterSend();
    view.messagesScroller.isAtEnd.mockReturnValue(true);
    vi.runAllTimers();
    expect(view.atBottom).toBe(true);
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledExactlyOnceWith(2, false, 'end');

    view.presentationRows.push({ id: 'reply' });
    view.onMessageChange();
    vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).toHaveBeenCalledExactlyOnceWith('bottom');
    expect(view.showJumpBottom).toBe(false);
  });

  it('cancels deferred send alignment when the reader starts dragging', () => {
    const view = setup();
    view.followAfterSend();
    view.onMessageScrollSource('drag');
    view.onMessageScroll(-20, 'scroll');
    vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).not.toHaveBeenCalled();
    expect(view.atBottom).toBe(false);
  });

  it('restores the visible message and offset when returning to a conversation', () => {
    const view = setup();
    view.atBottom = false;
    view.messageHeaderClearance = 84;
    view.messagesScroller.getItemRect.mockReturnValue({ y: 69, height: 75 });
    view.saveReadingPosition();
    view.resetMessagePosition();
    view.onMessageChange();
    vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledExactlyOnceWith(0, false, 'start', { extraOffset: 15 });
    expect(view.atBottom).toBe(false);
  });

  it('corrects late streamed row growth only while following the latest message', () => {
    const view = setup();
    view.onMessageRowLayoutChange('last', { height: 100 }, { height: 500 });
    vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).toHaveBeenCalledOnce();
    view.atBottom = false;
    view.onMessageRowLayoutChange('last', { height: 500 }, { height: 700 });
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
    view.onMessageScroll(-10, 'scroll');
    expect(view.showJumpBottom).toBe(true);
    view.onMessageScroll(10, 'scroll');
    expect(view.showJumpBottom).toBe(true);
    view.messagesScroller.isAtEnd.mockReturnValue(true);
    view.onMessageScroll(10, 'scroll');
    expect(view.showJumpBottom).toBe(false);
  });

  it('follows the bottom after keyboard resize without requiring new messages', () => {
    const view = setup();
    view.onMessageViewportChange({ width: 375, height: 700 }, { width: 375, height: 420 });
    expect(view.messagesScroller.scrollEdge).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledExactlyOnceWith(1, false, 'end');
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
    expect(source).toContain("@Monitor('bottomRegionHeight', 'messageHeaderClearance')");
    expect(source).toContain('.onAreaChange((previous: Area, current: Area): void => { this.onMessageViewportChange(previous, current); })');
    expect(source).toContain(".id('chat-bottom-clearance')");
  });

  it('never animates viewport corrections or holds back streaming behind a keyboard animation', () => {
    const view = setup();
    view.onMessageLayoutChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledExactlyOnceWith(1, false, 'end');
    view.onMessageChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollEdge).toHaveBeenCalledOnce();
  });

  it('ignores a deferred keyboard correction after changing conversations', () => {
    const view = setup();
    view.onMessageLayoutChange(); view.chat.selectedId = 'two'; vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).not.toHaveBeenCalled();
  });

  it('respects reduced motion and includes the older-history header in the target', () => {
    const view = setup(); view.layout.reduceMotion = true;
    view.onMessageLayoutChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledExactlyOnceWith(1, false, 'end');
    view.layout.reduceMotion = false; view.chat.hasOlder = true;
    view.onMessageLayoutChange(); vi.runAllTimers();
    expect(view.messagesScroller.scrollToIndex).toHaveBeenCalledWith(2, false, 'end');
  });
});
