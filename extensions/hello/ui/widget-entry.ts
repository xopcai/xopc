/**
 * Chat widget: tool result + theme; uses ui.onWidgetResult for host data.
 */
import { createExtensionClient } from '@xopcai/extension-ui-sdk';

function applyThemeTokens(tokens: Record<string, string> | undefined) {
  if (!tokens) return;
  for (const [key, value] of Object.entries(tokens)) {
    if (typeof value === 'string' && value.trim()) {
      const k = key.startsWith('--') ? key : `--${key}`;
      document.documentElement.style.setProperty(k, value);
    }
  }
}

function format(data: unknown): string {
  if (data == null) return '(empty)';
  if (typeof data === 'string') {
    const t = data.trim();
    try {
      const o = JSON.parse(t) as Record<string, unknown>;
      if (o && typeof o === 'object') {
        if ('message' in o) return String(o.message);
        if ('result' in o) return String(o.result);
        if ('greeting' in o) return String(o.greeting);
      }
    } catch {
      /* plain string */
    }
    return data;
  }
  return JSON.stringify(data);
}

async function main() {
  const client = createExtensionClient();
  await client.whenReady();

  const out = document.getElementById('result-text');
  if (!out) return;

  const t = await client.theme.getTheme();
  applyThemeTokens(t.tokens);

  client.theme.onThemeChange((th) => applyThemeTokens(th.tokens));

  client.ui.onWidgetResult((data) => {
    out.textContent = format(data);
    client.ui.resize(document.body.scrollHeight + 8);
  });

  client.ui.resize(document.body.scrollHeight + 8);
}

void main().catch((e) => {
  const out = document.getElementById('result-text');
  if (out) out.textContent = String(e);
});
