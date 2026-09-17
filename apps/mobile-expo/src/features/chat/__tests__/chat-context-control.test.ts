// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ unavailable: false }));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({}),
  useQuery: ({ queryKey: key }: { queryKey: string[] }) => ({ data:
    key[2] === 'context' ? { work: { project: { id: 'a', title: 'Project A' } }, environment: { kind: 'local_checkout' }, sources: [] }
      : key[2] === 'environment-options' ? { localAvailable: true, worktreeUnavailableReason: state.unavailable ? 'git_commit_required' : null }
        : key[0] === 'projects' ? [{ id: 'a', name: 'Project A' }, { id: 'b', name: 'Project B' }] : {},
  }),
}));
vi.mock('../../../query/projects', () => ({ fetchProjects: vi.fn(), fetchProjectEnvironmentOptions: vi.fn() }));
vi.mock('../../../query/sessions', () => ({ fetchSessionContextSummary: vi.fn() }));
vi.mock('../../../query/models', () => ({ fetchSessionAgentConfig: vi.fn(), setSessionWorkingDirectory: vi.fn() }));
vi.mock('../../../query/host-fs', () => ({ fetchHostDirectories: vi.fn() }));
vi.mock('../../../components/BottomSheetModal', () => ({ BottomSheetModal: ({ visible }: { visible: boolean }) => visible ? createElement('div', { 'data-detail': true }) : null }));
vi.mock('../StaticLoadingIndicator', () => ({ StaticLoadingIndicator: () => null }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Pressable: ({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress: () => void; accessibilityLabel?: string }) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
  StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 },
}));
vi.mock('react-native-paper', () => ({
  Icon: () => null, Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
  Menu: Object.assign(({ anchor, visible, children }: { anchor: ReactNode; visible: boolean; children: ReactNode }) => createElement('div', null, anchor, visible ? children : null), {
    Item: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => createElement('button', { onClick: onPress, disabled }, title),
  }),
}));
vi.mock('../../../theme', async () => {
  const tokens = await import('../../../theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.colors.light }) };
});
vi.mock('../../../i18n/messages', () => ({ useMessages: () => ({ common: {}, chat: { contextCenter: { chooseProject: 'Choose project', chooseEnvironment: 'Environment', open: 'Open context', environmentReason: {} } } }) }));
import { ChatContextControl } from '../ChatContextControl';
const { createRoot } = createRequire(import.meta.url)('react-dom/client') as { createRoot: (element: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void } };
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLElement;
const change = vi.fn();
const click = (label: string) => act(() => {
  const button = Array.from(container.querySelectorAll('button')).find(node => node.getAttribute('aria-label') === label || node.textContent === label);
  expect(button).toBeDefined();
  button!.click();
});
beforeEach(() => {
  state.unavailable = false; change.mockClear();
  container = document.createElement('div'); root = createRoot(container);
  act(() => root.render(createElement(ChatContextControl, { conversationId: 'c', draftRefs: [], onRemoveDraftRef: vi.fn(), onAddSource: vi.fn(), onChangeScope: change })));
});
afterEach(() => act(() => root.unmount()));
it('selects a project directly without opening the context detail sheet', () => {
  click('Choose project: Project A'); click('Project B');
  expect(change).toHaveBeenCalledWith('b', undefined);
  expect(container.querySelector('[data-detail]')).toBeNull();
});
it('selects the environment directly and ignores selecting the current environment', () => {
  click('Environment: Local'); click('Local');
  expect(change).not.toHaveBeenCalled();
  click('Environment: Local'); click('Worktree');
  expect(change).toHaveBeenCalledWith('a', 'managed_worktree');
});
it('does not switch into an unavailable Worktree', () => {
  state.unavailable = true;
  click('Environment: Local'); click('Worktree');
  expect(change).not.toHaveBeenCalled();
});
it('keeps the full context available behind the compact details action', () => {
  click('Open context');
  expect(container.querySelector('[data-detail]')).not.toBeNull();
});
