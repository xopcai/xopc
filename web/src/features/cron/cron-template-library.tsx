import { Button } from '@/components/ui/button';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { getCronTemplateCopy } from '@/features/cron/cron-template-i18n';
import { CRON_JOB_TEMPLATES, CRON_TEMPLATE_CATEGORIES, type CronTemplateCategory } from '@/features/cron/cron-templates';
import { formatScheduleBadge, type ScheduleBadgeLabels } from '@/features/cron/cron-utils';

export type CronTemplateFilter = 'all' | CronTemplateCategory;

type Props = {
  cron: MessageBundle['cron'];
  localeTag: string;
  scheduleBadgeLabels: ScheduleBadgeLabels;
  categoryFilter: CronTemplateFilter;
  onCategoryFilterChange: (next: CronTemplateFilter) => void;
  onSelectTemplate: (templateId: string) => void;
};

export function CronTemplateLibrary(props: Props) {
  const { cron, localeTag, scheduleBadgeLabels, categoryFilter, onCategoryFilterChange, onSelectTemplate } = props;

  const filtered =
    categoryFilter === 'all'
      ? [...CRON_JOB_TEMPLATES]
      : CRON_JOB_TEMPLATES.filter((t) => t.category === categoryFilter);

  return (
    <div className="flex w-full flex-col gap-4">
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
      {filtered.length === 0 ? (
        <p className="text-center text-sm text-fg-muted">{cron.templatesEmptyHint}</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => {
            const copy = getCronTemplateCopy(cron, t.templateId);
            if (!copy) return null;
            const badge = formatScheduleBadge(
              { schedule: t.defaultSchedule, timezone: undefined, next_run: undefined },
              localeTag,
              scheduleBadgeLabels,
            );
            return (
              <button
                key={t.templateId}
                type="button"
                className={cn(
                  'flex flex-col gap-1.5 rounded-xl border border-edge-subtle bg-surface-base p-4 text-left transition-colors',
                  'hover:border-accent/40 hover:bg-surface-hover',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                )}
                onClick={() => onSelectTemplate(t.templateId)}
                aria-label={`${cron.templateCategories[t.category]} — ${copy.title}`}
              >
                <span className="font-semibold text-fg">{copy.title}</span>
                <span className="line-clamp-2 text-sm text-fg-muted">{copy.description}</span>
                <span className="mt-1 flex items-center gap-1 text-xs text-fg-muted">
                  <span className="tabular-nums">{badge}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
