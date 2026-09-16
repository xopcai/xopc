// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import type { BottomSheetModalProps } from '../BottomSheetModal';

const state = vi.hoisted(() => ({ sheet: {} as BottomSheetModalProps }));
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => createElement('div', null, children),
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => createElement('button', { onClick: onPress }, children),
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('react-native-paper', () => ({
  Icon: () => null,
  Text: ({ children }: { children: ReactNode }) => createElement('span', null, children),
}));
vi.mock('../../theme', async () => {
  const tokens = await import('../../theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.colors.light }) };
});
vi.mock('../../i18n/messages', () => ({ useMessages: () => ({ listInteraction: { multiSelect: 'Select multiple' } }) }));
vi.mock('../BottomSheetModal', () => ({
  BottomSheetModal: (props: BottomSheetModalProps) => {
    state.sheet = props;
    return props.visible ? createElement('div', null, props.children) : null;
  },
}));
import { ListItemMenu } from '../ListItemMenu';
const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (element: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
async function mount(enabled = true) {
  const element = document.createElement('div');
  root = createRoot(element);
  const onActionPress = vi.fn();
  const onSelect = vi.fn();
  await act(async () => root.render(createElement(ListItemMenu, {
    title: 'Note', enabled, onActionPress, onSelect,
    actions: [{ key: 'delete', icon: 'trash-can-outline', label: 'Delete', destructive: true }],
    children: openMenu => createElement('button', { onClick: openMenu }, 'Long press'),
  })));
  const button = (label: string) => [...element.querySelectorAll('button')].find(item => item.textContent === label)!;
  act(() => button('Long press').click());
  return { button, onActionPress, onSelect };
}
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllMocks(); });

it('long press opens a menu without selecting or executing an action', async () => {
  const { onSelect, onActionPress } = await mount();
  expect(state.sheet.visible).toBe(true);
  expect(onSelect).not.toHaveBeenCalled();
  expect(onActionPress).not.toHaveBeenCalled();
});
it('enters multi-select only after choosing it and closing the menu', async () => {
  const { button, onSelect, onActionPress } = await mount();
  act(() => button('Select multiple').click());
  expect(state.sheet.visible).toBe(false);
  expect(onSelect).not.toHaveBeenCalled();
  act(() => state.sheet.onAfterDismiss?.());
  expect(onSelect).toHaveBeenCalledOnce();
  expect(onActionPress).not.toHaveBeenCalled();
});
it('executes a row action exactly once after dismissal', async () => {
  const { button, onActionPress, onSelect } = await mount();
  const remove = button('Delete');
  act(() => { remove.click(); remove.click(); });
  expect(onActionPress).not.toHaveBeenCalled();
  act(() => { state.sheet.onAfterDismiss?.(); state.sheet.onAfterDismiss?.(); });
  expect(onActionPress).toHaveBeenCalledOnce();
  expect(onActionPress.mock.calls[0][0].key).toBe('delete');
  expect(onSelect).not.toHaveBeenCalled();
});
it('dismisses without changing the item when no action was chosen', async () => {
  const { onSelect, onActionPress } = await mount();
  act(() => state.sheet.onDismiss());
  act(() => state.sheet.onAfterDismiss?.());
  expect(onActionPress).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});
it('does not open another menu while selection mode disables it', async () => {
  await mount(false);
  expect(state.sheet.visible).toBe(false);
});
