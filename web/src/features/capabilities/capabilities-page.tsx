import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageTabs } from '@/components/ui/page-tabs';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CapabilityHeaderActions,
  type CapabilityHeaderActionChange,
  type CapabilityHeaderContribution,
} from '@/features/capabilities/capability-header-actions';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const SkillsPage = lazy(() => import('@/features/skills/skills-page').then(module => ({ default: module.SkillsPage })));
const ConnectorsPage = lazy(() => import('@/features/connectors/connectors-page').then(module => ({ default: module.ConnectorsPage })));
const ExtensionsPage = lazy(() => import('@/pages/apps-page').then(module => ({ default: module.ExtensionsPage })));
const AgentsPage = lazy(() => import('@/features/settings/agents').then(module => ({ default: module.AgentsSettingsPanel })));
const ChannelsPage = lazy(() => import('@/features/settings/channels').then(module => ({ default: module.ChannelsSettingsPanel })));
const CapabilityDiscoverPage = lazy(() => import('./capability-discover-page').then(module => ({ default: module.CapabilityDiscoverPage })));

export const CAPABILITY_SECTIONS = ['discover', 'skills', 'connectors', 'channels', 'agents', 'extensions'] as const;
export type CapabilitySection = typeof CAPABILITY_SECTIONS[number];

export function capabilityPath(section: CapabilitySection): string {
  return `/capabilities/${section}`;
}

function parseCapabilitySection(value: string | undefined): CapabilitySection {
  return CAPABILITY_SECTIONS.includes(value as CapabilitySection) ? value as CapabilitySection : 'discover';
}

function CapabilityContentFallback({ label }: { label: string }) {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 pb-7 pt-3 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:px-8 lg:pb-9 lg:pt-4" aria-label={label} aria-busy>
      {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}
    </div>
  );
}

export function CapabilitiesPage() {
  const language = useLocaleStore(state => state.language);
  const copy = messages(language).capabilitiesHub;
  const { section: sectionParam, detailId } = useParams<{ section?: string; detailId?: string }>();
  const section = parseCapabilitySection(sectionParam);
  const navigate = useNavigate();
  const setPageHeader = usePageHeaderStore(state => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore(state => state.clearPageHeader);
  const [headerContribution, setHeaderContribution] = useState<{ section: CapabilitySection; value: CapabilityHeaderContribution | null }>({ section, value: null });
  const currentContribution = headerContribution.section === section ? headerContribution.value : null;
  const onHeaderActionChange = useCallback<CapabilityHeaderActionChange>((value) => {
    setHeaderContribution({ section, value });
  }, [section]);

  const tabs = useMemo(() => [
    { id: 'discover' as const, label: copy.tabDiscover },
    { id: 'skills' as const, label: copy.tabSkills },
    { id: 'connectors' as const, label: copy.tabConnectors },
    { id: 'channels' as const, label: copy.tabChannels },
    { id: 'agents' as const, label: copy.tabAgents },
    { id: 'extensions' as const, label: copy.tabExtensions },
  ], [copy.tabAgents, copy.tabChannels, copy.tabConnectors, copy.tabDiscover, copy.tabExtensions, copy.tabSkills]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="sr-only">{copy.title}</h1>
          <div className="hidden xl:block">
            <PageTabs
              items={tabs}
              activeTab={section}
              onChange={next => navigate(capabilityPath(next))}
              ariaLabel={copy.navAria}
              tabIdPrefix="capabilities-tab"
              panelIdPrefix="capabilities-panel"
              className="pb-0"
              buttonClassName="h-9 py-1.5"
            />
          </div>
          <PopoverSelect
            value={section}
            options={tabs.map(tab => ({ value: tab.id, label: tab.label }))}
            placeholder={copy.tabDiscover}
            allowEmpty={false}
            ariaLabel={copy.navAria}
            triggerClassName="h-9 w-auto min-w-[7.5rem] bg-surface-panel xl:hidden"
            contentClassName="min-w-[12rem]"
            onChange={next => navigate(capabilityPath(next as CapabilitySection))}
          />
        </div>
      ),
      end: <CapabilityHeaderActions contribution={currentContribution} />,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, copy.navAria, copy.tabDiscover, copy.title, currentContribution, navigate, section, setPageHeader, tabs]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <Suspense fallback={<CapabilityContentFallback label={copy.discoverLoading} />}>
        {section === 'discover' ? <CapabilityDiscoverPage onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'agents' ? <AgentsPage agentId={detailId} onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'skills' ? <SkillsPage embedded onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'connectors' ? <ConnectorsPage embedded onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'channels' ? <ChannelsPage channelId={detailId} onHeaderActionChange={onHeaderActionChange} /> : null}
        {section === 'extensions' ? <ExtensionsPage embedded onHeaderActionChange={onHeaderActionChange} /> : null}
      </Suspense>
    </div>
  );
}
