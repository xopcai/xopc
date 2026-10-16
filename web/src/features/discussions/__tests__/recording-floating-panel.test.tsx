// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecordingFloatingPanel, clampRecordingPosition } from '../recording-floating-panel';
let root: ReturnType<typeof createRoot>; let container: HTMLDivElement;
function Fixture() {
  const [compact,setCompact] = useState(false);
  return <RecordingFloatingPanel compact={compact} onCompactChange={setCompact} title="42:18" subtitle="录音中" language="zh" compactActions={<button>暂停</button>}><p>{compact ? '已保存至 42:15' : '声音输入'}</p></RecordingFloatingPanel>;
}
beforeEach(async () => {
  Object.assign(globalThis,{ IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear();
  Object.defineProperty(window,'innerWidth',{ value: 1200,writable: true }); Object.defineProperty(window,'innerHeight',{ value: 800,writable: true });
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return { x: Number.parseFloat(this.style.left) || 788,y: Number.parseFloat(this.style.top) || 488,left: Number.parseFloat(this.style.left) || 788,top: Number.parseFloat(this.style.top) || 488,width: 400,height: 300,right: 1188,bottom: 788,toJSON: () => ({}) };
  });
  HTMLElement.prototype.setPointerCapture = vi.fn(); HTMLElement.prototype.hasPointerCapture = () => true; HTMLElement.prototype.releasePointerCapture = vi.fn();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container); await act(async () => root.render(<Fixture />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); });
const button = (name: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!;
const pointer = (element: Element,type: string,x: number,y: number) => {
  const event = new Event(type,{ bubbles: true }); Object.assign(event,{ pointerId: 1,isPrimary: true,button: 0,clientX: x,clientY: y }); element.dispatchEvent(event);
};
it('minimizes without closing, preserves essential actions and expands in place', async () => {
  await act(async () => button('缩小录音窗').click());
  expect(container.querySelector('aside')!.dataset.recordingWindow).toBe('compact'); expect(container.textContent).toContain('暂停');
  expect(container.textContent).toContain('已保存至'); await act(async () => button('展开录音窗').click()); expect(container.textContent).toContain('声音输入');
});
it('drags only from the handle, clamps to screen edges and does not open the position menu after a drag', async () => {
  const handle = button('移动录音窗');
  await act(async () => { pointer(handle,'pointerdown',800,500); pointer(handle,'pointermove',-1000,-1000); pointer(handle,'pointerup',-1000,-1000); handle.click(); });
  expect(container.querySelector('aside')!.style.left).toBe('12px'); expect(container.querySelector('aside')!.style.top).toBe('12px');
  expect(container.querySelector('[aria-label="选择浮窗位置"]')).toBeNull();
  await act(async () => { pointer(handle,'pointerdown',12,12); pointer(handle,'pointermove',3000,2000); pointer(handle,'pointerup',3000,2000); });
  expect(container.querySelector('aside')!.style.left).toBe('788px'); expect(container.querySelector('aside')!.style.top).toBe('488px');
});
it('provides tap and keyboard alternatives and reclamps after a viewport shrink', async () => {
  const handle = button('移动录音窗'); await act(async () => handle.click());
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === '左上角')!.click());
  await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown',{ key: 'ArrowRight',bubbles: true })));
  expect(container.querySelector('aside')!.style.left).toBe('28px');
  await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown',{ key: 'Home',bubbles: true })));
  await act(async () => { window.innerWidth = 430; window.innerHeight = 360; window.dispatchEvent(new Event('resize')); });
  expect(container.querySelector('aside')!.style.left).toBe('18px'); expect(container.querySelector('aside')!.style.top).toBe('48px');
});
it('keeps even oversized panels inside the visible origin', () => {
  expect(clampRecordingPosition({ x: -50,y: 5000 },2000,1200)).toEqual({ x: 12,y: 12 });
});
