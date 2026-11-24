import { ipcRenderer } from 'electron';

import {
  AnnotationHistory,
  WECHAT_ANNOTATION_COLORS,
  findHitAnnotation,
  fontPixelSize,
  nextBadgeNumber,
  translateAnnotation,
} from './annotations.js';
import { buildPixelatedCanvas, renderAnnotationsToContext } from './canvas-renderer.js';
import {
  MIN_SELECTION_SIZE,
  applyResizeHandle,
  clampRectToBounds,
  computeMagnifierPlacement,
  computeToolbarPlacement,
  findTopSnapWindow,
  logicalToPhysicalRect,
  moveRectWithinBounds,
  normalizeRect,
  nudgeRect,
} from './geometry.js';
import type {
  AnnotationItem,
  AnnotationTool,
  ResizeHandle,
  ScreenshotLanguage,
  ScreenshotOcrResponse,
  ScreenshotOverlayPayload,
  ScreenshotRect,
  ScreenshotTranslateResponse,
  ScrollCaptureProgress,
  SnapWindowRect,
  StrokeSizePreset,
} from './types.js';

const SVG_ICONS: Record<string, string> = {
  rect: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
  ellipse: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 19L19 5"/><path d="M9 5h10v10"/></svg>',
  line: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 19L19 5"/></svg>',
  pen: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  mosaic: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
  badge: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M10.5 9.5L12 8v8"/></svg>',
  text: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>',
  ocr: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M20 7V5a1 1 0 0 0-1-1h-2"/><path d="M4 17v2a1 1 0 0 0 1 1h2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M8 9h8M12 9v7"/></svg>',
  translate: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>',
  scroll: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="m9 14 3 3 3-3"/><path d="M12 7v10"/></svg>',
  undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>',
  redo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13"/></svg>',
  save: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  pin: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>',
  note: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/></svg>',
  chat: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  cancel: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  confirm: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
};

const LABELS = {
  zh: {
    rect: '矩形',
    ellipse: '椭圆',
    arrow: '箭头',
    line: '直线',
    pen: '画笔',
    mosaic: '马赛克',
    badge: '序号标注',
    text: '文字',
    ocr: '提取文字 (OCR)',
    translate: '截图翻译',
    scroll: '滚动长截图',
    undo: '撤销 (⌘/Ctrl+Z)',
    redo: '重做 (⌘/Ctrl+Shift+Z)',
    save: '保存图片 (⌘/Ctrl+S)',
    pin: '贴图到屏幕 (⌘/Ctrl+T)',
    note: '存入快速笔记',
    askAi: '问 AI',
    sendChat: '发到对话',
    cancel: '取消 (Esc)',
    confirm: '完成复制 (Enter)',
    loupeHint: 'C 复制色值 · Tab 切换格式',
    copiedColor: '已复制色值',
    copiedText: '已复制文本',
    ocrTitle: '提取文字',
    translateTitle: '截图翻译',
    recognizing: '正在识别画面内容…',
    translating: '正在翻译画面文字…',
    copyAll: '复制全文',
    aiDeepOcr: 'AI 精准识别 (表格/公式)',
    insertToChat: '发到对话',
    askPlaceholder: '输入问题连同截图发给 AI（直接回车仅发图）…',
    send: '发送',
    scrollHint: '请在绿色虚线框内向下滚动鼠标或触控板',
    autoScrollStart: '自动滚动',
    autoScrollStop: '停止滚动',
    scrollAnnotate: '去标注',
    scrollCopy: '完成复制',
    screensSuffix: '帧',
  },
  en: {
    rect: 'Rectangle',
    ellipse: 'Ellipse',
    arrow: 'Arrow',
    line: 'Line',
    pen: 'Pen',
    mosaic: 'Mosaic',
    badge: 'Step Number',
    text: 'Text',
    ocr: 'Extract Text (OCR)',
    translate: 'Translate Image',
    scroll: 'Scrolling Capture',
    undo: 'Undo (⌘/Ctrl+Z)',
    redo: 'Redo (⌘/Ctrl+Shift+Z)',
    save: 'Save Image (⌘/Ctrl+S)',
    pin: 'Pin to Screen (⌘/Ctrl+T)',
    note: 'Save to Note',
    askAi: 'Ask AI',
    sendChat: 'To Chat',
    cancel: 'Cancel (Esc)',
    confirm: 'Copy & Done (Enter)',
    loupeHint: 'C copy color · Tab HEX/RGB',
    copiedColor: 'Copied color',
    copiedText: 'Copied text',
    ocrTitle: 'Extracted Text',
    translateTitle: 'Image Translation',
    recognizing: 'Recognizing text…',
    translating: 'Translating screenshot…',
    copyAll: 'Copy All',
    aiDeepOcr: 'AI Precision OCR',
    insertToChat: 'Send to Chat',
    askPlaceholder: 'Ask AI about this screenshot (Enter to attach only)…',
    send: 'Send',
    scrollHint: 'Scroll down inside the green dashed region',
    autoScrollStart: 'Auto Scroll',
    autoScrollStop: 'Stop Scroll',
    scrollAnnotate: 'Annotate',
    scrollCopy: 'Copy & Done',
    screensSuffix: 'frames',
  },
} as const;

type DragMode =
  | { kind: 'none' }
  | { kind: 'creating'; startX: number; startY: number; moved: boolean }
  | { kind: 'moving-selection'; startX: number; startY: number; initial: ScreenshotRect }
  | { kind: 'resizing-selection'; startX: number; startY: number; handle: ResizeHandle; initial: ScreenshotRect }
  | { kind: 'drawing-shape'; tool: AnnotationTool; draft: AnnotationItem }
  | {
      kind: 'moving-annotation';
      startX: number;
      startY: number;
      moved: boolean;
      itemId: string;
      snapshot: AnnotationItem[];
      preview: AnnotationItem[];
    };

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function handlePositions(rect: ScreenshotRect): Array<{ handle: ResizeHandle; x: number; y: number; cursor: string }> {
  const { x, y, width: w, height: h } = rect;
  const mx = x + w / 2;
  const my = y + h / 2;
  return [
    { handle: 'nw', x, y, cursor: 'nwse-resize' },
    { handle: 'n', x: mx, y, cursor: 'ns-resize' },
    { handle: 'ne', x: x + w, y, cursor: 'nesw-resize' },
    { handle: 'e', x: x + w, y: my, cursor: 'ew-resize' },
    { handle: 'se', x: x + w, y: y + h, cursor: 'nwse-resize' },
    { handle: 's', x: mx, y: y + h, cursor: 'ns-resize' },
    { handle: 'sw', x, y: y + h, cursor: 'nesw-resize' },
    { handle: 'w', x, y: my, cursor: 'ew-resize' },
  ];
}

function bootOverlay(): void {
  const stage = document.getElementById('stage') as HTMLDivElement;
  const mainCanvas = document.getElementById('main-canvas') as HTMLCanvasElement;
  const mainCtx = mainCanvas.getContext('2d')!;
  const dimBadge = document.getElementById('dim-badge') as HTMLDivElement;
  const loupe = document.getElementById('loupe') as HTMLDivElement;
  const loupeCanvas = document.getElementById('loupe-canvas') as HTMLCanvasElement;
  const loupeCtx = loupeCanvas.getContext('2d')!;
  const loupePos = document.getElementById('loupe-pos') as HTMLSpanElement;
  const loupeSwatch = document.getElementById('loupe-swatch') as HTMLSpanElement;
  const loupeColor = document.getElementById('loupe-color') as HTMLSpanElement;
  const loupeHint = document.getElementById('loupe-hint') as HTMLDivElement;
  const toolbar = document.getElementById('toolbar') as HTMLDivElement;
  const subbar = document.getElementById('subbar') as HTMLDivElement;
  const textEditor = document.getElementById('text-editor') as HTMLTextAreaElement;
  const resultDrawer = document.getElementById('result-drawer') as HTMLDivElement;
  const askPopover = document.getElementById('ask-popover') as HTMLDivElement;
  const askInput = document.getElementById('ask-input') as HTMLInputElement;
  const askSend = document.getElementById('ask-send') as HTMLButtonElement;
  const scrollDock = document.getElementById('scroll-dock') as HTMLDivElement;
  const toastEl = document.getElementById('toast') as HTMLDivElement;

  let session: ScreenshotOverlayPayload | null = null;
  let lang: ScreenshotLanguage = 'zh';
  let bgImage: HTMLImageElement | null = null;
  let pixelSamplerCanvas: HTMLCanvasElement | null = null;
  let pixelSamplerCtx: CanvasRenderingContext2D | null = null;
  const mosaicCache = new Map<number, HTMLCanvasElement>();

  let selection: ScreenshotRect | null = null;
  let hoveredSnap: (SnapWindowRect & { localRect: ScreenshotRect }) | null = null;
  let activeTool: AnnotationTool = 'select';
  let activeColor: string = WECHAT_ANNOTATION_COLORS[0];
  let activeSize: StrokeSizePreset = 'md';
  let selectedAnnotationId: string | null = null;
  let editingTextState: { id: string | null; x: number; y: number } | null = null;
  let drag: DragMode = { kind: 'none' };
  const history = new AnnotationHistory();

  let cursorX = 0;
  let cursorY = 0;
  let currentColorHex = '#000000';
  let currentColorRgb = 'rgb(0, 0, 0)';
  let colorFormat: 'hex' | 'rgb' = 'hex';
  let scrollMode: ScrollCaptureProgress | null = null;
  let scrollIgnoreMouse: boolean | null = null;
  let committing = false;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  function showToast(msg: string): void {
    clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    toastTimer = setTimeout(() => {
      toastEl.style.display = 'none';
    }, 1500);
  }

  function getMosaicSource(blockSize: number): HTMLCanvasElement {
    const cached = mosaicCache.get(blockSize);
    if (cached) return cached;
    if (!bgImage || !session) {
      const empty = document.createElement('canvas');
      empty.width = 1;
      empty.height = 1;
      return empty;
    }
    const built = buildPixelatedCanvas(
      bgImage,
      session.pixelWidth,
      session.pixelHeight,
      blockSize,
      session.imageBounds ? session.pixelWidth / session.imageBounds.width : session.scaleFactor,
    );
    mosaicCache.set(blockSize, built);
    return built;
  }

  function viewportSize(): { width: number; height: number } {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function selectionBounds(): { width: number; height: number } {
    return session?.imageBounds ?? viewportSize();
  }

  function commitPendingTextEditor(): void {
    if (!editingTextState) return;
    const raw = textEditor.value.trim();
    const state = editingTextState;
    editingTextState = null;
    textEditor.style.display = 'none';
    textEditor.value = '';
    if (raw) {
      const next = [...history.items];
      if (state.id) {
        const idx = next.findIndex((i) => i.id === state.id);
        if (idx >= 0) {
          next[idx] = { ...(next[idx] as Extract<AnnotationItem, { kind: 'text' }>), text: raw, color: activeColor, strokeSize: activeSize };
        }
      } else {
        next.push({
          id: uid(),
          kind: 'text',
          x: state.x,
          y: state.y,
          text: raw,
          color: activeColor,
          strokeSize: activeSize,
        });
      }
      history.commit(next);
      syncToolbarButtons();
    }
    render();
  }

  function startTextEditor(x: number, y: number, existing?: Extract<AnnotationItem, { kind: 'text' }>): void {
    commitPendingTextEditor();
    const clampedX = Math.max(8, Math.min(existing?.x ?? x, window.innerWidth - 132));
    const clampedY = Math.max(8, Math.min(existing?.y ?? y, window.innerHeight - 40));
    editingTextState = { id: existing?.id ?? null, x: clampedX, y: clampedY };
    if (existing) {
      activeColor = existing.color;
      activeSize = existing.strokeSize;
    }
    const fontSize = fontPixelSize(activeSize);
    textEditor.style.left = `${Math.max(2, editingTextState.x - 7)}px`;
    textEditor.style.top = `${Math.max(2, editingTextState.y - 4)}px`;
    textEditor.style.fontSize = `${fontSize}px`;
    textEditor.style.color = activeColor;
    textEditor.value = existing?.text ?? '';
    textEditor.style.display = 'block';
    autoSizeTextEditor();
    setTimeout(() => textEditor.focus(), 0);
    render();
  }

  function autoSizeTextEditor(): void {
    textEditor.style.width = '120px';
    textEditor.style.height = 'auto';
    textEditor.style.width = `${Math.min(560, Math.max(120, textEditor.scrollWidth + 16))}px`;
    textEditor.style.height = `${Math.min(360, Math.max(32, textEditor.scrollHeight + 4))}px`;
  }

  textEditor.addEventListener('input', autoSizeTextEditor);
  textEditor.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      editingTextState = null;
      textEditor.style.display = 'none';
      textEditor.value = '';
      render();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitPendingTextEditor();
    }
  });

  function render(): void {
    if (!session) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dpr = session.scaleFactor || window.devicePixelRatio || 1;
    if (mainCanvas.width !== Math.round(vw * dpr) || mainCanvas.height !== Math.round(vh * dpr)) {
      mainCanvas.width = Math.round(vw * dpr);
      mainCanvas.height = Math.round(vh * dpr);
    }

    mainCtx.save();
    mainCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mainCtx.clearRect(0, 0, vw, vh);

    // Phase 4 Scroll Capture mode renders a clean transparent viewport with green marching ants!
    if (scrollMode?.active && selection) {
      mainCtx.fillStyle = 'rgba(0, 0, 0, 0.28)';
      mainCtx.fillRect(0, 0, vw, vh);
      mainCtx.clearRect(selection.x, selection.y, selection.width, selection.height);
      mainCtx.strokeStyle = '#22c55e';
      mainCtx.lineWidth = 2;
      mainCtx.setLineDash([7, 5]);
      mainCtx.strokeRect(selection.x - 1, selection.y - 1, selection.width + 2, selection.height + 2);
      mainCtx.restore();
      return;
    }

    if (bgImage) {
      const imageBounds = session.imageBounds ?? session.initialSelection;
      if (imageBounds) {
        mainCtx.fillStyle = '#0f1115';
        mainCtx.fillRect(0, 0, vw, vh);
        mainCtx.drawImage(
          bgImage,
          imageBounds.x,
          imageBounds.y,
          imageBounds.width,
          imageBounds.height,
        );
      } else {
        mainCtx.drawImage(bgImage, 0, 0, vw, vh);
      }
    }

    // Dim outside active selection or hovered snap window.
    mainCtx.fillStyle = 'rgba(0, 0, 0, 0.46)';
    const activeRect = selection ?? hoveredSnap?.localRect ?? null;
    if (!activeRect) {
      mainCtx.fillRect(0, 0, vw, vh);
    } else {
      const { x, y, width: w, height: h } = activeRect;
      mainCtx.fillRect(0, 0, vw, y);
      mainCtx.fillRect(0, y + h, vw, Math.max(0, vh - (y + h)));
      mainCtx.fillRect(0, y, x, h);
      mainCtx.fillRect(x + w, y, Math.max(0, vw - (x + w)), h);
    }

    // Clip and render annotations inside selection.
    if (selection) {
      const itemsToDraw =
        drag.kind === 'drawing-shape'
          ? [...history.items, drag.draft]
          : drag.kind === 'moving-annotation'
            ? drag.preview
            : history.items;
      if (itemsToDraw.length > 0) {
        mainCtx.save();
        mainCtx.beginPath();
        mainCtx.rect(selection.x, selection.y, selection.width, selection.height);
        mainCtx.clip();
        renderAnnotationsToContext({
          ctx: mainCtx,
          items: itemsToDraw,
          selectedId: selectedAnnotationId,
          editingTextId: editingTextState?.id ?? null,
          scaleFactor: dpr,
          getMosaicSource,
          mosaicBounds: session.imageBounds,
        });
        mainCtx.restore();
      }

      // Crisp WeChat green selection border + 8 resize handles.
      mainCtx.strokeStyle = '#07c160';
      mainCtx.lineWidth = 1.5;
      mainCtx.strokeRect(selection.x + 0.5, selection.y + 0.5, selection.width - 1, selection.height - 1);

      mainCtx.fillStyle = '#07c160';
      mainCtx.strokeStyle = '#ffffff';
      mainCtx.lineWidth = 1;
      for (const h of handlePositions(selection)) {
        mainCtx.fillRect(h.x - 3.5, h.y - 3.5, 7, 7);
        mainCtx.strokeRect(h.x - 3.5, h.y - 3.5, 7, 7);
      }
    } else if (hoveredSnap) {
      const r = hoveredSnap.localRect;
      mainCtx.strokeStyle = '#07c160';
      mainCtx.lineWidth = 2;
      mainCtx.strokeRect(r.x + 1, r.y + 1, Math.max(0, r.width - 2), Math.max(0, r.height - 2));
    }

    mainCtx.restore();
    updateDimensionBadge();
  }

  function updateDimensionBadge(): void {
    if (scrollMode?.active) {
      dimBadge.style.display = 'none';
      return;
    }
    const target = selection ?? hoveredSnap?.localRect ?? null;
    if (!target) {
      dimBadge.style.display = 'none';
      return;
    }
    const titlePrefix =
      !selection && hoveredSnap && (hoveredSnap.appName || hoveredSnap.title)
        ? `${(hoveredSnap.appName || hoveredSnap.title).slice(0, 28)} · `
        : '';
    dimBadge.textContent = `${titlePrefix}${target.width} × ${target.height}`;
    dimBadge.style.display = 'block';
    const badgeY = target.y >= 30 ? target.y - 26 : target.y + 6;
    const badgeX = Math.max(6, Math.min(target.x, window.innerWidth - 160));
    dimBadge.style.left = `${badgeX}px`;
    dimBadge.style.top = `${badgeY}px`;
  }

  function updateLoupe(localX: number, localY: number): void {
    const showLoupe =
      !scrollMode?.active &&
      (!selection || drag.kind === 'creating' || drag.kind === 'resizing-selection') &&
      Boolean(pixelSamplerCanvas && pixelSamplerCtx && session);
    if (!showLoupe || !pixelSamplerCanvas || !pixelSamplerCtx || !session) {
      loupe.style.display = 'none';
      return;
    }

    const imageBounds = session.imageBounds ?? session.initialSelection;
    const sampleX = localX - (imageBounds?.x ?? 0);
    const sampleY = localY - (imageBounds?.y ?? 0);
    const physX = Math.max(
      0,
      Math.min(
        pixelSamplerCanvas.width - 1,
        Math.round((sampleX / Math.max(1, imageBounds?.width ?? window.innerWidth)) * pixelSamplerCanvas.width),
      ),
    );
    const physY = Math.max(
      0,
      Math.min(
        pixelSamplerCanvas.height - 1,
        Math.round((sampleY / Math.max(1, imageBounds?.height ?? window.innerHeight)) * pixelSamplerCanvas.height),
      ),
    );

    const gridCols = 13;
    const gridRows = 9;
    const halfX = Math.floor(gridCols / 2);
    const halfY = Math.floor(gridRows / 2);

    loupeCtx.fillStyle = '#0b0d10';
    loupeCtx.fillRect(0, 0, loupeCanvas.width, loupeCanvas.height);
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.drawImage(
      pixelSamplerCanvas,
      physX - halfX,
      physY - halfY,
      gridCols,
      gridRows,
      0,
      0,
      loupeCanvas.width,
      loupeCanvas.height,
    );

    // Pixel grid + center highlight
    const cellW = loupeCanvas.width / gridCols;
    const cellH = loupeCanvas.height / gridRows;
    loupeCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    loupeCtx.lineWidth = 0.5;
    for (let cx = 1; cx < gridCols; cx += 1) {
      loupeCtx.beginPath();
      loupeCtx.moveTo(cx * cellW, 0);
      loupeCtx.lineTo(cx * cellW, loupeCanvas.height);
      loupeCtx.stroke();
    }
    for (let cy = 1; cy < gridRows; cy += 1) {
      loupeCtx.beginPath();
      loupeCtx.moveTo(0, cy * cellH);
      loupeCtx.lineTo(loupeCanvas.width, cy * cellH);
      loupeCtx.stroke();
    }
    loupeCtx.strokeStyle = '#07c160';
    loupeCtx.lineWidth = 1.5;
    loupeCtx.strokeRect(halfX * cellW, halfY * cellH, cellW, cellH);

    const px = pixelSamplerCtx.getImageData(physX, physY, 1, 1).data;
    currentColorHex = rgbToHex(px[0]!, px[1]!, px[2]!);
    currentColorRgb = `rgb(${px[0]!}, ${px[1]!}, ${px[2]!})`;
    loupePos.textContent = `(${Math.round(localX)}, ${Math.round(localY)})`;
    loupeSwatch.style.background = currentColorHex;
    loupeColor.textContent = colorFormat === 'hex' ? currentColorHex : currentColorRgb;
    loupeHint.textContent = LABELS[lang].loupeHint;

    loupe.style.display = 'block';
    const pos = computeMagnifierPlacement(localX, localY, { width: 144, height: 158 }, viewportSize());
    loupe.style.left = `${pos.x}px`;
    loupe.style.top = `${pos.y}px`;
  }

  /**
   * Exports the selected region with all vector & mosaic annotations at crisp physical HiDPI resolution.
   */
  function exportCompositedSelectionPngBase64(): { pngBase64: string; width: number; height: number } | null {
    if (!selection || !bgImage || !session) return null;
    commitPendingTextEditor();

    const outCanvas = document.createElement('canvas');
    if (session.initialSelection) {
      const scale = session.scaleFactor || 1;
      outCanvas.width = Math.max(1, Math.round(selection.width * scale));
      outCanvas.height = Math.max(1, Math.round(selection.height * scale));
      const ctx = outCanvas.getContext('2d')!;
      ctx.save();
      ctx.scale(scale, scale);
      ctx.fillStyle = '#0f1115';
      ctx.fillRect(0, 0, selection.width, selection.height);
      ctx.drawImage(
        bgImage,
        session.initialSelection.x - selection.x,
        session.initialSelection.y - selection.y,
        session.initialSelection.width,
        session.initialSelection.height,
      );
      ctx.translate(-selection.x, -selection.y);
      renderAnnotationsToContext({
        ctx,
        items: history.items,
        scaleFactor: scale,
        offsetX: -selection.x,
        offsetY: -selection.y,
        getMosaicSource,
      });
      ctx.restore();
    } else {
      const phys = logicalToPhysicalRect(selection, selectionBounds(), {
        width: session.pixelWidth,
        height: session.pixelHeight,
      });
      outCanvas.width = phys.width;
      outCanvas.height = phys.height;
      const scaleX = phys.width / Math.max(1, selection.width);
      const ctx = outCanvas.getContext('2d')!;
      ctx.drawImage(bgImage, phys.x, phys.y, phys.width, phys.height, 0, 0, phys.width, phys.height);
      ctx.save();
      ctx.scale(scaleX, scaleX);
      ctx.translate(-selection.x, -selection.y);
      renderAnnotationsToContext({
        ctx,
        items: history.items,
        scaleFactor: scaleX,
        offsetX: -selection.x,
        offsetY: -selection.y,
        getMosaicSource: (blockSize) => {
          const full = getMosaicSource(blockSize);
          const cropped = document.createElement('canvas');
          cropped.width = phys.width;
          cropped.height = phys.height;
          cropped.getContext('2d')?.drawImage(
            full,
            phys.x,
            phys.y,
            phys.width,
            phys.height,
            0,
            0,
            phys.width,
            phys.height,
          );
          return cropped;
        },
      });
      ctx.restore();
    }

    const dataUrl = outCanvas.toDataURL('image/png');
    const pngBase64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    return { pngBase64, width: selection.width, height: selection.height };
  }

  function buildToolbar(): void {
    const t = LABELS[lang];
    toolbar.innerHTML = '';

    const addBtn = (
      id: string,
      iconKey: string,
      title: string,
      onClick: () => void,
      extraClass = '',
      labelText?: string,
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset['action'] = id;
      btn.className = `tb-btn ${extraClass}`.trim();
      btn.title = title;
      btn.innerHTML = labelText ? `${SVG_ICONS[iconKey] ?? ''}<span>${labelText}</span>` : (SVG_ICONS[iconKey] ?? '');
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      toolbar.appendChild(btn);
      return btn;
    };

    const addSep = () => {
      const sep = document.createElement('div');
      sep.className = 'tb-sep';
      toolbar.appendChild(sep);
    };

    const shapeTools: Array<{ tool: AnnotationTool; label: string }> = [
      { tool: 'rect', label: t.rect },
      { tool: 'ellipse', label: t.ellipse },
      { tool: 'arrow', label: t.arrow },
      { tool: 'line', label: t.line },
      { tool: 'pen', label: t.pen },
      { tool: 'mosaic', label: t.mosaic },
      { tool: 'badge', label: t.badge },
      { tool: 'text', label: t.text },
    ];

    for (const entry of shapeTools) {
      addBtn(entry.tool, entry.tool, entry.label, () => {
        commitPendingTextEditor();
        activeTool = activeTool === entry.tool ? 'select' : entry.tool;
        selectedAnnotationId = null;
        syncToolbarButtons();
        positionFloatingPanels();
        render();
      });
    }

    addSep();

    addBtn('ocr', 'ocr', t.ocr, () => void triggerOcr(false));
    addBtn('translate', 'translate', t.translate, () => void triggerTranslate('auto'));
    if (!session?.initialSelection && !session?.imageBounds) {
      addBtn('scroll', 'scroll', t.scroll, () => void startScrollCapture());
    }

    addSep();

    addBtn('undo', 'undo', t.undo, () => {
      commitPendingTextEditor();
      history.undo();
      syncToolbarButtons();
      render();
    });
    addBtn('redo', 'redo', t.redo, () => {
      commitPendingTextEditor();
      history.redo();
      syncToolbarButtons();
      render();
    });

    addSep();

    addBtn('save', 'save', t.save, () => void commitAction('save'));
    addBtn('pin', 'pin', t.pin, () => void commitAction('pin'));
    addBtn('note', 'note', t.note, () => void commitAction('note'));
    addBtn('ask', 'chat', t.askAi, () => toggleAskPopover(), 'ai-accent', t.askAi);

    addSep();

    addBtn('cancel', 'cancel', t.cancel, () => cancelSession(), 'danger');
    addBtn('confirm', 'confirm', t.confirm, () => void commitAction('copy'), 'confirm');

    buildSubbar();
    syncToolbarButtons();
  }

  function buildSubbar(): void {
    subbar.innerHTML = '';
    const sizes: Array<{ key: StrokeSizePreset; px: number }> = [
      { key: 'sm', px: 5 },
      { key: 'md', px: 8 },
      { key: 'lg', px: 12 },
    ];
    for (const s of sizes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `size-btn ${activeSize === s.key ? 'active' : ''}`;
      btn.innerHTML = `<span class="size-dot" style="width:${s.px}px;height:${s.px}px"></span>`;
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        activeSize = s.key;
        buildSubbar();
      });
      subbar.appendChild(btn);
    }

    if (activeTool !== 'mosaic') {
      const sep = document.createElement('div');
      sep.className = 'tb-sep';
      subbar.appendChild(sep);

      for (const color of WECHAT_ANNOTATION_COLORS) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = `swatch-btn ${activeColor === color ? 'active' : ''}`;
        swatch.style.background = color;
        swatch.addEventListener('mousedown', (e) => e.stopPropagation());
        swatch.addEventListener('click', (e) => {
          e.stopPropagation();
          activeColor = color;
          if (editingTextState) {
            textEditor.style.color = color;
          }
          buildSubbar();
        });
        subbar.appendChild(swatch);
      }
    }
  }

  function syncToolbarButtons(): void {
    for (const el of toolbar.querySelectorAll<HTMLButtonElement>('button.tb-btn')) {
      const action = el.dataset['action'];
      if (!action) continue;
      if (['rect', 'ellipse', 'arrow', 'line', 'pen', 'mosaic', 'badge', 'text'].includes(action)) {
        el.classList.toggle('active', activeTool === action);
      } else if (action === 'undo') {
        el.disabled = !history.canUndo;
      } else if (action === 'redo') {
        el.disabled = !history.canRedo;
      }
    }
    buildSubbar();
  }

  function positionFloatingPanels(): void {
    if (!selection || scrollMode?.active || drag.kind === 'creating' || drag.kind === 'resizing-selection' || drag.kind === 'moving-selection') {
      toolbar.style.display = 'none';
      subbar.style.display = 'none';
      return;
    }

    toolbar.style.display = 'flex';
    const tbRect = toolbar.getBoundingClientRect();
    const tbW = tbRect.width || 560;
    const tbH = tbRect.height || 40;
    const placement = computeToolbarPlacement(selection, { width: tbW, height: tbH }, viewportSize());
    toolbar.style.left = `${placement.x}px`;
    toolbar.style.top = `${placement.y}px`;

    if (activeTool !== 'select') {
      subbar.style.display = 'flex';
      const sbRect = subbar.getBoundingClientRect();
      const sbW = sbRect.width || 240;
      const sbH = sbRect.height || 36;
      const sbX = Math.max(8, Math.min(placement.x, window.innerWidth - sbW - 8));
      const sbY =
        placement.position === 'above'
          ? Math.max(8, placement.y - sbH - 6)
          : Math.min(window.innerHeight - sbH - 8, placement.y + tbH + 6);
      subbar.style.left = `${sbX}px`;
      subbar.style.top = `${sbY}px`;
    } else {
      subbar.style.display = 'none';
    }
  }

  function positionDrawer(panel: HTMLElement, width: number, height: number): void {
    if (!selection) return;
    const margin = 10;
    const rightSpace = window.innerWidth - (selection.x + selection.width);
    let x = selection.x + selection.width + 10;
    let y = selection.y;
    if (rightSpace < width + margin) {
      if (selection.x >= width + margin) {
        x = selection.x - width - 10;
      } else {
        x = Math.max(margin, Math.min(selection.x + selection.width - width, window.innerWidth - width - margin));
        y = Math.min(window.innerHeight - height - margin, selection.y + selection.height + 56);
      }
    }
    y = Math.max(margin, Math.min(y, window.innerHeight - height - margin));
    panel.style.left = `${Math.round(x)}px`;
    panel.style.top = `${Math.round(y)}px`;
  }

  function toggleAskPopover(): void {
    if (!selection) return;
    resultDrawer.style.display = 'none';
    if (askPopover.style.display === 'flex') {
      askPopover.style.display = 'none';
      return;
    }
    const t = LABELS[lang];
    askInput.placeholder = t.askPlaceholder;
    askSend.textContent = t.send;
    askPopover.style.display = 'flex';
    const tbRect = toolbar.getBoundingClientRect();
    const x = Math.max(8, Math.min(tbRect.right - 340, window.innerWidth - 348));
    const y = tbRect.top > 56 ? tbRect.top - 48 : Math.min(window.innerHeight - 48, tbRect.bottom + 8);
    askPopover.style.left = `${Math.round(x)}px`;
    askPopover.style.top = `${Math.round(y)}px`;
    setTimeout(() => askInput.focus(), 0);
  }

  askPopover.addEventListener('mousedown', (e) => e.stopPropagation());
  resultDrawer.addEventListener('mousedown', (e) => e.stopPropagation());
  scrollDock.addEventListener('mousedown', (e) => e.stopPropagation());

  askSend.addEventListener('click', () => {
    void commitAction('chat', askInput.value.trim());
  });
  askInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      askPopover.style.display = 'none';
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void commitAction('chat', askInput.value.trim());
    }
  });

  async function triggerOcr(preferAi: boolean): Promise<void> {
    if (!session || !selection) return;
    const exported = exportCompositedSelectionPngBase64();
    if (!exported) return;
    askPopover.style.display = 'none';
    const t = LABELS[lang];
    resultDrawer.style.display = 'flex';
    positionDrawer(resultDrawer, 360, 260);
    resultDrawer.innerHTML = `
      <div class="drawer-header">
        <span>${t.ocrTitle}</span>
        <span class="drawer-badge">OCR</span>
      </div>
      <div class="drawer-body" style="justify-content:center;align-items:center;color:#9ca3af;font-size:12.5px">
        ${t.recognizing}
      </div>
    `;

    const res = (await ipcRenderer.invoke('screenshot-overlay:ocr', {
      sessionId: session.sessionId,
      pngBase64: exported.pngBase64,
      preferAi,
    })) as ScreenshotOcrResponse;

    const engineName =
      res.engine === 'vision'
        ? 'macOS Vision'
        : res.engine === 'winrt'
          ? 'Windows OCR'
          : res.engine === 'tesseract'
            ? 'Tesseract'
            : res.model ?? 'AI Vision';

    resultDrawer.innerHTML = `
      <div class="drawer-header">
        <span>${t.ocrTitle}</span>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="drawer-badge">${escapeHtml(engineName)}</span>
          <button type="button" id="drawer-close" class="tb-btn" style="width:22px;height:22px">${SVG_ICONS['cancel']}</button>
        </div>
      </div>
      <div class="drawer-body">
        <textarea id="ocr-textarea" class="drawer-textarea"></textarea>
      </div>
      <div class="drawer-footer">
        <div style="display:flex;gap:5px">
          ${res.engine !== 'ai' ? `<button type="button" id="ocr-ai-btn" class="pill-action">${t.aiDeepOcr}</button>` : ''}
        </div>
        <div style="display:flex;gap:5px">
          <button type="button" id="ocr-chat-btn" class="pill-action">${t.insertToChat}</button>
          <button type="button" id="ocr-copy-btn" class="pill-action primary">${t.copyAll}</button>
        </div>
      </div>
    `;

    const ocrTextarea = resultDrawer.querySelector<HTMLTextAreaElement>('#ocr-textarea');
    if (ocrTextarea) {
      ocrTextarea.value = res.ok ? res.text : res.error ?? '';
    }

    resultDrawer.querySelector('#drawer-close')?.addEventListener('click', () => {
      resultDrawer.style.display = 'none';
    });
    resultDrawer.querySelector('#ocr-ai-btn')?.addEventListener('click', () => {
      void triggerOcr(true);
    });
    resultDrawer.querySelector('#ocr-copy-btn')?.addEventListener('click', () => {
      const val = (resultDrawer.querySelector('#ocr-textarea') as HTMLTextAreaElement | null)?.value ?? '';
      void ipcRenderer.invoke('screenshot-overlay:copy-text', val);
      showToast(t.copiedText);
    });
    resultDrawer.querySelector('#ocr-chat-btn')?.addEventListener('click', () => {
      const val = (resultDrawer.querySelector('#ocr-textarea') as HTMLTextAreaElement | null)?.value ?? '';
      void commitAction('chat', val);
    });
  }

  async function triggerTranslate(targetLanguage: 'auto' | 'zh' | 'en'): Promise<void> {
    if (!session || !selection) return;
    const exported = exportCompositedSelectionPngBase64();
    if (!exported) return;
    askPopover.style.display = 'none';
    const t = LABELS[lang];
    resultDrawer.style.display = 'flex';
    positionDrawer(resultDrawer, 360, 260);
    resultDrawer.innerHTML = `
      <div class="drawer-header">
        <span>${t.translateTitle}</span>
        <span class="drawer-badge">AI Translate</span>
      </div>
      <div class="drawer-body" style="justify-content:center;align-items:center;color:#9ca3af;font-size:12.5px">
        ${t.translating}
      </div>
    `;

    const res = (await ipcRenderer.invoke('screenshot-overlay:translate', {
      sessionId: session.sessionId,
      pngBase64: exported.pngBase64,
      targetLanguage,
    })) as ScreenshotTranslateResponse;

    resultDrawer.innerHTML = `
      <div class="drawer-header">
        <div style="display:flex;align-items:center;gap:6px">
          <span>${t.translateTitle}</span>
          <button type="button" data-lang="zh" class="pill-action" style="padding:2px 6px;font-size:10.5px;${targetLanguage === 'zh' ? 'border-color:#60a5fa' : ''}">→ 中文</button>
          <button type="button" data-lang="en" class="pill-action" style="padding:2px 6px;font-size:10.5px;${targetLanguage === 'en' ? 'border-color:#60a5fa' : ''}">→ EN</button>
        </div>
        <button type="button" id="drawer-close" class="tb-btn" style="width:22px;height:22px">${SVG_ICONS['cancel']}</button>
      </div>
      <div class="drawer-body">
        <textarea id="trans-textarea" class="drawer-textarea"></textarea>
      </div>
      <div class="drawer-footer">
        <span style="font-size:10.5px;color:#9ca3af;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(res.model ?? '')}</span>
        <div style="display:flex;gap:5px">
          <button type="button" id="trans-chat-btn" class="pill-action">${t.insertToChat}</button>
          <button type="button" id="trans-copy-btn" class="pill-action primary">${t.copyAll}</button>
        </div>
      </div>
    `;

    const transTextarea = resultDrawer.querySelector<HTMLTextAreaElement>('#trans-textarea');
    if (transTextarea) {
      transTextarea.value = res.ok ? res.translatedText : res.error ?? '';
    }

    resultDrawer.querySelector('#drawer-close')?.addEventListener('click', () => {
      resultDrawer.style.display = 'none';
    });
    for (const btn of resultDrawer.querySelectorAll<HTMLButtonElement>('button[data-lang]')) {
      btn.addEventListener('click', () => {
        const nextLang = btn.dataset['lang'] === 'en' ? 'en' : 'zh';
        void triggerTranslate(nextLang);
      });
    }
    resultDrawer.querySelector('#trans-copy-btn')?.addEventListener('click', () => {
      const val = (resultDrawer.querySelector('#trans-textarea') as HTMLTextAreaElement | null)?.value ?? '';
      void ipcRenderer.invoke('screenshot-overlay:copy-text', val);
      showToast(t.copiedText);
    });
    resultDrawer.querySelector('#trans-chat-btn')?.addEventListener('click', () => {
      const val = (resultDrawer.querySelector('#trans-textarea') as HTMLTextAreaElement | null)?.value ?? '';
      void commitAction('chat', val);
    });
  }

  async function startScrollCapture(): Promise<void> {
    if (!session || !selection) return;
    commitPendingTextEditor();
    resultDrawer.style.display = 'none';
    askPopover.style.display = 'none';
    toolbar.style.display = 'none';
    subbar.style.display = 'none';
    loupe.style.display = 'none';

    const progress = (await ipcRenderer.invoke('screenshot-overlay:scroll-start', {
      sessionId: session.sessionId,
      displayId: session.displayId,
      rect: selection,
    })) as ScrollCaptureProgress | null;
    if (!progress) return;
    scrollMode = progress;
    renderScrollDock();
    render();
  }

  function renderScrollDock(): void {
    if (!scrollMode?.active || !selection) {
      scrollDock.style.display = 'none';
      return;
    }
    const t = LABELS[lang];
    scrollDock.style.display = 'flex';
    const dockW = 268;
    const dockH = 220;
    const vp = viewportSize();
    // Prefer right or left outside selection first so the dock stays out of the capture region even on X11!
    let dockPos: { x: number; y: number };
    if (selection.x + selection.width + dockW + 16 <= vp.width) {
      dockPos = {
        x: Math.round(selection.x + selection.width + 10),
        y: Math.round(Math.max(8, Math.min(selection.y, vp.height - dockH - 8))),
      };
    } else if (selection.x >= dockW + 16) {
      dockPos = {
        x: Math.round(selection.x - dockW - 10),
        y: Math.round(Math.max(8, Math.min(selection.y, vp.height - dockH - 8))),
      };
    } else {
      dockPos = computeToolbarPlacement(selection, { width: dockW, height: dockH }, vp, 0);
    }
    scrollDock.style.left = `${dockPos.x}px`;
    scrollDock.style.top = `${dockPos.y}px`;

    scrollDock.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600">
        <span style="color:#4ade80">${scrollMode.pixelWidth} × ${scrollMode.pixelHeight}px</span>
        <span style="font-size:11px;color:#9ca3af">${scrollMode.frameCount} ${t.screensSuffix}</span>
      </div>
      ${
        scrollMode.previewPngBase64
          ? `<div class="scroll-preview-wrap"><img id="scroll-preview-img" src="data:image/png;base64,${scrollMode.previewPngBase64}" alt="" /></div>`
          : ''
      }
      <div style="font-size:11px;color:#d1d5db;line-height:1.35">${escapeHtml(scrollMode.statusMessage ?? t.scrollHint)}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end">
        ${
          scrollMode.autoScrollSupported
            ? `<button type="button" id="sc-auto-btn" class="pill-action">${scrollMode.autoScrolling ? t.autoScrollStop : t.autoScrollStart}</button>`
            : ''
        }
        <button type="button" id="sc-save-btn" class="pill-action">${SVG_ICONS['save']}</button>
        <button type="button" id="sc-pin-btn" class="pill-action">${SVG_ICONS['pin']}</button>
        <button type="button" id="sc-chat-btn" class="pill-action">${t.sendChat}</button>
        <button type="button" id="sc-cancel-btn" class="pill-action">${SVG_ICONS['cancel']}</button>
        <button type="button" id="sc-done-btn" class="pill-action primary">${t.scrollCopy}</button>
      </div>
    `;

    const previewWrap = scrollDock.querySelector('.scroll-preview-wrap');
    if (previewWrap) previewWrap.scrollTop = previewWrap.scrollHeight;

    scrollDock.querySelector('#sc-auto-btn')?.addEventListener('click', () => {
      if (!session) return;
      void ipcRenderer.invoke('screenshot-overlay:scroll-toggle-auto', { sessionId: session.sessionId });
    });
    scrollDock.querySelector('#sc-save-btn')?.addEventListener('click', () => {
      if (!session) return;
      void ipcRenderer.invoke('screenshot-overlay:scroll-finish', { sessionId: session.sessionId, action: 'save' });
    });
    scrollDock.querySelector('#sc-pin-btn')?.addEventListener('click', () => {
      if (!session) return;
      void ipcRenderer.invoke('screenshot-overlay:scroll-finish', { sessionId: session.sessionId, action: 'pin' });
    });
    scrollDock.querySelector('#sc-chat-btn')?.addEventListener('click', () => {
      if (!session) return;
      void ipcRenderer.invoke('screenshot-overlay:scroll-finish', { sessionId: session.sessionId, action: 'chat' });
    });
    scrollDock.querySelector('#sc-cancel-btn')?.addEventListener('click', () => cancelSession());
    scrollDock.querySelector('#sc-done-btn')?.addEventListener('click', () => {
      if (!session) return;
      void ipcRenderer.invoke('screenshot-overlay:scroll-finish', { sessionId: session.sessionId, action: 'copy' });
    });
  }

  async function commitAction(
    action: 'copy' | 'save' | 'pin' | 'chat' | 'note',
    prompt?: string,
  ): Promise<void> {
    if (!session || !selection || committing) return;
    const exported = exportCompositedSelectionPngBase64();
    if (!exported) return;
    committing = true;
    try {
      await ipcRenderer.invoke('screenshot-overlay:commit', {
        sessionId: session.sessionId,
        displayId: session.displayId,
        action,
        rect: selection,
        pngBase64: exported.pngBase64,
        width: exported.width,
        height: exported.height,
        prompt,
      });
    } finally {
      committing = false;
    }
  }

  function cancelSession(): void {
    if (!session) return;
    ipcRenderer.send('screenshot-overlay:cancel', { sessionId: session.sessionId });
  }

  function hitResizeHandle(x: number, y: number): { handle: ResizeHandle; cursor: string } | null {
    if (!selection) return null;
    for (const h of handlePositions(selection)) {
      if (Math.abs(x - h.x) <= 7 && Math.abs(y - h.y) <= 7) {
        return { handle: h.handle, cursor: h.cursor };
      }
    }
    return null;
  }

  function pointInsideSelection(x: number, y: number): boolean {
    if (!selection) return false;
    return (
      x >= selection.x &&
      x <= selection.x + selection.width &&
      y >= selection.y &&
      y <= selection.y + selection.height
    );
  }

  function updateCursor(x: number, y: number): void {
    if (scrollMode?.active) {
      stage.style.cursor = 'default';
      return;
    }
    const handleHit = hitResizeHandle(x, y);
    if (handleHit && activeTool === 'select') {
      stage.style.cursor = handleHit.cursor;
      return;
    }
    if (selection && pointInsideSelection(x, y)) {
      if (activeTool === 'select') {
        const annHit = findHitAnnotation(history.items, x, y);
        stage.style.cursor = annHit ? 'move' : 'move';
      } else if (activeTool === 'text') {
        stage.style.cursor = 'text';
      } else {
        stage.style.cursor = 'crosshair';
      }
      return;
    }
    stage.style.cursor = 'crosshair';
  }

  window.addEventListener('mousemove', (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;

    if (scrollMode?.active && session) {
      const dockRect = scrollDock.getBoundingClientRect();
      const overDock =
        e.clientX >= dockRect.left - 8 &&
        e.clientX <= dockRect.right + 8 &&
        e.clientY >= dockRect.top - 8 &&
        e.clientY <= dockRect.bottom + 8;
      const nextIgnore = !overDock;
      if (scrollIgnoreMouse !== nextIgnore) {
        scrollIgnoreMouse = nextIgnore;
        ipcRenderer.send('screenshot-overlay:set-ignore-mouse', {
          sessionId: session.sessionId,
          displayId: session.displayId,
          ignore: nextIgnore,
        });
      }
      return;
    }

    if (!session) return;

    if (drag.kind === 'none') {
      if (!selection) {
        hoveredSnap = findTopSnapWindow(e.clientX, e.clientY, session.bounds, session.windows);
        render();
      }
      updateCursor(e.clientX, e.clientY);
      updateLoupe(e.clientX, e.clientY);
      return;
    }

    if (drag.kind === 'creating') {
      const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (dist >= 3) drag.moved = true;
      if (drag.moved) {
        let endX = e.clientX;
        let endY = e.clientY;
        if (e.shiftKey) {
          const size = Math.max(Math.abs(endX - drag.startX), Math.abs(endY - drag.startY));
          endX = drag.startX + Math.sign(endX - drag.startX || 1) * size;
          endY = drag.startY + Math.sign(endY - drag.startY || 1) * size;
        }
        selection = clampRectToBounds(normalizeRect(drag.startX, drag.startY, endX, endY), selectionBounds());
        render();
      }
      updateLoupe(e.clientX, e.clientY);
      return;
    }

    if (drag.kind === 'moving-selection') {
      selection = moveRectWithinBounds(
        drag.initial,
        e.clientX - drag.startX,
        e.clientY - drag.startY,
        selectionBounds(),
      );
      render();
      return;
    }

    if (drag.kind === 'resizing-selection') {
      selection = applyResizeHandle(
        drag.initial,
        drag.handle,
        e.clientX - drag.startX,
        e.clientY - drag.startY,
        selectionBounds(),
        e.shiftKey,
      );
      render();
      updateLoupe(e.clientX, e.clientY);
      return;
    }

    if (drag.kind === 'moving-annotation') {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) >= 1) drag.moved = true;
      const targetId = drag.itemId;
      drag.preview = drag.snapshot.map((item) =>
        item.id === targetId ? translateAnnotation(item, dx, dy) : item,
      );
      render();
      return;
    }

    if (drag.kind === 'drawing-shape' && selection) {
      const clampedX = Math.max(selection.x, Math.min(e.clientX, selection.x + selection.width));
      const clampedY = Math.max(selection.y, Math.min(e.clientY, selection.y + selection.height));
      const draft = drag.draft;
      if (draft.kind === 'rect' || draft.kind === 'ellipse') {
        let w = clampedX - draft.x;
        let h = clampedY - draft.y;
        if (e.shiftKey) {
          const s = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * s;
          h = Math.sign(h || 1) * s;
        }
        draft.width = w;
        draft.height = h;
      } else if (draft.kind === 'arrow' || draft.kind === 'line') {
        draft.x2 = clampedX;
        draft.y2 = clampedY;
      } else if (draft.kind === 'pen' || draft.kind === 'mosaic') {
        const last = draft.points[draft.points.length - 1];
        if (!last || Math.hypot(clampedX - last.x, clampedY - last.y) >= 2) {
          draft.points.push({ x: clampedX, y: clampedY });
        }
      }
      render();
    }
  });

  stage.addEventListener('mousedown', (e) => {
    if (!session || scrollMode?.active) return;
    if (e.button === 2) {
      e.preventDefault();
      if (selection && !session.initialSelection) {
        commitPendingTextEditor();
        selection = null;
        activeTool = 'select';
        history.reset();
        resultDrawer.style.display = 'none';
        askPopover.style.display = 'none';
        positionFloatingPanels();
        render();
      } else {
        cancelSession();
      }
      return;
    }
    if (e.button !== 0) return;

    commitPendingTextEditor();
    askPopover.style.display = 'none';

    ipcRenderer.send('screenshot-overlay:claim-selection', {
      sessionId: session.sessionId,
      displayId: session.displayId,
    });

    const x = e.clientX;
    const y = e.clientY;

    if (selection) {
      const handleHit = activeTool === 'select' ? hitResizeHandle(x, y) : null;
      if (handleHit) {
        drag = { kind: 'resizing-selection', startX: x, startY: y, handle: handleHit.handle, initial: { ...selection } };
        positionFloatingPanels();
        return;
      }

      if (pointInsideSelection(x, y)) {
        const hitAnn = findHitAnnotation(history.items, x, y);
        if (hitAnn && (activeTool === 'select' || (activeTool === 'text' && hitAnn.kind === 'text'))) {
          selectedAnnotationId = hitAnn.id;
          if (activeTool === 'text' && hitAnn.kind === 'text') {
            startTextEditor(hitAnn.x, hitAnn.y, hitAnn);
            return;
          }
          const snapshot = history.items.map((item) => structuredClone(item));
          drag = {
            kind: 'moving-annotation',
            startX: x,
            startY: y,
            moved: false,
            itemId: hitAnn.id,
            snapshot,
            preview: snapshot,
          };
          render();
          return;
        }

        selectedAnnotationId = null;

        if (activeTool === 'select') {
          drag = { kind: 'moving-selection', startX: x, startY: y, initial: { ...selection } };
          positionFloatingPanels();
          return;
        }

        if (activeTool === 'text') {
          startTextEditor(x, y);
          return;
        }

        if (activeTool === 'badge') {
          const next = [
            ...history.items,
            {
              id: uid(),
              kind: 'badge' as const,
              x,
              y,
              number: nextBadgeNumber(history.items),
              color: activeColor,
              strokeSize: activeSize,
            },
          ];
          history.commit(next);
          syncToolbarButtons();
          render();
          return;
        }

        let draft: AnnotationItem;
        if (activeTool === 'rect' || activeTool === 'ellipse') {
          draft = { id: uid(), kind: activeTool, x, y, width: 0, height: 0, color: activeColor, strokeSize: activeSize };
        } else if (activeTool === 'arrow' || activeTool === 'line') {
          draft = { id: uid(), kind: activeTool, x1: x, y1: y, x2: x, y2: y, color: activeColor, strokeSize: activeSize };
        } else {
          draft = { id: uid(), kind: activeTool, points: [{ x, y }], color: activeColor, strokeSize: activeSize };
        }
        drag = { kind: 'drawing-shape', tool: activeTool, draft };
        render();
        return;
      }

      // Clicked outside existing selection when no annotations exist -> allow starting a fresh selection!
      if (history.items.length === 0 && !session.initialSelection) {
        selection = null;
        resultDrawer.style.display = 'none';
        drag = { kind: 'creating', startX: x, startY: y, moved: false };
        positionFloatingPanels();
        render();
      }
      return;
    }

    drag = { kind: 'creating', startX: x, startY: y, moved: false };
  });

  window.addEventListener('mouseup', () => {
    if (!session || drag.kind === 'none') return;
    const currentDrag = drag;
    drag = { kind: 'none' };

    if (currentDrag.kind === 'creating') {
      if (!currentDrag.moved) {
        // Single click without drag -> snap to hovered window or full display!
        selection = hoveredSnap?.localRect ?? { x: 0, y: 0, ...selectionBounds() };
      } else if (selection && (selection.width < MIN_SELECTION_SIZE || selection.height < MIN_SELECTION_SIZE)) {
        selection = hoveredSnap?.localRect ?? null;
      }
      loupe.style.display = 'none';
      positionFloatingPanels();
      render();
      return;
    }

    if (currentDrag.kind === 'moving-selection' || currentDrag.kind === 'resizing-selection') {
      loupe.style.display = 'none';
      positionFloatingPanels();
      render();
      return;
    }

    if (currentDrag.kind === 'moving-annotation') {
      if (currentDrag.moved) {
        history.commit(currentDrag.preview);
        syncToolbarButtons();
      }
      render();
      return;
    }

    if (currentDrag.kind === 'drawing-shape') {
      const d = currentDrag.draft;
      const meaningful =
        d.kind === 'pen' || d.kind === 'mosaic'
          ? d.points.length >= 1
          : d.kind === 'rect' || d.kind === 'ellipse'
            ? Math.abs(d.width) >= 3 && Math.abs(d.height) >= 3
            : d.kind === 'arrow' || d.kind === 'line'
              ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) >= 4
              : true;
      if (meaningful) {
        history.commit([...history.items, d]);
        syncToolbarButtons();
      }
      render();
    }
  });

  stage.addEventListener('dblclick', (e) => {
    if (!session || !selection || scrollMode?.active) return;
    if (pointInsideSelection(e.clientX, e.clientY) && activeTool === 'select') {
      const hitAnn = findHitAnnotation(history.items, e.clientX, e.clientY);
      if (hitAnn?.kind === 'text') {
        startTextEditor(hitAnn.x, hitAnn.y, hitAnn);
        return;
      }
      void commitAction('copy');
    }
  });

  stage.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (!session) return;
    if (document.activeElement === textEditor || document.activeElement === askInput || document.activeElement?.tagName === 'TEXTAREA') {
      return;
    }

    const mod = e.metaKey || e.ctrlKey;

    if (e.key === 'Escape') {
      e.preventDefault();
      cancelSession();
      return;
    }

    if (e.key === 'Enter' && !scrollMode?.active) {
      e.preventDefault();
      if (selection) {
        void commitAction(mod ? 'chat' : 'copy');
      } else {
        ipcRenderer.send('screenshot-overlay:forward-command', {
          sessionId: session.sessionId,
          command: mod ? 'chat' : 'copy',
        });
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (selection) {
        if (e.shiftKey) history.redo();
        else history.undo();
        syncToolbarButtons();
        render();
      } else {
        ipcRenderer.send('screenshot-overlay:forward-command', {
          sessionId: session.sessionId,
          command: e.shiftKey ? 'redo' : 'undo',
        });
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      if (selection) {
        history.redo();
        syncToolbarButtons();
        render();
      } else {
        ipcRenderer.send('screenshot-overlay:forward-command', {
          sessionId: session.sessionId,
          command: 'redo',
        });
      }
      return;
    }

    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (selection) void commitAction('save');
      else ipcRenderer.send('screenshot-overlay:forward-command', { sessionId: session.sessionId, command: 'save' });
      return;
    }

    if (mod && e.key.toLowerCase() === 't') {
      e.preventDefault();
      if (selection) void commitAction('pin');
      else ipcRenderer.send('screenshot-overlay:forward-command', { sessionId: session.sessionId, command: 'pin' });
      return;
    }

    if ((e.key === 'Backspace' || e.key === 'Delete') && selectedAnnotationId) {
      e.preventDefault();
      history.commit(history.items.filter((i) => i.id !== selectedAnnotationId));
      selectedAnnotationId = null;
      syncToolbarButtons();
      render();
      return;
    }

    if (!mod && e.key.toLowerCase() === 'c' && loupe.style.display === 'block') {
      e.preventDefault();
      const val = colorFormat === 'hex' ? currentColorHex : currentColorRgb;
      void ipcRenderer.invoke('screenshot-overlay:copy-text', val);
      showToast(`${LABELS[lang].copiedColor}: ${val}`);
      return;
    }

    if (e.key === 'Tab' && loupe.style.display === 'block') {
      e.preventDefault();
      colorFormat = colorFormat === 'hex' ? 'rgb' : 'hex';
      updateLoupe(cursorX, cursorY);
      return;
    }

    if (
      selection &&
      activeTool === 'select' &&
      (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
    ) {
      e.preventDefault();
      selection = nudgeRect(selection, e.key, e.shiftKey ? 10 : 1, selectionBounds());
      positionFloatingPanels();
      render();
    }
  });

  ipcRenderer.on('screenshot-overlay:session', (_event, payload: ScreenshotOverlayPayload) => {
    session = payload;
    lang = payload.language;
    selection = payload.initialSelection ? { ...payload.initialSelection } : null;
    hoveredSnap = null;
    activeTool = 'select';
    selectedAnnotationId = null;
    editingTextState = null;
    scrollMode = null;
    scrollIgnoreMouse = null;
    committing = false;
    drag = { kind: 'none' };
    history.reset();
    mosaicCache.clear();
    textEditor.style.display = 'none';
    resultDrawer.style.display = 'none';
    askPopover.style.display = 'none';
    scrollDock.style.display = 'none';
    loupe.style.display = 'none';

    const img = new Image();
    img.onload = () => {
      bgImage = img;
      const sampler = document.createElement('canvas');
      sampler.width = payload.pixelWidth;
      sampler.height = payload.pixelHeight;
      const sctx = sampler.getContext('2d', { willReadFrequently: true });
      sctx?.drawImage(img, 0, 0, payload.pixelWidth, payload.pixelHeight);
      pixelSamplerCanvas = sampler;
      pixelSamplerCtx = sctx;
      buildToolbar();
      positionFloatingPanels();
      render();
      ipcRenderer.send('screenshot-overlay:ready', {
        sessionId: payload.sessionId,
        displayId: payload.displayId,
      });
    };
    img.src = `data:image/png;base64,${payload.pngBase64}`;
  });

  ipcRenderer.on('screenshot-overlay:clear-selection', (_event, data: { sessionId: string }) => {
    if (!session || session.sessionId !== data.sessionId) return;
    commitPendingTextEditor();
    selection = null;
    hoveredSnap = null;
    history.reset();
    toolbar.style.display = 'none';
    subbar.style.display = 'none';
    resultDrawer.style.display = 'none';
    askPopover.style.display = 'none';
    render();
  });

  ipcRenderer.on('screenshot-overlay:scroll-progress', (_event, progress: ScrollCaptureProgress) => {
    if (!session || session.sessionId !== progress.sessionId) return;
    scrollMode = progress;
    renderScrollDock();
    render();
  });

  ipcRenderer.on(
    'screenshot-overlay:remote-command',
    (_event, data: { sessionId: string; command: 'copy' | 'chat' | 'save' | 'pin' | 'undo' | 'redo' }) => {
      if (!session || session.sessionId !== data.sessionId || !selection || scrollMode?.active) return;
      if (data.command === 'undo') {
        commitPendingTextEditor();
        history.undo();
        syncToolbarButtons();
        render();
      } else if (data.command === 'redo') {
        commitPendingTextEditor();
        history.redo();
        syncToolbarButtons();
        render();
      } else {
        void commitAction(data.command);
      }
    },
  );
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootOverlay, { once: true });
} else {
  bootOverlay();
}
