// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { act, createElement, type ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

const keyboard = vi.hoisted(() => ({
  height: 0,
  handlers: {} as Record<string, (event: { height: number }) => void>,
  bridge: vi.fn((callback: (height: number) => void, height: number) => callback(height)),
}));
vi.mock('react-native-keyboard-controller', () => ({
  KeyboardController: { state: () => ({ height: keyboard.height }) },
  useKeyboardHandler: (handlers: typeof keyboard.handlers) => { keyboard.handlers = handlers; },
}));
vi.mock('react-native-worklets', () => ({ scheduleOnRN: keyboard.bridge }));
import { useKeyboardListPadding } from '../use-keyboard-list-padding';

const { createRoot } = createRequire(import.meta.url)('react-dom/client') as {
  createRoot: (container: HTMLElement) => { render: (node: ReactNode) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let padding = 0;
function Harness() { padding = useKeyboardListPadding(); return null; }
afterEach(() => { act(() => root.unmount()); keyboard.bridge.mockClear(); });

it('reserves opening space once and keeps it until interactive dismissal completes', () => {
  root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Harness)));
  act(() => keyboard.handlers.onStart({ height: 320 }));
  expect(padding).toBe(320);
  for (let height = 0; height < 320; height += 10) {
    act(() => keyboard.handlers.onMove?.({ height }));
  }
  expect(keyboard.bridge).toHaveBeenCalledTimes(1);
  act(() => keyboard.handlers.onEnd({ height: 320 }));
  act(() => keyboard.handlers.onStart({ height: 0 }));
  for (let height = 320; height > 0; height -= 10) {
    act(() => keyboard.handlers.onInteractive?.({ height }));
  }
  expect(padding).toBe(320);
  act(() => keyboard.handlers.onEnd({ height: 0 }));
  expect(padding).toBe(0);
  expect(keyboard.bridge).toHaveBeenCalledTimes(3);
});

it('initializes from an already visible keyboard and handles a cancelled dismissal', () => {
  keyboard.height = 280;
  root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Harness)));
  expect(padding).toBe(280);
  act(() => keyboard.handlers.onStart({ height: 0 }));
  act(() => keyboard.handlers.onEnd({ height: 280 }));
  expect(padding).toBe(280);
  keyboard.height = 0;
});
