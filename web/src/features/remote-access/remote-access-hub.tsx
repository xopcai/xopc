import { ArrowRight, Smartphone } from 'lucide-react';
import { useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PageTabs, type PageTabItem } from '@/components/ui/page-tabs';
import { fetchMobilePairingReadiness } from '@/features/endpoint-tools/mobile-device-api';
import { RemoteAccessDocsLink } from '@/features/remote-access/remote-access-docs-link';
import { RemoteAccessGuideTab } from '@/features/remote-access/remote-access-guide-tab';
import { RemoteAccessLanTab } from '@/features/remote-access/remote-access-lan-tab';
import { RemoteAccessSshTab } from '@/features/remote-access/remote-access-ssh-tab';
import {
  REMOTE_ACCESS_TABS,
  parseRemoteAccessTab,
  type RemoteAccessTabId,
} from '@/features/remote-access/remote-access-tabs';
import { ReverseProxySection } from '@/features/remote-access/reverse-proxy-section';
import { TailscaleServeSection } from '@/features/remote-access/tailscale-serve-section';
import { TunnelSettingsPanel } from '@/features/tunnel/tunnel-settings';
import {
  SettingsPageFrame,
  SettingsPageHeader,
  SettingsTabPanel,
} from '@/features/settings/settings-page-layout';
import type { RemoteAccessDocsSection } from '@/navigation';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function tabLabel(ra: ReturnType<typeof messages>['remoteAccess'], tab: RemoteAccessTabId): string {
  return ra.tabs[tab];
}

function tabIntro(ra: ReturnType<typeof messages>['remoteAccess'], tab: RemoteAccessTabId): string {
  return ra.tabIntro[tab];
}

function tabDocsSection(tab: RemoteAccessTabId): RemoteAccessDocsSection | undefined {
  switch (tab) {
    case 'tailscale':
      return 'tailscale-serve';
    case 'public':
      return 'public-tunnel';
    case 'reverse-proxy':
      return 'reverse-proxy';
    case 'ssh':
      return 'ssh-tunnel';
    case 'lan':
      return 'lan';
    default:
      return undefined;
  }
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
    case 'reverse-proxy':
      return <ReverseProxySection />;
    case 'ssh':
      return <RemoteAccessSshTab />;
    case 'lan':
      return <RemoteAccessLanTab />;
  }
}

export function RemoteAccessHub() {
  const navigate = useNavigate();
  const language = useLocaleStore((s) => s.language);
  const ra = messages(language).remoteAccess;
  const hasToken = Boolean(useGatewayStore((s) => s.token));
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = parseRemoteAccessTab(searchParams.get('tab'));
  const pairingIntent = searchParams.get('intent') === 'mobile-pairing';
  const pairingReadiness = useSWR(
    pairingIntent ? 'mobile-pairing-readiness' : null,
    fetchMobilePairingReadiness,
    { refreshInterval: 2_000 },
  );

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
  const tabItems: PageTabItem<RemoteAccessTabId>[] = REMOTE_ACCESS_TABS.map((tab) => ({
    id: tab,
    label: tabLabel(ra, tab),
  }));

  return (
    <SettingsPageFrame>
      <SettingsPageHeader
        title={ra.pageTitle}
        subtitle={ra.pageSubtitle}
        meta={
          <RemoteAccessDocsLink
            language={language}
            label={ra.docsLink}
            section={tabDocsSection(activeTab)}
            className="mt-1"
          />
        }
      />

      {!hasToken ? (
        <p className="text-sm text-fg-muted">{ra.guide.needToken}</p>
      ) : (
        <>
          {pairingIntent ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3">
              <div className="flex min-w-0 items-start gap-3">
                <Smartphone className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-fg">{ra.mobilePairingFlow.title}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">
                    {pairingReadiness.data?.ready
                      ? ra.mobilePairingFlow.ready
                      : ra.mobilePairingFlow.hint}
                  </p>
                </div>
              </div>
              <Button
                variant="primary"
                disabled={!pairingReadiness.data?.ready}
                onClick={() => navigate('/settings/devices?startMobilePairing=1')}
              >
                {pairingReadiness.data?.ready
                  ? ra.mobilePairingFlow.continue
                  : ra.mobilePairingFlow.waiting}
                <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          ) : null}
          <PageTabs
            items={tabItems}
            activeTab={activeTab}
            onChange={setActiveTab}
            ariaLabel={ra.tabsAria}
            tabIdPrefix="remote-access-tab"
            panelIdPrefix="remote-access-panel"
          />

          <SettingsTabPanel
            id={activeTab}
            activeTab={activeTab}
            tabIdPrefix="remote-access-tab"
            panelIdPrefix="remote-access-panel"
            title={tabLabel(ra, activeTab)}
            hint={activeTab !== 'public' ? intro : undefined}
          >
            <RemoteAccessTabPanel tab={activeTab} onOpenTab={setActiveTab} />
          </SettingsTabPanel>
        </>
      )}
    </SettingsPageFrame>
  );
}
