export type SidePanelTheme = 'light' | 'dark';

type PageTheme = {
  theme?: string;
};

function isSidePanelTheme(value: unknown): value is SidePanelTheme {
  return value === 'light' || value === 'dark';
}

export function applySidePanelTheme(theme: SidePanelTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function applySystemSidePanelTheme(): void {
  applySidePanelTheme(globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

export function isGatewayThemePageUrl(value: string, gatewayUrl?: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) {
      return true;
    }
    return Boolean(gatewayUrl && url.origin === new URL(gatewayUrl).origin);
  } catch {
    return false;
  }
}

async function pageTheme(tabId: number): Promise<SidePanelTheme | undefined> {
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript<[], PageTheme>({
      target: { tabId },
      func: () => ({
        theme: document.documentElement.dataset.theme,
      }),
    });
    return isSidePanelTheme(result?.theme) ? result.theme : undefined;
  } catch {
    return undefined;
  }
}

/** Match the side panel to the authenticated Gateway UI when one is open. */
export async function syncSidePanelTheme(gatewayUrl?: string): Promise<void> {
  const tabs = (await chrome.tabs.query({}))
    .filter((tab): tab is chrome.tabs.Tab & { id: number; url: string } => {
      return typeof tab.id === 'number' && Boolean(tab.url)
        && isGatewayThemePageUrl(tab.url!, gatewayUrl);
    })
    .sort((left, right) => Number(right.active) - Number(left.active));

  for (const tab of tabs) {
    const theme = await pageTheme(tab.id);
    if (theme) {
      applySidePanelTheme(theme);
      return;
    }
  }
}

export function watchSidePanelTheme(gatewayUrl?: string): () => void {
  const sync = () => { void syncSidePanelTheme(gatewayUrl); };
  const onUpdated = (_tabId: number, change: chrome.tabs.TabChangeInfo) => {
    if (change.status === 'complete' || change.url) sync();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') sync();
  };

  sync();
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', onVisibilityChange);
  chrome.tabs.onActivated.addListener(sync);
  chrome.tabs.onUpdated.addListener(onUpdated);
  return () => {
    window.removeEventListener('focus', sync);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    chrome.tabs.onActivated.removeListener(sync);
    chrome.tabs.onUpdated.removeListener(onUpdated);
  };
}
