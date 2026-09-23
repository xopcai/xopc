import {
  CHAT_PREVIEW_RUNTIME_SOURCE,
  CHAT_PREVIEW_RUNTIME_VERSION,
  ChatPreviewRuntimeMessageSchema,
  type ChatPreviewRevision,
  type ChatPreviewRuntimeMessage,
} from '@xopcai/gateway-contract';

function escapeClosingTag(value: string, tag: 'script' | 'style'): string {
  return value.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);
}

export function parseChatPreviewRuntimeMessage(value: unknown): ChatPreviewRuntimeMessage | null {
  const parsed = ChatPreviewRuntimeMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function buildChatPreviewSrcDoc(revision: ChatPreviewRevision, channel: string): string {
  const runtime = `(() => {
    const channel = ${JSON.stringify(channel)};
    const bufferedErrors = [];
    const send = (type, detail = {}) => parent.postMessage({
      source: ${JSON.stringify(CHAT_PREVIEW_RUNTIME_SOURCE)},
      version: ${CHAT_PREVIEW_RUNTIME_VERSION}, channel, type, ...detail
    }, '*');
    const resize = () => send('resize', { height: Math.max(120, Math.min(2000,
      Math.ceil(document.documentElement.getBoundingClientRect().height))) });
    const report = (diagnostic) => { bufferedErrors.push(diagnostic); send('error', { diagnostic }); };
    addEventListener('error', (event) => report({
      kind: 'script_error', message: String(event.message || 'Script error'),
      filename: event.filename || undefined, line: event.lineno || undefined,
      column: event.colno || undefined
    }));
    addEventListener('unhandledrejection', (event) => report({
      kind: 'unhandled_rejection', message: String(event.reason?.message || event.reason || 'Unhandled rejection')
    }));
    addEventListener('DOMContentLoaded', () => {
      resize(); new ResizeObserver(resize).observe(document.documentElement);
      setTimeout(() => {
        send('ready');
        bufferedErrors.forEach((diagnostic) => send('error', { diagnostic }));
      }, 100);
    });
  })();`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;min-height:100%;background:#fff;color:#111827;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}*{box-sizing:border-box}${escapeClosingTag(revision.styles, 'style')}</style>
</head><body>${revision.markup}
<script>${escapeClosingTag(runtime, 'script')}</script>
<script>${escapeClosingTag(revision.script, 'script')}</script>
</body></html>`;
}

export function attachChatPreviewChannel(
  iframe: HTMLIFrameElement,
  channel: string,
  onMessage: (message: ChatPreviewRuntimeMessage) => void,
): () => void {
  const listener = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) return;
    const message = parseChatPreviewRuntimeMessage(event.data);
    if (!message || message.channel !== channel) return;
    onMessage(message);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
