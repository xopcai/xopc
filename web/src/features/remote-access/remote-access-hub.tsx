import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import { TunnelSettingsPanel } from '@/features/tunnel/tunnel-settings';
import { TailscaleServeSection } from '@/features/remote-access/tailscale-serve-section';
import { RemoteAccessAdvancedTab } from '@/features/remote-access/remote-access-advanced-tab';
import { RemoteAccessGuideTab } from '@/features/remote-access/remote-access-guide-tab';
import {
  REMOTE_ACCESS_TABS,
  parseRemoteAccessTab,
  type RemoteAccessTabId,
} from '@/features/remote-access/remote-access-tabs';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function tabLabel(ra: ReturnType<typeof messages>['remoteAccess'], tab: RemoteAccessTabId): string {
  return ra.tabs[tab];
}

function tabIntro(ra: ReturnType<typeof messages>['remoteAccess'], tab: RemoteAccessTabId): string {
  return ra.tabIntro[tab];
}

function RemoteAccessTabPanel({
  tab,
  onOpenTab,
}: {
  tab: RemoteAccessTabId;
  onOpenTab: (tab: RemoteAccessTabId) => void;
}) {
  switch (tab) {
    case 'guide':
      return <RemoteAccessGuideTab onOpenTab={onOpenTab} />;
    case 'tailscale':
      return <TailscaleServeSection embedded />;
    case 'public':
      return <TunnelSettingsPanel embedded />;
    case 'advanced':
      return <RemoteAccessAdvancedTab />;
  }
}

export function RemoteAccessHub() {
  const language = useLocaleStore((s) => s.language);
  const ra = messages(language).remoteAccess;
  const hasToken = Boolean(useGatewayStore((s) => s.token));
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = parseRemoteAccessTab(searchParams.get('tab'));

  const setActiveTab = useCallback(
    (tab: RemoteAccessTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'guide') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const intro = tabIntro(ra, activeTab);

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-5 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold text-fg">{ra.pageTitle}</h1>
        <p className="mt-1 text-sm text-fg-muted">{ra.pageSubtitle}</p>
      </div>

      {!hasToken ? (
        <p className="text-sm text-fg-muted">{ra.guide.needToken}</p>
      ) : (
        <div
          className="flex flex-col gap-5"
          role="tablist"
          aria-label={ra.tabsAria}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const idx = REMOTE_ACCESS_TABS.indexOf(activeTab);
            const delta = e.key === 'ArrowRight' ? 1 : -1;
            const next =
              REMOTE_ACCESS_TABS[(idx + delta + REMOTE_ACCESS_TABS.length) % REMOTE_ACCESS_TABS.length];
            setActiveTab(next);
          }}
        >
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {REMOTE_ACCESS_TABS.map((tab) => {
              const selected = tab === activeTab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  id={`remote-access-tab-${tab}`}
                  aria-controls={`remote-access-panel-${tab}`}
                  className={cn(
                    'shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    selected
                      ? 'bg-accent-soft text-accent-fg'
                      : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
                  )}
                  onClick={() => setActiveTab(tab)}
                >
                  {tabLabel(ra, tab)}
                </button>
              );
            })}
          </div>

          {activeTab !== 'public' ? (
            <p className="text-sm leading-relaxed text-fg-muted">{intro}</p>
          ) : null}

          <div
            role="tabpanel"
            id={`remote-access-panel-${activeTab}`}
            aria-labelledby={`remote-access-tab-${activeTab}`}
            className="min-w-0"
          >
            <RemoteAccessTabPanel tab={activeTab} onOpenTab={setActiveTab} />
          </div>
        </div>
      )}
    </div>
  );
}
