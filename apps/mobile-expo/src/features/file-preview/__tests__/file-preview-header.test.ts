// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import type { BottomSheetModalProps } from '../../../components/BottomSheetModal';

const state = vi.hoisted(() => ({ sheet: {} as BottomSheetModalProps }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Pressable: ({ children, onPress, disabled }: { children: ReactNode; onPress: () => void; disabled: boolean }) =>
    createElement('button', { onClick: onPress, disabled }, children),
  StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
}));
vi.mock('react-native-paper', () => ({
  Icon: () => null,
  IconButton: ({ onPress, accessibilityLabel }: { onPress: () => void; accessibilityLabel: string }) =>
    createElement('button', { onClick: onPress }, accessibilityLabel),
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}));
vi.mock('../../../theme', async () => {
  const tokens = await import('../../../theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.colors.light }) };
});
vi.mock('../../../components/BottomSheetModal', () => ({
  BottomSheetModal: (props: BottomSheetModalProps) => {
    state.sheet = props;
    return props.visible ? createElement('div', null, props.children) : null;
  },
}));

import { FilePreviewHeader } from '../FilePreviewHeader';

const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (element: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
async function mount(disabled = false) {
  const element = document.createElement('div');
  root = createRoot(element);
  const onPress = vi.fn();
  await act(async () => root.render(createElement(FilePreviewHeader, {
    title: 'Document', onClose: vi.fn(), closeLabel: 'Close', shareLabel: 'Share', moreActionsLabel: 'More',
    moreActions: [{ key: 'open', label: 'Open in chat', icon: 'chat', onPress, disabled }],
  })));
  act(() => [...element.querySelectorAll('button')].find((button) => button.textContent === 'More')!.click());
  return { onPress, button: [...element.querySelectorAll('button')].find((button) => button.textContent === 'Open in chat')! };
}
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks(); });

it('waits for native dismissal before opening another surface, and runs only once', async () => {
  const { onPress, button } = await mount();
  act(() => { button.click(); button.click(); });
  expect(state.sheet.visible).toBe(false);
  expect(onPress).not.toHaveBeenCalled();
  act(() => { state.sheet.onAfterDismiss?.(); state.sheet.onAfterDismiss?.(); });
  expect(onPress).toHaveBeenCalledOnce();
});

it('does not execute an action when the sheet is dismissed without selecting one', async () => {
  const { onPress } = await mount();
  act(() => state.sheet.onDismiss());
  act(() => state.sheet.onAfterDismiss?.());
  expect(onPress).not.toHaveBeenCalled();
});

it('keeps disabled actions inert', async () => {
  const { onPress, button } = await mount(true);
  act(() => button.click());
  expect(state.sheet.visible).toBe(true);
  expect(onPress).not.toHaveBeenCalled();
});
