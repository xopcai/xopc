import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { PageTabs } from '@/components/ui/page-tabs';
import { PopoverSelect } from '@/components/ui/popover-select';
import { messages } from '@/i18n/messages';
import { preloadRouteForPath } from '@/lib/route-preload';
import {
  productDomainAtPath,
  productDomainDefinition,
  productSectionAtLocation,
  showsProductSectionHeader,
  type ProductSectionId,
} from '@/navigation/product-navigation';
import { useLocaleStore } from '@/stores/locale-store';

export function ProductSectionHeader({ fallback }: { fallback: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).productNavigation;
  const domainId = productDomainAtPath(location.pathname);
  const sectionId = productSectionAtLocation(location.pathname, location.search);

  if (!domainId || !sectionId || !showsProductSectionHeader(location.pathname)) {
    return fallback;
  }

  const domain = productDomainDefinition(domainId);
  const items = domain.sections.map((section) => ({
    id: section.id,
    label: copy.sections[section.id],
  }));
  const pathBySection = new Map(domain.sections.map((section) => [section.id, section.path]));
  const changeSection = (next: ProductSectionId) => {
    const path = pathBySection.get(next);
    if (path) {
      preloadRouteForPath(path);
      navigate(path);
    }
  };

  return (
    <div className="min-w-0">
      <h1 className="sr-only">{copy.domains[domainId]}</h1>
      <div className="hidden xl:block">
        <PageTabs
          items={items}
          activeTab={sectionId}
          onChange={changeSection}
          ariaLabel={copy.sectionsAria}
          tabIdPrefix={`${domainId}-section-tab`}
          panelIdPrefix={`${domainId}-section-panel`}
          className="pb-0"
          buttonClassName="h-9 py-1.5"
        />
      </div>
      <PopoverSelect
        value={sectionId}
        options={items.map((item) => ({ value: item.id, label: item.label }))}
        placeholder={copy.domains[domainId]}
        allowEmpty={false}
        ariaLabel={copy.sectionsAria}
        triggerClassName="h-9 w-auto min-w-[7.5rem] bg-surface-panel xl:hidden"
        contentClassName="min-w-[12rem]"
        onChange={(next) => changeSection(next as ProductSectionId)}
      />
    </div>
  );
}
