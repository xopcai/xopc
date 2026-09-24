import { lazy, Suspense, useCallback, useLayoutEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { Skeleton } from '@/components/ui/skeleton';
import {
  CapabilityHeaderActions,
  type CapabilityHeaderActionChange,
  type CapabilityHeaderContribution,
} from '@/features/capabilities/capability-header-actions';
import { messages } from '@/i18n/messages';
import {
  CAPABILITY_SECTIONS,
  type CapabilitySection,
} from '@/navigation/product-navigation';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const SkillsPage = lazy(() => import('@/features/skills/skills-page').then(module => ({ default: module.SkillsPage })));
const ConnectorsPage = lazy(() => import('@/features/connectors/connectors-page').then(module => ({ default: module.ConnectorsPage })));
const ExtensionsPage = lazy(() => import('@/pages/apps-page').then(module => ({ default: module.ExtensionsPage })));
const AgentsPage = lazy(() => import('@/features/settings/agents').then(module => ({ default: module.AgentsSettingsPanel })));
const ChannelsPage = lazy(() => import('@/features/settings/channels').then(module => ({ default: module.ChannelsSettingsPanel })));
const CapabilityDiscoverPage = lazy(() => import('./capability-discover-page').then(module => ({ default: module.CapabilityDiscoverPage })));

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
  const setPageHeader = usePageHeaderStore(state => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore(state => state.clearPageHeader);
  const [headerContribution, setHeaderContribution] = useState<{ section: CapabilitySection; value: CapabilityHeaderContribution | null }>({ section, value: null });
  const currentContribution = headerContribution.section === section ? headerContribution.value : null;
  const onHeaderActionChange = useCallback<CapabilityHeaderActionChange>((value) => {
    setHeaderContribution({ section, value });
  }, [section]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: null,
      end: <CapabilityHeaderActions contribution={currentContribution} />,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, currentContribution, setPageHeader]);

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
