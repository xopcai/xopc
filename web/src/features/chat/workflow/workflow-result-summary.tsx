/**
 * Best-effort visualisation of the workflow `result` payload.
 *
 * The runtime returns whatever the script returned, so the shape varies. We
 * recognise the conventional fields the built-in templates already emit
 * (topFindings / topRisks / executiveSummary / summary / openQuestions) and
 * render them as concise rows. Anything we don't recognise falls back to a
 * collapsible JSON view, so the user never loses information.
 */

import { memo } from 'react';

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
  rawHeading: string;
  emptyResult: string;
};

interface FindingLike {
  title?: string;
  file?: string;
  line?: number | string;
  severity?: string;
  fix?: string;
  source?: string;
  dimension?: string;
  lens?: string;
  reason?: string;
}

interface RiskLike extends FindingLike {
  realRisk?: boolean;
}

const MAX_ITEMS = 5;

export const WorkflowResultSummary = memo(function WorkflowResultSummary({
  result,
  labels,
}: {
  result: unknown;
  labels: WorkflowResultSummaryLabels;
}) {
  if (result == null) {
    return <div className="text-sm text-fg-disabled">{labels.emptyResult}</div>;
  }
  if (typeof result !== 'object') {
    return <RawJsonBlock value={result} heading={labels.rawHeading} />;
  }

  const obj = result as Record<string, unknown>;
  const sections: React.ReactNode[] = [];

  if (typeof obj.executiveSummary === 'string' && obj.executiveSummary.trim()) {
    sections.push(<TextBlock key="exec" heading={labels.executiveSummaryHeading} text={obj.executiveSummary} />);
  } else if (typeof obj.summary === 'string' && obj.summary.trim()) {
    sections.push(<TextBlock key="sum" heading={labels.summaryHeading} text={obj.summary} />);
  }

  const conclusion = pickFirstString(obj.conclusion, obj.decision);
  if (conclusion) {
    sections.push(<TextBlock key="conclusion" heading={labels.conclusionHeading} text={conclusion} />);
  }

  const recommendations = pickStringArray(obj.recommendations) ?? pickStringArray(obj.actions);
  if (recommendations && recommendations.length > 0) {
    sections.push(
      <StringList
        key="recommendations"
        heading={labels.recommendationsHeading}
        items={recommendations}
        moreSuffix={labels.moreSuffix}
      />,
    );
  }

  const nextSteps = pickStringArray(obj.nextSteps);
  if (nextSteps && nextSteps.length > 0) {
    sections.push(
      <StringList
        key="nextSteps"
        heading={labels.nextStepsHeading}
        items={nextSteps}
        moreSuffix={labels.moreSuffix}
      />,
    );
  }

  const checklist = pickStringArray(obj.checklist);
  if (checklist && checklist.length > 0) {
    sections.push(
      <StringList
        key="checklist"
        heading={labels.checklistHeading}
        items={checklist}
        moreSuffix={labels.moreSuffix}
      />,
    );
  }

  const findings = pickArray<FindingLike>(obj.topFindings) ?? pickArray<FindingLike>(obj.findings);
  if (findings && findings.length > 0) {
    sections.push(
      <FindingList
        key="findings"
        items={findings}
        heading={labels.topFindingsHeading(findings.length)}
        moreSuffix={labels.moreSuffix}
      />,
    );
  }

  const risks = pickArray<RiskLike>(obj.topRisks);
  if (risks && risks.length > 0) {
    sections.push(
      <FindingList
        key="risks"
        items={risks}
        heading={labels.topRisksHeading(risks.length)}
        moreSuffix={labels.moreSuffix}
      />,
    );
  }

  const openQuestions = pickStringArray(obj.openQuestions);
  if (openQuestions && openQuestions.length > 0) {
    sections.push(
      <details key="oq" className="group min-w-0">
        <summary className="cursor-pointer select-none text-[10px] font-medium uppercase tracking-wide text-fg-subtle underline-offset-2 hover:text-fg-muted">
          {labels.openQuestionsHeading}
        </summary>
        <ul className="mt-1 space-y-0.5 text-sm text-fg-muted">
          {openQuestions.slice(0, MAX_ITEMS).map((q) => (
            <li key={q} className="flex gap-2">
              <span className="text-fg-disabled">•</span>
              <span className="min-w-0 break-words">{q}</span>
            </li>
          ))}
          {openQuestions.length > MAX_ITEMS ? (
            <li className="pl-4 text-xs text-fg-disabled">{labels.moreSuffix(openQuestions.length - MAX_ITEMS)}</li>
          ) : null}
        </ul>
      </details>,
    );
  }

  if (sections.length === 0) {
    return <RawJsonBlock value={result} heading={labels.rawHeading} />;
  }

  return (
    <div className="space-y-3">
      {sections}
      <details className="group">
        <summary className="cursor-pointer select-none text-xs text-fg-subtle underline-offset-2 hover:text-fg-muted">
          {labels.rawHeading}
        </summary>
        <RawJsonBlock value={result} heading={labels.rawHeading} hideHeading />
      </details>
    </div>
  );
});

function TextBlock({ heading, text }: { heading: string; text: string }) {
  return (
    <details className="group min-w-0">
      <summary className="cursor-pointer select-none text-[10px] font-medium uppercase tracking-wide text-fg-subtle underline-offset-2 hover:text-fg-muted">
        {heading}
      </summary>
      <div className="mt-1 whitespace-pre-wrap break-words text-sm text-fg">{text}</div>
    </details>
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
    <details className="group min-w-0">
      <summary className="cursor-pointer select-none text-[10px] font-medium uppercase tracking-wide text-fg-subtle underline-offset-2 hover:text-fg-muted">
        {heading}
      </summary>
      <ul className="mt-1 space-y-0.5 text-sm text-fg-muted">
        {visible.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="text-fg-disabled">•</span>
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
        {items.length > visible.length ? (
          <li className="pl-4 text-xs text-fg-disabled">{moreSuffix(items.length - visible.length)}</li>
        ) : null}
      </ul>
    </details>
  );
}

function FindingList({
  items,
  heading,
  moreSuffix,
}: {
  items: FindingLike[];
  heading: string;
  moreSuffix: (n: number) => string;
}) {
  const visible = items.slice(0, MAX_ITEMS);
  return (
    <details className="group min-w-0">
      <summary className="cursor-pointer select-none text-[10px] font-medium uppercase tracking-wide text-fg-subtle underline-offset-2 hover:text-fg-muted">
        {heading}
      </summary>
      <ul className="mt-1 space-y-1">
        {visible.map((it) => (
          <FindingRow key={`${it.file ?? ''}:${it.line ?? ''}:${it.title ?? it.reason ?? it.fix ?? ''}`} item={it} />
        ))}
      </ul>
      {items.length > visible.length ? (
        <div className="mt-1 pl-1 text-xs text-fg-disabled">{moreSuffix(items.length - visible.length)}</div>
      ) : null}
    </details>
  );
}

function FindingRow({ item }: { item: FindingLike }) {
  const tone = severityTone(item.severity);
  const toneClass =
    tone === 'high'
      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
      : tone === 'med'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        : tone === 'low'
          ? 'bg-surface-hover text-fg-muted'
          : 'bg-surface-hover text-fg-muted';
  const fileLabel = item.file
    ? item.line !== undefined
      ? `${item.file}:${item.line}`
      : item.file
    : item.source ?? '';
  const tag = item.dimension ?? item.lens ?? '';

  return (
    <li className="flex min-w-0 items-start gap-2 text-sm">
      {item.severity ? (
        <span
          className={cn('mt-0.5 shrink-0 rounded px-1.5 py-px text-[10px] font-medium uppercase', toneClass)}
        >
          {String(item.severity).slice(0, 4)}
        </span>
      ) : (
        <span className="mt-0.5 shrink-0 text-fg-disabled">•</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="min-w-0">
          {tag ? <span className="mr-1.5 text-xs text-fg-subtle">{tag}</span> : null}
          <span className="text-fg">{item.title ?? item.reason ?? '(no title)'}</span>
        </div>
        {fileLabel ? (
          <div className="truncate font-mono text-xs text-fg-subtle" title={fileLabel}>
            {fileLabel}
          </div>
        ) : null}
        {item.fix ? <div className="mt-0.5 text-xs text-fg-muted">↳ {item.fix}</div> : null}
      </div>
    </li>
  );
}

function RawJsonBlock({ value, heading, hideHeading }: { value: unknown; heading: string; hideHeading?: boolean }) {
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return (
    <div className="min-w-0">
      {hideHeading ? null : (
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-subtle">{heading}</div>
      )}
      <pre className="max-h-72 min-w-0 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-surface-hover/60 p-2 font-mono text-xs text-fg-muted dark:bg-surface-hover/35">
        {text}
      </pre>
    </div>
  );
}

function pickArray<T>(v: unknown): T[] | null {
  return Array.isArray(v) && v.length > 0 ? (v as T[]) : null;
}

function pickStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const filtered = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  return filtered.length > 0 ? filtered : null;
}

function pickFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}
