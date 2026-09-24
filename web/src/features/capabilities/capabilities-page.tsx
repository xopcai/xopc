import { lazy, Suspense, useCallback, useLayoutEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { PageTabs } from '@/components/ui/page-tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { usePageHeaderStore } from '@/stores/page-header-store';

const SkillsPage = lazy(() => import('@/features/skills/skills-page').then(module => ({ default: module.SkillsPage })));
const ConnectorsPage = lazy(() => import('@/features/connectors/connectors-page').then(module => ({ default: module.ConnectorsPage })));
const ExtensionsPage = lazy(() => import('@/pages/apps-page').then(module => ({ default: module.ExtensionsPage })));
const CapabilityDiscoverPage = lazy(() => import('./capability-discover-page').then(module => ({ default: module.CapabilityDiscoverPage })));

export const CAPABILITY_SECTIONS = ['discover', 'skills', 'connectors', 'extensions'] as const;
export type CapabilitySection = typeof CAPABILITY_SECTIONS[number];

export function capabilityPath(section: CapabilitySection): string {
  return `/capabilities/${section}`;
}

function parseCapabilitySection(value: string | undefined): CapabilitySection {
  return CAPABILITY_SECTIONS.includes(value as CapabilitySection) ? value as CapabilitySection : 'discover';
}

function CapabilityContentFallback({ label }: { label: string }) {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-7 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:px-8" aria-label={label} aria-busy>
      {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-40 rounded-xl" />)}
    </div>
  );
}

export function CapabilitiesPage() {
  const language = useLocaleStore(state => state.language);
  const copy = messages(language).capabilitiesHub;
  const section = parseCapabilitySection(useParams<{ section?: string }>().section);
  const navigate = useNavigate();
  const setPageHeader = usePageHeaderStore(state => state.setPageHeader);
  const clearPageHeader = usePageHeaderStore(state => state.clearPageHeader);
  const [headerContribution, setHeaderContribution] = useState<{ section: CapabilitySection; node: ReactNode | null }>({ section, node: null });
  const headerEnd = headerContribution.section === section ? headerContribution.node : null;
  const onHeaderEndChange = useCallback((node: ReactNode | null) => {
    setHeaderContribution({ section, node });
  }, [section]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{copy.title}</h1>
        </div>
      ),
      end: headerEnd,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, copy.title, headerEnd, setPageHeader]);

  const tabs = [
    { id: 'discover' as const, label: copy.tabDiscover },
    { id: 'skills' as const, label: copy.tabSkills },
    { id: 'connectors' as const, label: copy.tabConnectors },
    { id: 'extensions' as const, label: copy.tabExtensions },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-panel">
      <div className="shrink-0 border-b border-edge-subtle px-4 pt-3 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <PageTabs
            items={tabs}
            activeTab={section}
            onChange={next => navigate(capabilityPath(next))}
            ariaLabel={copy.navAria}
            tabIdPrefix="capabilities-tab"
            panelIdPrefix="capabilities-panel"
          />
        </div>
      </div>
      <Suspense fallback={<CapabilityContentFallback label={copy.discoverLoading} />}>
        {section === 'discover' ? <CapabilityDiscoverPage onHeaderEndChange={onHeaderEndChange} /> : null}
        {section === 'skills' ? <SkillsPage embedded onHeaderEndChange={onHeaderEndChange} /> : null}
        {section === 'connectors' ? <ConnectorsPage embedded onHeaderEndChange={onHeaderEndChange} /> : null}
        {section === 'extensions' ? <ExtensionsPage embedded onHeaderEndChange={onHeaderEndChange} /> : null}
      </Suspense>
    </div>
  );
}
