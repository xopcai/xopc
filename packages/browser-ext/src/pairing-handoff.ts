const messageType = 'browser/stage-pairing-invite';

function hasPairingPayload(): boolean {
  return new URLSearchParams(location.hash.slice(1)).has('p');
}

async function stage(open: boolean): Promise<{ ok?: boolean; error?: string }> {
  return chrome.runtime.sendMessage({
    type: messageType,
    pairingLink: location.href,
    open,
  }) as Promise<{ ok?: boolean; error?: string }>;
}

function mountOpenButton(): void {
  if (document.getElementById('xopc-browser-pairing-handoff')) return;
  const host = document.createElement('div');
  host.id = 'xopc-browser-pairing-handoff';
  const root = host.attachShadow({ mode: 'closed' });
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Open xopc extension';
  button.style.cssText = [
    'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483647',
    'border:0', 'border-radius:10px', 'padding:12px 18px',
    'background:#2563eb', 'color:#fff', 'font:600 14px/20px system-ui,sans-serif',
    'box-shadow:0 8px 24px rgba(15,23,42,.24)', 'cursor:pointer',
  ].join(';');
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Opening…';
    void stage(true).then((result) => {
      button.textContent = result.ok ? 'Opened — approve in Gateway' : (result.error || 'Could not open xopc');
      button.disabled = false;
    }).catch(() => {
      button.textContent = 'Could not open xopc';
      button.disabled = false;
    });
  });
  root.append(button);
  document.documentElement.append(host);
}

if (hasPairingPayload()) {
  void stage(false).catch(() => undefined);
  mountOpenButton();
}
