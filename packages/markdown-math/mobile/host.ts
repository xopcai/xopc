import MarkdownIt from 'markdown-it';
import { markdownItMath } from '../src/markdownIt';

interface Payload { revision: number; markdown: string; streaming: boolean; dark: boolean; fontSize: number; color?: string; }
interface Bridge { postMessage(message: string): void; }
declare global {
  interface Window { xopcMath: { update(payload: Payload): void }; XopcMathBridge?: Bridge;
    webkit?: { messageHandlers: { math?: Bridge } }; }
}

const markdown = new MarkdownIt({ html: false, breaks: true });
markdownItMath(markdown);
let revision = 0;
const root = document.getElementById('content')!;
function report(): void {
  const message = JSON.stringify({ revision, height: Math.ceil(root.getBoundingClientRect().height),
    ready: root.querySelectorAll('[data-xopc-math="ready"]').length,
    pending: root.querySelectorAll('[data-xopc-math="pending"]').length,
    fontsLoaded: document.fonts.status === 'loaded' && document.fonts.check('16px KaTeX_Main') });
  window.XopcMathBridge?.postMessage(message);
  window.webkit?.messageHandlers.math?.postMessage(message);
}
window.xopcMath = {
  update(payload) {
    if (!Number.isSafeInteger(payload.revision) || typeof payload.markdown !== 'string') return;
    revision = payload.revision;
    document.body.style.color = payload.color && /^#[\da-f]{6}$/i.test(payload.color)
      ? payload.color : payload.dark ? '#e2e8f0' : '#1e293b';
    document.body.style.fontSize = `${Math.min(48, Math.max(12, payload.fontSize))}px`;
    root.innerHTML = markdown.render(payload.markdown, { streaming: payload.streaming });
    requestAnimationFrame(report);
    void document.fonts.ready.then(report);
  },
};
new ResizeObserver(report).observe(root);
document.addEventListener('click', event => {
  const link = (event.target as HTMLElement).closest('a');
  if (link) {
    event.preventDefault();
    const message = JSON.stringify({ revision, href: link.getAttribute('href') });
    window.XopcMathBridge?.postMessage(message);
    window.webkit?.messageHandlers.math?.postMessage(message);
  }
});
