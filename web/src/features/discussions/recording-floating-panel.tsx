import { GripVertical, Maximize2, Minimize2 } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'xopc:recording-window-position:v1';
type Point = { x: number; y: number };
const viewport = () => ({ x: window.visualViewport?.offsetLeft ?? 0, y: window.visualViewport?.offsetTop ?? 0,
  width: window.visualViewport?.width ?? window.innerWidth, height: window.visualViewport?.height ?? window.innerHeight });
export function clampRecordingPosition(point: Point, width: number, height: number): Point {
  const view = viewport();
  return { x: Math.max(view.x + 12,Math.min(point.x,view.x + view.width - width - 12)),
    y: Math.max(view.y + 12,Math.min(point.y,view.y + view.height - height - 12)) };
}
function savedPosition(): Point | null {
  try { const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null;
  } catch { return null; }
}
export function RecordingFloatingPanel({ compact, onCompactChange, title, subtitle, compactActions, children, language }: {
  compact: boolean; onCompactChange: (compact: boolean) => void; title: ReactNode; subtitle?: ReactNode;
  compactActions?: ReactNode; children: ReactNode; language: 'en' | 'zh';
}) {
  const zh = language === 'zh'; const root = useRef<HTMLElement>(null);
  const [position,setPosition] = useState<Point | null>(savedPosition);
  const [moving,setMoving] = useState(false); const [menu,setMenu] = useState(false);
  const [view,setView] = useState(viewport);
  const drag = useRef<{ id: number; start: Point; origin: Point; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  function move(point: Point) {
    const rect = root.current?.getBoundingClientRect(); if (!rect) return;
    const next = clampRecordingPosition(point,rect.width,rect.height); setPosition(next);
    try { sessionStorage.setItem(STORAGE_KEY,JSON.stringify(next)); } catch { /* Position is optional UI state. */ }
  }
  useLayoutEffect(() => {
    const element = root.current; if (!element) return;
    const fit = () => {
      setView(viewport()); const rect = element.getBoundingClientRect();
      setPosition(previous => {
        if (!previous) return previous;
        const next = clampRecordingPosition(previous,rect.width,rect.height);
        return next.x === previous.x && next.y === previous.y ? previous : next;
      });
    };
    fit(); const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(element); window.addEventListener('resize',fit);
    window.visualViewport?.addEventListener('resize',fit); window.visualViewport?.addEventListener('scroll',fit);
    return () => { observer?.disconnect(); window.removeEventListener('resize',fit); window.visualViewport?.removeEventListener('resize',fit); window.visualViewport?.removeEventListener('scroll',fit); };
  },[compact]);
  return <aside ref={root} aria-label={zh ? '录音浮窗' : 'Recording window'} data-recording-window={compact ? 'compact' : 'expanded'}
    className="fixed z-[125] flex flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay text-fg shadow-elevated"
    style={{ width: Math.min(compact ? 340 : 400,view.width - 24),maxHeight: view.height - 24,
      ...(position ? { left: position.x,top: position.y } : { right: 12,bottom: 12 }),cursor: moving ? 'grabbing' : undefined }}>
    <header className={`flex shrink-0 items-center gap-1 ${compact ? 'p-2' : 'border-b border-edge-subtle px-3 py-2'}`}>
      <button type="button" aria-label={zh ? '移动录音窗' : 'Move recording window'} title={zh ? '拖动移动，也可使用方向键或点击选择位置' : 'Drag, use arrow keys, or click to choose a position'}
        aria-expanded={menu} className="flex size-10 shrink-0 touch-none items-center justify-center rounded-lg text-fg-muted outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          const rect = root.current?.getBoundingClientRect(); if (!rect) return;
          drag.current = { id: event.pointerId,start: { x: event.clientX,y: event.clientY },origin: { x: rect.left,y: rect.top },moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={event => {
          const current = drag.current; if (!current || current.id !== event.pointerId) return;
          const dx = event.clientX-current.start.x; const dy = event.clientY-current.start.y;
          if (!current.moved && Math.hypot(dx,dy) < 4) return;
          current.moved = true; setMenu(false); setMoving(true); move({ x: current.origin.x+dx,y: current.origin.y+dy });
        }} onPointerUp={event => {
          const current = drag.current; if (!current || current.id !== event.pointerId) return;
          suppressClick.current = current.moved; drag.current = null; setMoving(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={() => { drag.current = null; suppressClick.current = true; setMoving(false); }}
        onLostPointerCapture={() => { drag.current = null; setMoving(false); }}
        onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } setMenu(value => !value); }}
        onKeyDown={event => {
          const step = event.shiftKey ? 48 : 16; const rect = root.current?.getBoundingClientRect(); if (!rect) return;
          const delta = { ArrowLeft: [-step,0],ArrowRight: [step,0],ArrowUp: [0,-step],ArrowDown: [0,step] }[event.key];
          if (delta) { event.preventDefault(); move({ x: rect.left+delta[0],y: rect.top+delta[1] }); }
          if (event.key === 'Escape') setMenu(false);
          if (event.key === 'Home') { event.preventDefault(); move({ x: view.x+view.width,y: view.y+view.height }); }
        }}><GripVertical className="size-4" aria-hidden /></button>
      <div className="min-w-0 flex-1"><div className={`${compact ? 'text-lg' : 'text-sm'} font-medium tabular-nums`}>{title}</div>{subtitle ? <div className="truncate text-xs text-fg-muted">{subtitle}</div> : null}</div>
      {compact ? compactActions : null}
      <button type="button" aria-label={compact ? (zh ? '展开录音窗' : 'Expand recording window') : (zh ? '缩小录音窗' : 'Minimize recording window')} aria-expanded={!compact}
        className="flex size-10 shrink-0 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        onClick={() => { onCompactChange(!compact); setMenu(false); }}>{compact ? <Maximize2 className="size-4" aria-hidden /> : <Minimize2 className="size-4" aria-hidden />}</button>
    </header>
    {menu ? <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-edge-subtle p-2" aria-label={zh ? '选择浮窗位置' : 'Choose window position'}>
      {[[false,false],[true,false],[false,true],[true,true]].map(([right,bottom],index) => <button key={index} type="button" className="min-h-10 rounded-lg px-3 text-sm hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-accent"
        onClick={() => { move({ x: right ? view.x+view.width : view.x,y: bottom ? view.y+view.height : view.y }); setMenu(false); }}>{(zh ? ['左上角','右上角','左下角','右下角'] : ['Top left','Top right','Bottom left','Bottom right'])[index]}</button>)}
    </div> : null}
    <div className="min-h-0 overflow-y-auto overscroll-contain">{children}</div>
  </aside>;
}
