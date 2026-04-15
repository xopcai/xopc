/**
 * Settings panel demo: config + theme + notifications.
 */
import { createExtensionClient } from '@xopcai/extension-ui-sdk';

async function main() {
  const client = createExtensionClient();
  await client.whenReady();

  const root = document.body;
  root.innerHTML = '';
  root.style.cssText =
    'font-family:system-ui,sans-serif;margin:0;padding:14px;font-size:13px;line-height:1.45;';

  const h = document.createElement('h1');
  h.style.cssText = 'margin:0 0 10px;font-size:15px;';
  h.textContent = 'Hello — Settings (SDK)';
  root.appendChild(h);

  const pre = document.createElement('pre');
  pre.style.cssText =
    'padding:10px;border-radius:8px;background:rgba(0,0,0,.06);font-size:11px;max-height:10rem;overflow:auto;white-space:pre-wrap;';
  root.appendChild(pre);

  async function refresh() {
    try {
      const c = await client.config.getExtensionConfig();
      pre.textContent = JSON.stringify(c, null, 2);
    } catch (e) {
      pre.textContent = String(e);
    }
  }

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:10px 0;align-items:center;';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.placeholder = 'greeting';
  inp.value = 'Hello';
  inp.style.cssText = 'padding:6px 8px;border-radius:6px;border:1px solid #ccc;min-width:8rem;';

  const b1 = document.createElement('button');
  b1.type = 'button';
  b1.textContent = 'Load config';
  b1.onclick = () => void refresh();

  const b2 = document.createElement('button');
  b2.type = 'button';
  b2.textContent = 'Save greeting';
  b2.onclick = async () => {
    await client.config.setExtensionConfig({ greeting: inp.value });
    await refresh();
  };

  const b3 = document.createElement('button');
  b3.type = 'button';
  b3.textContent = 'Toast';
  b3.onclick = async () => {
    await client.ui.showNotification({ type: 'success', title: 'Hello settings', message: 'Saved from SDK.' });
  };

  row.appendChild(b1);
  row.appendChild(inp);
  row.appendChild(b2);
  row.appendChild(b3);
  root.appendChild(row);

  client.theme.onThemeChange((t) => {
    document.documentElement.dataset.mode = t.mode === 'dark' ? 'dark' : 'light';
  });

  await refresh();
  client.ui.resize(document.body.scrollHeight + 20);
}

void main().catch((e) => {
  document.body.innerHTML = `<pre>${String(e)}</pre>`;
});
