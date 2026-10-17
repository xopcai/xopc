// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../agent-avatar-display', () => ({
  AgentAvatarDisplay: ({ avatar }: { avatar?: string }) => <span data-avatar={avatar ?? ''} />,
}));

import { AgentAvatarField, type PendingAgentAvatar } from '../agent-avatar-field';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();
const onPendingChange = vi.fn();
const onReadingChange = vi.fn();
beforeEach(() => {
  onChange.mockClear();
  onPendingChange.mockClear();
  onReadingChange.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(avatar: string, pending: PendingAgentAvatar | null = null) {
  await act(async () => root.render(<AgentAvatarField agentId="ada" avatar={avatar} zh pending={pending}
    onPendingChange={onPendingChange} onReadingChange={onReadingChange} onChange={onChange} />));
}
async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(node => node.textContent?.trim() === label)!;
  await act(async () => button.click());
}
async function chooseFile(file: File) {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 20));
  });
}

it('preserves stored avatars until the user explicitly chooses a replacement', async () => {
  await render('xopc:custom');
  await click('默认头像');
  expect(onChange).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('xopc:custom');
  await click('Loopi · 温暖');
  expect(onChange).toHaveBeenCalledWith('xopc:loopi:care');
});

it('keeps an existing Loopi selected without exposing its storage identifier', async () => {
  await render('xopc:loopi:care');
  await click('默认头像');
  expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toContain('Loopi · 温暖');
  expect(container.textContent).not.toContain('xopc:loopi:care');
  await click('自动头像');
  expect(onChange).toHaveBeenCalledWith('');
});

it('opens the local file chooser when clicking the avatar', async () => {
  await render('xopc:loopi:care');
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const open = vi.spyOn(input, 'click');
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="上传头像"]')!.click());
  expect(open).toHaveBeenCalledOnce();
  expect(container.querySelector('input[type="url"]')).toBeNull();
});

it('rejects unsupported or oversized images without changing the avatar', async () => {
  await render('xopc:loopi:care');
  await chooseFile(new File(['image'], 'avatar.svg', { type: 'image/svg+xml' }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('PNG');
  await chooseFile(new File([new Uint8Array(512 * 1024 + 1)], 'avatar.png', { type: 'image/png' }));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('512 KB');
  expect(onChange).not.toHaveBeenCalled();
  expect(onPendingChange).not.toHaveBeenCalled();
});

it('stages a local preview for saving and clears the upload when selecting a built-in avatar', async () => {
  await render('xopc:custom');
  await chooseFile(new File(['image'], 'avatar.png', { type: 'image/png' }));
  const pending = onPendingChange.mock.calls[0][0] as PendingAgentAvatar;
  expect(pending).toMatchObject({ base64: 'aW1hZ2U=', mimeType: 'image/png' });
  expect(onChange).toHaveBeenCalledWith('xopc:custom');
  expect(onReadingChange.mock.calls.map(call => call[0])).toEqual([true, false]);
  await render('xopc:custom', pending);
  expect(container.querySelector('img')?.getAttribute('src')).toBe(pending.preview);
  expect(container.textContent).toContain('保存后生效');
  await click('默认头像');
  await click('自动头像');
  expect(onPendingChange).toHaveBeenLastCalledWith(null);
});
