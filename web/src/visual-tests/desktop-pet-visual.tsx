import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import { loopiDesktopPet } from '../../../electron/desktop-pet/loopi';

import { DesktopPetSprite } from '@/features/desktop-pet/desktop-pet-sprite';
import type { DesktopPetAction } from '@/types/electron';
import '@/styles/globals.css';

const states: { action: DesktopPetAction; title: string }[] = [
  { action: 'idle', title: '待机' },
  { action: 'execute', title: '工作' },
  { action: 'wait', title: '等你确认' },
  { action: 'success', title: '完成' },
];

function DesktopPetVisual() {
  const [replay, setReplay] = useState(0);
  const [reduced, setReduced] = useState(false);
  return <main className="min-h-screen bg-surface-base p-8 text-fg">
    <h1 className="mb-3 text-2xl">Loopi · 正式桌宠渲染器</h1>
    <div className="mb-8 flex gap-4">
      <button className="rounded-lg border border-edge px-3 py-2" onClick={() => setReplay((value) => value + 1)}>重播完成动作</button>
      <label className="flex items-center gap-2"><input type="checkbox" checked={reduced} onChange={(event) => setReduced(event.target.checked)} />减少动态</label>
    </div>
    <div className="grid gap-5 md:grid-cols-4">
      {states.map(({ action, title }) => <section key={action} className="rounded-2xl border border-edge bg-surface-panel p-4">
        <h2 className="mb-4 text-sm">{title}</h2>
        <div className="flex justify-center"><DesktopPetSprite key={action === 'success' ? replay : action} pet={loopiDesktopPet} action={action} displayHeight={240} reducedMotion={reduced} /></div>
        <div className="mt-4 flex justify-center rounded-xl bg-slate-800 p-3"><DesktopPetSprite key={`${action}:${replay}`} pet={loopiDesktopPet} action={action} reducedMotion={reduced} /></div>
        <p className="mt-3 text-center text-xs text-fg-muted">桌面尺寸 112 px</p>
      </section>)}
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<DesktopPetVisual />);
