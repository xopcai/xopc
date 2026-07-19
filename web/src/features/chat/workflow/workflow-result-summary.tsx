import { memo } from 'react';

import type { WorkflowResultEnvelope, WorkflowResultSection } from '@/features/workflows/workflow-api';
import { cn } from '@/lib/cn';

import { severityTone } from './workflow.utils';

export type WorkflowResultSummaryLabels = {
  topFindingsHeading: (n: number) => string;
  topRisksHeading: (n: number) => string;
  executiveSummaryHeading: string;
  summaryHeading: string;
  openQuestionsHeading: string;
  conclusionHeading: string;
  recommendationsHeading: string;
  nextStepsHeading: string;
  checklistHeading: string;
  moreSuffix: (n: number) => string;
  emptyResult: string;
};

const MAX_ITEMS = 5;

export const WorkflowResultSummary = memo(function WorkflowResultSummary({
  result,
  labels,
}: {
  result: WorkflowResultEnvelope | null | undefined;
  labels: WorkflowResultSummaryLabels;
}) {
  if (!result) {
    return <div className="text-sm text-fg-disabled">{labels.emptyResult}</div>;
  }

  return (
    <div className="space-y-4">
      <section className="min-w-0">
        <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
          {result.title || labels.summaryHeading}
        </div>
        <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-fg">
          {result.summary}
        </div>
      </section>

      {result.sections.map((section, index) => (
        <WorkflowResultSectionView key={`${section.kind}:${section.title}:${index}`} section={section} labels={labels} />
      ))}
    </div>
  );
});

function WorkflowResultSectionView({
  section,
  labels,
}: {
  section: WorkflowResultSection;
  labels: WorkflowResultSummaryLabels;
}) {
  if (section.kind === 'text') {
    return <TextBlock heading={section.title} text={section.content} />;
  }
  if (section.kind === 'findings') {
    return <FindingList heading={section.title || labels.topFindingsHeading(section.items.length)} items={section.items} moreSuffix={labels.moreSuffix} />;
  }
  if (section.kind === 'risks') {
    return <RiskList heading={section.title || labels.topRisksHeading(section.items.length)} items={section.items} moreSuffix={labels.moreSuffix} />;
  }
  if (section.kind === 'questions') {
    return <StringList heading={section.title || labels.openQuestionsHeading} items={section.items} moreSuffix={labels.moreSuffix} />;
  }
  return (
    <details className="group min-w-0 rounded-lg border border-edge-subtle bg-surface-hover/20">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-fg-muted marker:text-fg-subtle hover:text-fg">
        {section.title}
      </summary>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-edge-subtle bg-surface-hover/30 p-2 font-mono text-xs leading-5 text-fg-muted">
        {JSON.stringify(section.value, null, 2)}
      </pre>
    </details>
  );
}

function TextBlock({ heading, text }: { heading: string; text: string }) {
  return (
    <section className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{heading}</div>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-fg-muted">{text}</div>
    </section>
  );
}

function StringList({
  heading,
  items,
  moreSuffix,
}: {
  heading: string;
  items: string[];
  moreSuffix: (n: number) => string;
}) {
  const visible = items.slice(0, MAX_ITEMS);
  return (
    <section className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{heading}</div>
      <ul className="mt-1 space-y-1 text-sm text-fg-muted">
        {visible.map((item, index) => (
          <li key={`${item}:${index}`} className="flex gap-2">
            <span className="text-fg-disabled">-</span>
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
      {items.length > visible.length ? (
        <div className="mt-1 pl-4 text-xs text-fg-disabled">{moreSuffix(items.length - visible.length)}</div>
      ) : null}
    </section>
  );
}

function FindingList({
  heading,
  items,
  moreSuffix,
}: {
  heading: string;
  items: Array<{ title: string; severity?: string; file?: string; line?: number; detail?: string; recommendation?: string }>;
  moreSuffix: (n: number) => string;
}) {
  const visible = items.slice(0, MAX_ITEMS);
  return (
    <section className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{heading}</div>
      <ul className="mt-2 space-y-2">
        {visible.map((item, index) => (
          <FindingRow key={`${item.title}:${item.file ?? ''}:${index}`} item={item} />
        ))}
      </ul>
      {items.length > visible.length ? (
        <div className="mt-2 pl-1 text-xs text-fg-disabled">{moreSuffix(items.length - visible.length)}</div>
      ) : null}
    </section>
  );
}

function RiskList({
  heading,
  items,
  moreSuffix,
}: {
  heading: string;
  items: Array<{ title: string; severity?: string; likelihood?: string; impact?: string; mitigation?: string }>;
  moreSuffix: (n: number) => string;
}) {
  const visible = items.slice(0, MAX_ITEMS);
  return (
    <section className="min-w-0">
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{heading}</div>
      <ul className="mt-2 space-y-2">
        {visible.map((item, index) => (
          <FindingRow
            key={`${item.title}:${index}`}
            item={{
              title: item.title,
              severity: item.severity,
              detail: item.impact,
              recommendation: item.mitigation,
            }}
          />
        ))}
      </ul>
      {items.length > visible.length ? (
        <div className="mt-2 pl-1 text-xs text-fg-disabled">{moreSuffix(items.length - visible.length)}</div>
      ) : null}
    </section>
  );
}

function FindingRow({
  item,
}: {
  item: { title: string; severity?: string; file?: string; line?: number; detail?: string; recommendation?: string };
}) {
  const tone = severityTone(item.severity);
  const toneClass =
    tone === 'high'
      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
      : tone === 'med'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        : 'bg-surface-hover text-fg-muted';
  const fileLabel = item.file ? (item.line != null ? `${item.file}:${item.line}` : item.file) : '';

  return (
    <li className="min-w-0 rounded-lg border border-edge-subtle bg-surface-base/45 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {item.severity ? (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium uppercase', toneClass)}>
            {item.severity}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 break-words text-sm font-medium text-fg">{item.title}</span>
      </div>
      {fileLabel ? <div className="mt-1 break-all font-mono text-xs text-fg-subtle">{fileLabel}</div> : null}
      {item.detail ? <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-fg-muted">{item.detail}</div> : null}
      {item.recommendation ? (
        <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-fg-muted">{item.recommendation}</div>
      ) : null}
    </li>
  );
}
