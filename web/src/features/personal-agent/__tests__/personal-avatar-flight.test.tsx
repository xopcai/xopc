// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PrimaryAppHeader } from '@/components/shell/primary-app-header';
import {
  beginPersonalAvatarFlight,
  buildPersonalAvatarFlightKeyframes,
  cancelPersonalAvatarFlight,
  measureRestingAvatarRect,
  usePersonalAvatarFlightStore,
} from '@/features/personal-agent/personal-avatar-flight';
import { PersonalPage } from '@/features/personal-agent/personal-page';
import { PersonalTaskPanel } from '@/features/personal-agent/personal-task-panel';
import { RightWorkspace } from '@/features/right-workspace/right-workspace';
import { fetchJson } from '@/lib/fetch';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { PERSONAL_TASKS_TAB_ID, useRightWorkspaceStore } from '@/stores/right-workspace-store';

vi.mock('@/features/chat/chat-page', () => ({
  ChatPage: () => <div data-testid="personal-chat" />,
}));
vi.mock('@/features/voice/realtime/voice-call-context', () => ({
  useVoiceCall: () => ({ active: false, expanded: false, open: vi.fn(), minimize: vi.fn(), setMiniAnchor: vi.fn() }),
}));
vi.mock('@/features/personal-agent/personal-avatar', () => ({
  PersonalAvatar: ({ appearance, lively, className }: { appearance: string; lively?: boolean; className?: string }) => (
    <span data-testid="personal-avatar" data-appearance={appearance} data-lively={lively ? 'true' : undefined} className={className} />
  ),
}));
vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));

function TaskPanelHost() {
  const pane = useRightWorkspaceStore(state => state.panes['conversation-1']);
  return pane?.open && pane.activeId === PERSONAL_TASKS_TAB_ID
    ? <aside data-testid="task-panel-aside"><PersonalTaskPanel scope="conversation-1" zh={false} /></aside>
    : null;
}

describe('Personal avatar shared-element flight', () => {
  let container: HTMLDivElement;
  let headerContainer: HTMLDivElement;
  let root: Root;
  let headerRoot: Root;
  let reducedMotion = false;
  let finishAnimations: Array<() => void>;
  const cancelAnimation = vi.fn();
  const animateMock = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    reducedMotion = false;
    finishAnimations = [];
    cancelPersonalAvatarFlight();
    useRightWorkspaceStore.getState().reset();
    vi.stubGlobal('matchMedia', () => ({
      matches: reducedMotion,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    animateMock.mockImplementation(() => ({
      finished: new Promise<void>(resolve => { finishAnimations.push(resolve); }),
      cancel: cancelAnimation,
      playState: 'running',
    }));
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animateMock });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const anchor = this.getAttribute('data-personal-avatar-anchor');
      if (anchor === 'header') return DOMRect.fromRect({ x: 360, y: 24, width: 80, height: 80 });
      if (anchor === 'panel') return DOMRect.fromRect({ x: 920, y: 68, width: 128, height: 128 });
      if (this.hasAttribute('data-personal-avatar-flight-node')) return DOMRect.fromRect({ x: 640, y: 36, width: 104, height: 104 });
      return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    });
    vi.mocked(fetchJson).mockImplementation(async (url) => {
      if (String(url).includes('/activity')) return { ok: true, payload: { items: [], total: 0, current: [] } };
      if (String(url).includes('/clarification')) return { ok: true, payload: { clarification: null } };
      if (String(url).includes('/models')) return { ok: true, payload: [] };
      if (String(url).includes('/schedules')) return { ok: true, payload: [] };
      return {
        ok: true,
        payload: {
          agentId: 'personal',
          conversationId: 'conversation-1',
          state: 'ready',
          displayName: 'Ada',
          appearance: 'loopi',
          revision: 1,
          errorMessage: null,
        },
      };
    });
    container = document.createElement('div');
    headerContainer = document.createElement('div');
    document.body.append(container, headerContainer);
    root = createRoot(container);
    headerRoot = createRoot(headerContainer);
  });

  afterEach(() => {
    cancelPersonalAvatarFlight();
    act(() => {
      root.unmount();
      headerRoot.unmount();
    });
    container.remove();
    headerContainer.remove();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('builds a curved arc + spring settle trajectory from header to right panel', () => {
    const { keyframes, duration, baseSize } = buildPersonalAvatarFlightKeyframes(
      { left: 360, top: 24, width: 80, height: 80 },
      { left: 920, top: 68, width: 128, height: 128 },
      'panel',
    );
    expect(baseSize).toBe(128);
    expect(duration).toBeGreaterThanOrEqual(300);
    expect(keyframes[0].transform).toContain('scale(0.6250, 0.6250)');
    expect(keyframes.at(-1)?.transform).toBe('translate3d(0px, 0px, 0) scale(1.0000, 1.0000) rotate(0deg)');
    const midTransform = String(keyframes[Math.floor(keyframes.length / 2)].transform);
    expect(midTransform).toContain('rotate(');
    expect(midTransform).not.toContain('rotate(0.00deg)');
  });

  it('removes ancestor entrance translate offset when measuring resting rect', () => {
    const aside = document.createElement('aside');
    const avatar = document.createElement('div');
    avatar.setAttribute('data-personal-avatar-anchor', 'panel');
    aside.append(avatar);
    document.body.append(aside);
    const computedSpy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el) => ({
      transform: el === aside ? 'matrix(1, 0, 0, 1, 28, 0)' : 'none',
    } as CSSStyleDeclaration));

    const resting = measureRestingAvatarRect(avatar);
    expect(resting).toEqual({ left: 892, top: 68, width: 128, height: 128 });
    computedSpy.mockRestore();
    aside.remove();
  });

  it('smoothly flies the avatar from the top header to the right panel and back on close', async () => {
    await act(async () => root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter initialEntries={['/personal']}>
          <PersonalPage />
          <TaskPanelHost />
        </MemoryRouter>
      </SWRConfig>,
    ));
    const renderHeader = () => act(() => headerRoot.render(usePageHeaderStore.getState().main));
    renderHeader();

    const trigger = headerContainer.querySelector<HTMLButtonElement>('[data-personal-tasks-trigger]');
    expect(trigger).not.toBeNull();

    await act(async () => trigger!.click());
    renderHeader();

    const overlay = document.body.querySelector('[data-personal-avatar-flight]');
    expect(overlay?.getAttribute('data-flight-direction')).toBe('to-panel');
    expect(container.querySelector('[data-personal-avatar-anchor="panel"]')?.getAttribute('data-avatar-flight-hidden')).toBe('true');
    expect(animateMock).toHaveBeenCalled();

    // Finish open flight: overlay clears, destination avatar reveals & marks landed.
    await act(async () => { finishAnimations.forEach(done => done()); finishAnimations = []; });
    expect(document.body.querySelector('[data-personal-avatar-flight]')).toBeNull();
    expect(container.querySelector('[data-personal-avatar-anchor="panel"]')?.hasAttribute('data-avatar-flight-hidden')).toBe(false);
    expect(container.querySelector('[data-personal-avatar-anchor="panel"]')?.getAttribute('data-avatar-landed')).toBe('true');

    // Close panel: avatar flies back from panel to top header.
    await act(async () => {
      beginPersonalAvatarFlight('panel', 'header');
      useRightWorkspaceStore.getState().setOpen(false, 'conversation-1');
    });
    renderHeader();

    const returnOverlay = document.body.querySelector('[data-personal-avatar-flight]');
    expect(returnOverlay?.getAttribute('data-flight-direction')).toBe('to-header');
    expect(headerContainer.querySelector('[data-personal-avatar-anchor="header"]')?.getAttribute('data-avatar-flight-hidden')).toBe('true');

    await act(async () => { finishAnimations.forEach(done => done()); finishAnimations = []; });
    expect(document.body.querySelector('[data-personal-avatar-flight]')).toBeNull();
    expect(headerContainer.querySelector('[data-personal-avatar-anchor="header"]')?.hasAttribute('data-avatar-flight-hidden')).toBe(false);
  });

  it('reverses from the live mid-air overlay position when interrupted', async () => {
    await act(async () => root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter initialEntries={['/personal']}>
          <PersonalPage />
          <TaskPanelHost />
        </MemoryRouter>
      </SWRConfig>,
    ));
    const renderHeader = () => act(() => headerRoot.render(usePageHeaderStore.getState().main));
    renderHeader();

    await act(async () => headerContainer.querySelector<HTMLButtonElement>('[data-personal-tasks-trigger]')!.click());
    renderHeader();
    expect(usePersonalAvatarFlightStore.getState().active?.to).toBe('panel');

    // Immediately reverse before the first animation completes.
    await act(async () => {
      beginPersonalAvatarFlight('panel', 'header');
      useRightWorkspaceStore.getState().setOpen(false, 'conversation-1');
    });
    renderHeader();

    const reversed = usePersonalAvatarFlightStore.getState().active;
    expect(reversed?.to).toBe('header');
    expect(reversed?.sourceRect).toEqual({ left: 640, top: 36, width: 104, height: 104 });
    expect(cancelAnimation).toHaveBeenCalled();
  });

  it('flies avatar back to PrimaryAppHeader when clicking close in the real RightWorkspace', async () => {
    await act(async () => root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter initialEntries={['/personal']}>
          <div className="flex flex-row">
            <div data-app-chat-shell="">
              <PrimaryAppHeader />
              <PersonalPage />
            </div>
            <RightWorkspace scope="conversation-1" enabled />
          </div>
        </MemoryRouter>
      </SWRConfig>,
    ));

    const trigger = container.querySelector<HTMLButtonElement>('[data-personal-tasks-trigger]');
    expect(trigger).not.toBeNull();

    // Open right panel from top header
    await act(async () => trigger!.click());
    expect(document.body.querySelector('[data-personal-avatar-flight]')?.getAttribute('data-flight-direction')).toBe('to-panel');

    // Finish open flight + panel open animation
    await act(async () => { finishAnimations.forEach(done => done()); finishAnimations = []; });
    expect(document.body.querySelector('[data-personal-avatar-flight]')).toBeNull();

    // Click the real close button inside RightWorkspace
    const closeBtn = container.querySelector<HTMLButtonElement>('[data-personal-task-close]');
    expect(closeBtn).not.toBeNull();
    await act(async () => closeBtn!.click());

    const returnOverlay = document.body.querySelector('[data-personal-avatar-flight]');
    expect(returnOverlay?.getAttribute('data-flight-direction')).toBe('to-header');
    expect(container.querySelector('[data-personal-avatar-anchor="header"]')?.getAttribute('data-avatar-flight-hidden')).toBe('true');

    await act(async () => { finishAnimations.forEach(done => done()); finishAnimations = []; });
    expect(document.body.querySelector('[data-personal-avatar-flight]')).toBeNull();
    expect(container.querySelector('[data-personal-avatar-anchor="header"]')?.hasAttribute('data-avatar-flight-hidden')).toBe(false);

    // Re-open and close via store.remove (e.g. closing tab X or browser back) — still flies back!
    await act(async () => container.querySelector<HTMLButtonElement>('[data-personal-tasks-trigger]')!.click());
    await act(async () => { finishAnimations.forEach(done => done()); finishAnimations = []; });
    await act(async () => useRightWorkspaceStore.getState().remove(PERSONAL_TASKS_TAB_ID, 'conversation-1'));
    expect(document.body.querySelector('[data-personal-avatar-flight]')?.getAttribute('data-flight-direction')).toBe('to-header');
    await act(async () => { finishAnimations.forEach(done => done()); finishAnimations = []; });
    expect(document.body.querySelector('[data-personal-avatar-flight]')).toBeNull();
  });

  it('skips the flight animation when prefers-reduced-motion is enabled', async () => {
    reducedMotion = true;
    await act(async () => root.render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <MemoryRouter initialEntries={['/personal']}>
          <PersonalPage />
          <TaskPanelHost />
        </MemoryRouter>
      </SWRConfig>,
    ));
    const renderHeader = () => act(() => headerRoot.render(usePageHeaderStore.getState().main));
    renderHeader();

    await act(async () => headerContainer.querySelector<HTMLButtonElement>('[data-personal-tasks-trigger]')!.click());
    renderHeader();

    expect(document.body.querySelector('[data-personal-avatar-flight]')).toBeNull();
    expect(container.querySelector('[data-personal-avatar-anchor="panel"]')?.hasAttribute('data-avatar-flight-hidden')).toBe(false);
    expect(animateMock).not.toHaveBeenCalled();
  });
});
