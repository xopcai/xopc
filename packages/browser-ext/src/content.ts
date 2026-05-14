/**
 * Content Script — injected into web pages for visual feedback.
 *
 * Provides xopc page-level visual feedback:
 * - Overlay status indicator (operating / completed / idle)
 * - Click ripple animation
 * - Hover highlight on elements
 * - Input flash on fill
 * - Scroll direction indicator
 */

// ── Overlay ──────────────────────────────────────────────────────────

type OverlayStatus = 'operating' | 'completed' | 'hidden';

const OVERLAY_HOST_ID = 'xopc-overlay-host';
let overlayHost: HTMLDivElement | null = null;
let overlayInner: HTMLDivElement | null = null;
let completedTimer: ReturnType<typeof setTimeout> | null = null;

function ensureOverlay(): void {
  if (overlayHost?.isConnected && overlayInner) return;
  removeOverlay();

  const existing = document.getElementById(OVERLAY_HOST_ID);
  if (existing) existing.remove();

  overlayHost = document.createElement('div');
  overlayHost.id = OVERLAY_HOST_ID;

  const shadow = overlayHost.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2147483647; pointer-events: none; }
    .overlay { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
    .overlay.operating { border: 2px solid rgba(59, 130, 246, 0.6); animation: pulse 2s ease-in-out infinite; }
    .overlay.completed { border: 2px solid rgba(34, 197, 94, 0.6); }
    .badge { position: fixed; top: 8px; right: 8px; padding: 4px 12px; border-radius: 12px; font: 500 12px -apple-system, sans-serif; color: white; opacity: 0; transform: translateY(-8px); animation: badge-in 0.3s ease forwards; }
    .badge.operating { background: rgba(59, 130, 246, 0.85); backdrop-filter: blur(8px); }
    .badge.completed { background: rgba(34, 197, 94, 0.85); backdrop-filter: blur(8px); }
    .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: white; margin-right: 6px; vertical-align: middle; }
    .badge.operating .dot { animation: dot-pulse 1.2s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { border-color: rgba(59, 130, 246, 0.3); } 50% { border-color: rgba(59, 130, 246, 0.8); } }
    @keyframes badge-in { to { opacity: 1; transform: translateY(0); } }
    @keyframes dot-pulse { 0%, 100% { opacity: 0.4; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.2); } }
  `;
  shadow.appendChild(style);

  overlayInner = document.createElement('div');
  overlayInner.className = 'overlay';
  shadow.appendChild(overlayInner);
  document.documentElement.appendChild(overlayHost);
}

function removeOverlay(): void {
  if (completedTimer) { clearTimeout(completedTimer); completedTimer = null; }
  overlayInner = null;
  if (overlayHost) { overlayHost.remove(); overlayHost = null; }
  document.documentElement.style.cursor = '';
}

function showOverlay(status: OverlayStatus): void {
  if (completedTimer) { clearTimeout(completedTimer); completedTimer = null; }
  if (status === 'hidden') { removeOverlay(); return; }

  ensureOverlay();
  if (!overlayInner) return;

  overlayInner.innerHTML = '';
  overlayInner.className = `overlay ${status}`;

  const badge = document.createElement('div');
  badge.className = `badge ${status}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  badge.appendChild(dot);
  badge.appendChild(document.createTextNode(status === 'operating' ? '🤖 xopc' : '✅ Done'));
  overlayInner.appendChild(badge);

  document.documentElement.style.cursor = status === 'operating' ? 'not-allowed' : '';

  if (status === 'completed') {
    completedTimer = setTimeout(removeOverlay, 2000);
  }
}

// ── Click Ripple ─────────────────────────────────────────────────────

function showClickRipple(x: number, y: number): void {
  if (!document.getElementById('xopc-ripple-style')) {
    const s = document.createElement('style');
    s.id = 'xopc-ripple-style';
    s.textContent = `@keyframes xopc-ripple { 0% { transform: scale(0.3); opacity: 1; } 100% { transform: scale(2.5); opacity: 0; } }`;
    document.head.appendChild(s);
  }

  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', left: `${x - 15}px`, top: `${y - 15}px`,
    width: '30px', height: '30px', borderRadius: '50%',
    background: 'rgba(59, 130, 246, 0.4)', border: '2px solid rgba(59, 130, 246, 0.7)',
    pointerEvents: 'none', zIndex: '2147483646',
    animation: 'xopc-ripple 0.6s ease-out forwards',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 600);
}

// ── Hover Highlight ──────────────────────────────────────────────────

function showHoverHighlight(selector: string): void {
  const element = document.querySelector(selector);
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', left: `${rect.left - 2}px`, top: `${rect.top - 2}px`,
    width: `${rect.width + 4}px`, height: `${rect.height + 4}px`,
    border: '2px solid rgba(59, 130, 246, 0.6)', borderRadius: '4px',
    background: 'rgba(59, 130, 246, 0.08)', pointerEvents: 'none',
    zIndex: '2147483645', transition: 'opacity 0.3s ease', opacity: '1',
  });
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 800);
}

// ── Input Flash ──────────────────────────────────────────────────────

function showInputFlash(selector: string): void {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return;
  const orig = el.style.backgroundColor;
  el.style.transition = 'background-color 0.15s ease';
  el.style.backgroundColor = 'rgba(34, 197, 94, 0.15)';
  setTimeout(() => { el.style.backgroundColor = orig; }, 300);
}

// ── Scroll Indicator ─────────────────────────────────────────────────

function showScrollIndicator(direction: 'up' | 'down'): void {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'fixed', right: '20px', [direction === 'down' ? 'bottom' : 'top']: '20px',
    width: '36px', height: '36px', borderRadius: '50%',
    background: 'rgba(59, 130, 246, 0.85)', color: 'white',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '18px', fontWeight: 'bold', pointerEvents: 'none',
    zIndex: '2147483646', opacity: '0',
    transform: `translateY(${direction === 'down' ? '10px' : '-10px'})`,
    transition: 'opacity 0.2s ease, transform 0.2s ease',
  });
  el.textContent = direction === 'down' ? '↓' : '↑';
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, 600);
}

// ── Message handler ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: { type: string; [key: string]: unknown }, _sender, sendResponse) => {
    switch (message.type) {
      case 'content/show-overlay': showOverlay(message.status as OverlayStatus); break;
      case 'content/hide-overlay': removeOverlay(); break;
      case 'content/show-click-ripple': showClickRipple(message.x as number, message.y as number); break;
      case 'content/show-hover-highlight': showHoverHighlight(message.selector as string); break;
      case 'content/show-input-flash': showInputFlash(message.selector as string); break;
      case 'content/show-scroll-indicator': showScrollIndicator(message.direction as 'up' | 'down'); break;
      default: sendResponse({ ok: false }); return true;
    }
    sendResponse({ ok: true });
    return true;
  },
);

// ── Heartbeat ────────────────────────────────────────────────────────

setInterval(() => {
  if (!chrome.runtime?.id) return;
  chrome.runtime.sendMessage({ type: 'content/heartbeat' }).catch(() => {});
}, 30_000);
