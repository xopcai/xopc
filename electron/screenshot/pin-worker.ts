import { ipcRenderer } from 'electron';

import type { PinWindowPayload } from './types.js';

function bootPinWindow(): void {
  const frame = document.getElementById('pin-frame') as HTMLDivElement;
  const img = document.getElementById('pin-img') as HTMLImageElement;
  const bar = document.getElementById('pin-bar') as HTMLDivElement;
  const hud = document.getElementById('pin-hud') as HTMLDivElement;

  let state: PinWindowPayload | null = null;
  let zoomPercent = 100;
  let opacityPercent = 100;
  let alwaysOnTop = true;
  let hudTimer: ReturnType<typeof setTimeout> | undefined;
  let dragging: { startScreenX: number; startScreenY: number } | null = null;

  function showHud(text: string): void {
    clearTimeout(hudTimer);
    hud.textContent = text;
    hud.classList.add('visible');
    hudTimer = setTimeout(() => hud.classList.remove('visible'), 1100);
  }

  function renderBar(): void {
    if (!state) return;
    const zh = state.language === 'zh';
    bar.innerHTML = `
      <button type="button" id="pin-top-btn" class="pin-btn" title="${zh ? '切换置顶' : 'Toggle Always on Top'}">${alwaysOnTop ? '📌' : '📍'}</button>
      <button type="button" id="pin-copy-btn" class="pin-btn" title="${zh ? '复制图片 (⌘/Ctrl+C)' : 'Copy (⌘/Ctrl+C)'}">${zh ? '复制' : 'Copy'}</button>
      <button type="button" id="pin-save-btn" class="pin-btn" title="${zh ? '保存图片 (⌘/Ctrl+S)' : 'Save (⌘/Ctrl+S)'}">${zh ? '保存' : 'Save'}</button>
      <button type="button" id="pin-chat-btn" class="pin-btn" title="${zh ? '发到对话' : 'Send to Chat'}">${zh ? '对话' : 'Chat'}</button>
      <button type="button" id="pin-close-btn" class="pin-btn danger" title="${zh ? '关闭贴图 (Esc / 双击)' : 'Close (Esc / Double-click)'}">✕</button>
    `;

    for (const btn of bar.querySelectorAll('button')) {
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
    }

    bar.querySelector('#pin-top-btn')?.addEventListener('click', async () => {
      if (!state) return;
      alwaysOnTop = !alwaysOnTop;
      await ipcRenderer.invoke('screenshot-pin:action', {
        pinId: state.pinId,
        action: 'set-always-on-top',
        alwaysOnTop,
      });
      renderBar();
      showHud(alwaysOnTop ? (zh ? '已置顶' : 'Pinned on top') : zh ? '取消置顶' : 'Unpinned');
    });

    bar.querySelector('#pin-copy-btn')?.addEventListener('click', async () => {
      if (!state) return;
      await ipcRenderer.invoke('screenshot-pin:action', { pinId: state.pinId, action: 'copy' });
      showHud(zh ? '已复制' : 'Copied');
    });

    bar.querySelector('#pin-save-btn')?.addEventListener('click', () => {
      if (!state) return;
      void ipcRenderer.invoke('screenshot-pin:action', { pinId: state.pinId, action: 'save' });
    });

    bar.querySelector('#pin-chat-btn')?.addEventListener('click', () => {
      if (!state) return;
      void ipcRenderer.invoke('screenshot-pin:action', { pinId: state.pinId, action: 'chat' });
    });

    bar.querySelector('#pin-close-btn')?.addEventListener('click', () => {
      if (!state) return;
      void ipcRenderer.invoke('screenshot-pin:action', { pinId: state.pinId, action: 'close' });
    });
  }

  frame.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || !state) return;
    dragging = { startScreenX: e.screenX, startScreenY: e.screenY };
    ipcRenderer.send('screenshot-pin:drag-start', {
      pinId: state.pinId,
      screenX: e.screenX,
      screenY: e.screenY,
    });
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging || !state) return;
    ipcRenderer.send('screenshot-pin:drag-move', {
      pinId: state.pinId,
      screenX: e.screenX,
      screenY: e.screenY,
    });
  });

  window.addEventListener('mouseup', () => {
    if (!dragging || !state) return;
    dragging = null;
    ipcRenderer.send('screenshot-pin:drag-end', { pinId: state.pinId });
  });

  frame.addEventListener('dblclick', () => {
    if (!state) return;
    void ipcRenderer.invoke('screenshot-pin:action', { pinId: state.pinId, action: 'close' });
  });

  frame.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!state) return;
    void ipcRenderer.invoke('screenshot-pin:action', { pinId: state.pinId, action: 'context-menu' });
  });

  frame.addEventListener(
    'wheel',
    (e) => {
      if (!state) return;
      e.preventDefault();
      if (e.altKey || e.shiftKey) {
        const step = e.deltaY < 0 ? 8 : -8;
        opacityPercent = Math.max(20, Math.min(100, opacityPercent + step));
        void ipcRenderer.invoke('screenshot-pin:action', {
          pinId: state.pinId,
          action: 'set-opacity',
          opacity: opacityPercent / 100,
        });
        showHud(`${state.language === 'zh' ? '透明度' : 'Opacity'} ${opacityPercent}%`);
      } else {
        const step = e.deltaY < 0 ? 10 : -10;
        zoomPercent = Math.max(25, Math.min(400, zoomPercent + step));
        void ipcRenderer.invoke('screenshot-pin:action', {
          pinId: state.pinId,
          action: 'set-zoom',
          zoom: zoomPercent / 100,
        });
        showHud(`${zoomPercent}%`);
      }
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (!state) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      void ipcRenderer.invoke('screenshot-pin:action', { pinId: state.pinId, action: 'close' });
    } else if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      void ipcRenderer.invoke('screenshot-pin:action', { pinId: state.pinId, action: 'copy' });
      showHud(state.language === 'zh' ? '已复制' : 'Copied');
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void ipcRenderer.invoke('screenshot-pin:action', { pinId: state.pinId, action: 'save' });
    } else if (e.key === '[' || e.key === ']') {
      opacityPercent = Math.max(20, Math.min(100, opacityPercent + (e.key === ']' ? 10 : -10)));
      void ipcRenderer.invoke('screenshot-pin:action', {
        pinId: state.pinId,
        action: 'set-opacity',
        opacity: opacityPercent / 100,
      });
      showHud(`${state.language === 'zh' ? '透明度' : 'Opacity'} ${opacityPercent}%`);
    }
  });

  ipcRenderer.on('screenshot-pin:init', (_event, payload: PinWindowPayload) => {
    state = payload;
    alwaysOnTop = payload.alwaysOnTop;
    opacityPercent = Math.round(payload.opacity * 100);
    zoomPercent = 100;
    img.src = `data:image/png;base64,${payload.pngBase64}`;
    renderBar();
  });
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootPinWindow, { once: true });
} else {
  bootPinWindow();
}
