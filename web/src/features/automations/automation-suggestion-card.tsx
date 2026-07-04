import { CheckCircle2, Lightbulb, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useLocaleStore } from '@/stores/locale-store';

import { automationApi } from './automation-api';
import {
  buildCoverageExplanation,
  formatAutomationMessage,
  matchesCoverage,
  type AutomationCoverageEvent,
} from './automation-explanations';

type Props = {
  title: string;
  description: string;
  prompt: string;
  coverage?: AutomationCoverageEvent;
  className?: string;
};

export function AutomationSuggestionCard({ title, description, prompt, coverage, className }: Props) {
  const language = useLocaleStore((s) => s.language);
  const labels = messages(language).automations.suggestions;
  const automationLabels = messages(language).automations;
  const navigate = useNavigate();
  const { data } = useSWR(coverage ? 'automation-suggestion-coverage' : null, () => automationApi.list(), {
    revalidateOnFocus: false,
    refreshInterval: 15000,
  });
  const coveredAutomation = coverage
    ? data?.automations.find((automation) => matchesCoverage(automation, coverage))
    : undefined;
  const coverageExplanation = coveredAutomation
    ? buildCoverageExplanation(coveredAutomation, automationLabels)
    : [];

  if (coveredAutomation) {
    return (
      <section className={cn('rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-3', className)}>
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-fg">{labels.coveredTitle}</div>
            <p className="mt-1 break-words text-xs leading-5 text-fg-muted">
              {formatAutomationMessage(labels.coveredDescription, { name: coveredAutomation.name })}
            </p>
          </div>
        </div>
        <div className="mt-2 rounded-md border border-emerald-500/20 bg-surface-base/45 px-2.5 py-2">
          <div className="text-xs font-medium text-fg">{automationLabels.explain.whyCovered}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {coverageExplanation.map((item) => (
              <span
                key={item}
                className="rounded-full border border-edge/70 bg-surface-panel px-2 py-0.5 text-xs text-fg-muted"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            className="h-8 rounded-md px-2.5 text-xs"
            onClick={() => navigate('/automations')}
          >
            {labels.manage}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className={cn('rounded-lg border border-edge bg-surface-panel p-3', className)}>
      <div className="flex items-start gap-2">
        <Lightbulb className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-fg">{title}</div>
          <p className="mt-1 break-words text-xs leading-5 text-fg-muted">{description}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          variant="secondary"
          className="h-8 rounded-md px-2.5 text-xs"
          onClick={() => {
            const params = new URLSearchParams({ draft: prompt, autogenerate: '1' });
            navigate(`/automations?${params.toString()}`);
          }}
        >
          <Sparkles className="size-3.5" aria-hidden />
          {labels.create}
        </Button>
      </div>
    </section>
  );
}
