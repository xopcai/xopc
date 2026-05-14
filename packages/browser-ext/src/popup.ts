/**
 * Popup script — displays extension status and connection controls.
 */

function updateUI(status: { connected: boolean; url?: string }): void {
  const dot = document.getElementById('status-dot')!;
  const label = document.getElementById('status-label')!;
  const urlEl = document.getElementById('server-url')!;
  const connectBtn = document.getElementById('btn-connect')!;
  const disconnectBtn = document.getElementById('btn-disconnect')!;

  if (status.connected) {
    dot.className = 'dot connected';
    label.textContent = 'Connected';
    connectBtn.classList.add('hidden');
    disconnectBtn.classList.remove('hidden');
  } else {
    dot.className = 'dot disconnected';
    label.textContent = 'Disconnected';
    connectBtn.classList.remove('hidden');
    disconnectBtn.classList.add('hidden');
  }

  urlEl.textContent = status.url ?? 'ws://127.0.0.1:19820/browser-ext';
}

async function getStatus(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'popup/get-status' });
  updateUI(response);
}

document.getElementById('btn-connect')?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'popup/connect' });
  setTimeout(getStatus, 500);
});

document.getElementById('btn-disconnect')?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'popup/disconnect' });
  setTimeout(getStatus, 200);
});

getStatus();
