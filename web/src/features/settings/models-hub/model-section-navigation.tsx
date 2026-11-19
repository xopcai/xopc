import { useRef, type ReactNode } from 'react';

import { SlidingTabList } from '@/components/ui/sliding-tab-list';
import { cn } from '@/lib/cn';
import { useSectionNavigation } from '@/lib/use-section-navigation';

import { capabilityGroups } from './capability-navigation';

const servicesSection = { id: 'services', label: ['服务账户', 'Service accounts'] } as const;
const sections = [...capabilityGroups.map(group => ({ id: group.uses[0], label: group.label })), servicesSection];

export function ModelSectionNavigation({ zh, children }: { zh: boolean; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const { active, jumpTo } = useSectionNavigation({
    contentRef, toolbarRef, navRef, sectionAttribute: 'data-model-section', initialSectionId: sections[0].id,
  });

  return <div ref={contentRef} className="flex min-w-0 flex-col gap-5">
    <div ref={toolbarRef} className="sticky top-0 z-10 min-w-0 bg-surface-panel py-1">
      <SlidingTabList as="nav" ref={navRef} aria-label={zh ? '模型配置分区' : 'Model settings sections'}
        scrollFocusedItemIntoView={false} className="flex w-full gap-0.5 overflow-x-auto rounded-xl bg-surface-inset p-1"
        indicatorClassName="rounded-lg bg-surface-panel ring-1 ring-edge-subtle motion-reduce:transition-none">
        {sections.map(section => <button key={section.id} type="button"
          aria-current={active === section.id ? 'location' : undefined}
          aria-pressed={active === section.id}
          className={cn('touch-target relative z-10 min-h-9 min-w-max flex-1 whitespace-nowrap rounded-lg px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
            active === section.id ? 'text-fg' : 'text-fg-muted hover:text-fg')}
          onClick={() => jumpTo(section.id)}>
          {section.label[zh ? 0 : 1]}
        </button>)}
      </SlidingTabList>
    </div>
    {children}
  </div>;
}
