import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';

import { getCronTemplateCopy } from '@/features/cron/cron-template-i18n';
import {
  CRON_JOB_TEMPLATES,
  CRON_TEMPLATE_CATEGORIES,
  type CronJobTemplateDef,
  type CronTemplateCategory,
} from '@/features/cron/cron-templates';
import { cronExpressionToSchedule } from '@/features/cron/cron-api';
import { formatScheduleBadge, type ScheduleBadgeLabels } from '@/features/cron/cron-utils';

export type CronTemplateFilter = 'all' | CronTemplateCategory;

type Props = {
  cron: MessageBundle['cron'];
  localeTag: string;
  scheduleBadgeLabels: ScheduleBadgeLabels;
  categoryFilter: CronTemplateFilter;
  onCategoryFilterChange: (next: CronTemplateFilter) => void;
  onSelectTemplate: (templateId: string) => void;
  /** Dialog picker uses fixed height with internal scroll; embedded empty state grows naturally. */
  variant?: 'embedded' | 'dialog';
};

function filterCronTemplates(
  cron: MessageBundle['cron'],
  query: string,
  categoryFilter: CronTemplateFilter,
): CronJobTemplateDef[] {
  const normalized = query.trim().toLowerCase();
  return CRON_JOB_TEMPLATES.filter((t) => {
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    if (!normalized) return true;
    const copy = getCronTemplateCopy(cron, t.templateId);
    const haystack = [t.templateId, copy?.title, copy?.description, cron.templateCategories[t.category]]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}

function groupTemplatesByCategory(
  templates: CronJobTemplateDef[],
): Array<{ category: CronTemplateCategory; items: CronJobTemplateDef[] }> {
  const buckets = new Map<CronTemplateCategory, CronJobTemplateDef[]>();
  for (const template of templates) {
    const bucket = buckets.get(template.category) ?? [];
    bucket.push(template);
    buckets.set(template.category, bucket);
  }
  return CRON_TEMPLATE_CATEGORIES.flatMap((category) => {
    const items = buckets.get(category);
    return items?.length ? [{ category, items }] : [];
  });
}

function CronTemplateCard({
  template,
  cron,
  localeTag,
  scheduleBadgeLabels,
  onSelectTemplate,
}: {
  template: CronJobTemplateDef;
  cron: MessageBundle['cron'];
  localeTag: string;
  scheduleBadgeLabels: ScheduleBadgeLabels;
  onSelectTemplate: (templateId: string) => void;
}) {
  const copy = getCronTemplateCopy(cron, template.templateId);
  if (!copy) return null;

  const badge = formatScheduleBadge(
    { schedule: cronExpressionToSchedule(template.defaultSchedule), nextRunAtMs: undefined },
    localeTag,
    scheduleBadgeLabels,
  );

  return (
    <button
      type="button"
      className={cn(
        'flex h-full flex-col gap-1.5 rounded-xl border border-edge-subtle bg-surface-base p-4 text-left transition-colors',
        'hover:border-accent/40 hover:bg-surface-hover',
        interaction.focusRingPanel,
      )}
      onClick={() => onSelectTemplate(template.templateId)}
      aria-label={`${cron.templateCategories[template.category]} — ${copy.title}`}
    >
      <span className="font-semibold text-fg">{copy.title}</span>
      <span className="line-clamp-2 text-sm text-fg-muted">{copy.description}</span>
      <span className="mt-auto flex items-center gap-1 pt-1 text-xs text-fg-muted">
        <span className="tabular-nums">{badge}</span>
      </span>
    </button>
  );
}

export function CronTemplateLibrary(props: Props) {
  const {
    cron,
    localeTag,
    scheduleBadgeLabels,
    categoryFilter,
    onCategoryFilterChange,
    onSelectTemplate,
    variant = 'embedded',
  } = props;

  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => filterCronTemplates(cron, query, categoryFilter),
    [cron, query, categoryFilter],
  );

  const grouped = useMemo(() => groupTemplatesByCategory(filtered), [filtered]);
  const showGrouped = categoryFilter === 'all' && !query.trim();

  const controls = (
    <div className="flex shrink-0 flex-col gap-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={cron.templateSearchPlaceholder}
          className={cn(
            'h-10 w-full rounded-xl border border-edge bg-surface-base py-2 pl-10 pr-3 text-sm text-fg',
            'placeholder:text-fg-subtle',
            interaction.focusRingPanel,
          )}
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label={cron.fromTemplate}>
        <Button
          type="button"
          variant={categoryFilter === 'all' ? 'secondary' : 'ghost'}
          className="h-8 rounded-full px-3 py-1.5 text-xs"
          onClick={() => onCategoryFilterChange('all')}
        >
          {cron.templateFilterAll}
        </Button>
        {CRON_TEMPLATE_CATEGORIES.map((cat) => (
          <Button
            key={cat}
            type="button"
            variant={categoryFilter === cat ? 'secondary' : 'ghost'}
            className="h-8 rounded-full px-3 py-1.5 text-xs"
            onClick={() => onCategoryFilterChange(cat)}
          >
            {cron.templateCategories[cat]}
          </Button>
        ))}
      </div>
    </div>
  );

  const list =
    filtered.length === 0 ? (
      <div
        className={cn(
          'text-center text-sm text-fg-muted',
          variant === 'dialog' && 'flex h-full flex-col items-center justify-center px-4 py-12',
        )}
      >
        {cron.templatesEmptyHint}
      </div>
    ) : showGrouped ? (
      <div className="flex flex-col gap-6 pb-1">
        {grouped.map((group) => (
          <section key={group.category}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {cron.templateCategories[group.category]}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.items.map((t) => (
                <CronTemplateCard
                  key={t.templateId}
                  template={t}
                  cron={cron}
                  localeTag={localeTag}
                  scheduleBadgeLabels={scheduleBadgeLabels}
                  onSelectTemplate={onSelectTemplate}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    ) : (
      <div className="grid grid-cols-1 gap-3 pb-1 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((t) => (
          <CronTemplateCard
            key={t.templateId}
            template={t}
            cron={cron}
            localeTag={localeTag}
            scheduleBadgeLabels={scheduleBadgeLabels}
            onSelectTemplate={onSelectTemplate}
          />
        ))}
      </div>
    );

  if (variant === 'dialog') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        {controls}
        <div className="min-h-0 flex-1 overflow-y-auto">{list}</div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {controls}
      {list}
    </div>
  );
}
