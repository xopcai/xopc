import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { BrowserWindow, desktopCapturer, dialog, screen, session, systemPreferences, type NativeImage } from 'electron';
import { SCREEN_CAPTURE_MAX_BYTES } from '@xopcai/endpoint-tools-protocol';

import type { DesktopBinding } from './device-identity.js';

export interface DesktopScreenSession {
  foreground(): boolean;
  confirm(signal: AbortSignal): Promise<boolean>;
  capture(signal: AbortSignal): Promise<Buffer>;
}

function png(image: NativeImage): Buffer {
  const { width, height } = image.getSize();
  if (!width || !height) throw new Error('DESKTOP_SCREEN_CAPTURE_FAILED');
  const scale = Math.min(1, 1280 / width, 1280 / height, Math.sqrt(1000000 / (width * height)));
  const bytes = (scale < 1 ? image.resize({ width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }) : image).toPNG();
  if (bytes.length > SCREEN_CAPTURE_MAX_BYTES) { bytes.fill(0); throw new Error('DESKTOP_SCREEN_IMAGE_LIMIT'); }
  return bytes;
}

/** Captures one chosen display through an isolated, media-only private session. */
async function displayFrame(displayId: number, assets: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') throw new Error('DESKTOP_SCREEN_PERMISSION_REQUIRED');
  if (!screen.getAllDisplays().some(display => display.id === displayId)) throw new Error('DESKTOP_SCREEN_SOURCE_CHANGED');
  // Enumerate metadata without reading pixels from any unselected source.
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  signal.throwIfAborted();
  const source = sources.find(source => source.display_id === String(displayId));
  if (!source || !/^screen:[0-9:-]+$/.test(source.id)) throw new Error('DESKTOP_SCREEN_SOURCE_CHANGED');
  const isolated = session.fromPartition(`desktop-capture-${randomUUID()}`);
  const document = pathToFileURL(join(assets, 'screen-capture.html')).href;
  const window = new BrowserWindow({ show: false, width: 16, height: 16, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, backgroundThrottling: false } });
  const trusted = (contents: Electron.WebContents | null, permission: string) => !window.isDestroyed() && contents === window.webContents
    && permission === 'display-capture' && window.webContents.getURL() === document && window.webContents.mainFrame.url === document;
  isolated.setPermissionCheckHandler((contents, permission) => trusted(contents, permission));
  isolated.setPermissionRequestHandler((contents, permission, done, details) => done(trusted(contents, permission)
    && 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'video'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const stop = () => { if (!window.isDestroyed()) window.destroy(); };
  const timeout = setTimeout(stop, 5000); signal.addEventListener('abort', stop, { once: true });
  try {
    await window.loadURL(document); signal.throwIfAborted();
    // The only interpolated value is a locally selected, validated Chromium source id.
    const encoded = await window.webContents.executeJavaScript(`(async () => {
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
          chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(source.id)}, maxWidth: 1280, maxHeight: 1280, maxFrameRate: 1 } } });
        const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
        await new Promise(resolve => video.requestVideoFrameCallback(resolve));
        const scale = Math.min(1, 1280 / video.videoWidth, 1280 / video.videoHeight, Math.sqrt(1000000 / (video.videoWidth * video.videoHeight)));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.floor(video.videoWidth * scale)); canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height); return canvas.toDataURL('image/png');
      } finally { stream?.getTracks().forEach(track => track.stop()); }
    })()`, false);
    signal.throwIfAborted();
    if (typeof encoded !== 'string' || !encoded.startsWith('data:image/png;base64,') || encoded.length > SCREEN_CAPTURE_MAX_BYTES * 1.4) throw new Error('DESKTOP_SCREEN_IMAGE_LIMIT');
    return Buffer.from(encoded.slice(22), 'base64');
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', stop); stop(); await isolated.clearStorageData().catch(() => {}); }
}

export async function selectDesktopScreenSession(options: {
  binding: DesktopBinding; parent: BrowserWindow; chat?: BrowserWindow; assets: string; signal: AbortSignal;
}): Promise<DesktopScreenSession | undefined> {
  const { parent, chat, binding, signal } = options;
  const displays = screen.getAllDisplays().slice(0, 8);
  const choices: Array<{ title: string; displayId?: number; chat?: BrowserWindow; url?: string }> = [
    ...(chat && !chat.isDestroyed() ? [{ title: '当前远端聊天窗口', chat, url: chat.webContents.getURL() }] : []),
    ...displays.map((display, index) => ({ title: `显示器 ${index + 1}（${display.size.width} × ${display.size.height}）`, displayId: display.id })),
  ];
  if (parent.isDestroyed() || signal.aborted) return;
  const choice = await dialog.showMessageBox(parent, { type: 'question', title: '选择截图来源', message: '授权哪个来源供此Gateway请求截图？',
    detail: `Gateway：${binding.origin}\n身份：${binding.gatewayId}\n\n仅授权截图，不包含键盘、鼠标或其他控制。每次发送截图前都会再次确认；屏幕内容可能包含隐私信息。`,
    buttons: ['取消', ...choices.map(choice => choice.title)], defaultId: 0, cancelId: 0, noLink: true, signal });
  if (signal.aborted || !choice.response) return;
  const selected = choices[choice.response - 1]; if (!selected) return;
  const owner = selected.chat ?? chat ?? parent;
  let approvedSignal: AbortSignal | undefined;
  const live = () => !signal.aborted && !owner.isDestroyed() && owner.isVisible() && !owner.isMinimized()
    && (!selected.chat || selected.chat.webContents.getURL() === selected.url);
  return { foreground: () => live() && owner.isFocused(),
    confirm: async invocationSignal => {
      approvedSignal = undefined;
      if (!live() || !owner.isFocused() || invocationSignal.aborted) return false;
      if (selected.displayId !== undefined && process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        await dialog.showMessageBox(owner, { type: 'warning', message: '尚未授权屏幕录制',
          detail: '请在系统设置中为此应用开启屏幕录制权限，重新启动后再次选择截图来源。本次不会发送截图。',
          buttons: ['取消此次截图'], defaultId: 0, cancelId: 0, signal: AbortSignal.any([signal, invocationSignal]) });
        return false;
      }
      const answer = await dialog.showMessageBox(owner, { type: 'question', title: '发送一次截图', message: `将“${selected.title}”的当前截图发送给此Gateway？`,
        detail: `接收方：${binding.origin}\n截图可能包含隐私信息，将供模型查看，并按既有会话策略保存。仅发送这一次截图，不授权输入控制。`, buttons: ['取消', '发送这一次截图'], defaultId: 0, cancelId: 0, noLink: true,
        signal: AbortSignal.any([signal, invocationSignal]) });
      const accepted = answer.response === 1 && live() && !invocationSignal.aborted;
      if (accepted) approvedSignal = invocationSignal;
      return accepted;
    },
    capture: async invocationSignal => {
      const captureSignal = AbortSignal.any([signal, invocationSignal]); captureSignal.throwIfAborted();
      const approved = approvedSignal === invocationSignal; approvedSignal = undefined;
      if (!approved || !live() || !owner.isFocused()) throw new Error('DESKTOP_SCREEN_NOT_FOREGROUND');
      const bytes = selected.chat ? png(await selected.chat.webContents.capturePage()) : await displayFrame(selected.displayId!, options.assets, captureSignal);
      if (!live() || !owner.isFocused() || captureSignal.aborted) { bytes.fill(0); throw new Error('DESKTOP_SCREEN_CAPTURE_CANCELLED'); }
      return bytes;
    },
  };
}
