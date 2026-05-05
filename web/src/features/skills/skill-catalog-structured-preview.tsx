import { type ReactNode } from 'react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { cn } from '@/lib/cn';
import type { SkillMarkdownPreviewPayload } from '@/features/skills/skill.types';
import { installSpecSummary } from '@/features/skills/skills-page.utils';
import type { MessageBundle } from '@/i18n/messages';

export type SkillsCopy = MessageBundle['skills'];

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === false) return null;
  return (
    <div className="mt-3 border-t border-edge-subtle pt-3 dark:border-edge/60">
      <div className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1.5 min-w-0 text-sm text-fg">{children}</div>
    </div>
  );
}

export function SkillCatalogStructuredPreview({
  preview,
  sk,
}: {
  preview: SkillMarkdownPreviewPayload;
  sk: SkillsCopy;
}) {
  const meta = preview.metadata;
  const gate = preview.toolConditions;
  const hasToolGating =
    !!gate &&
    (gate.requiresTools.length > 0 ||
      gate.requiresToolsets.length > 0 ||
      gate.fallbackForTools.length > 0 ||
      gate.fallbackForToolsets.length > 0);
  const req = meta.requires;
  const hasRequires =
    req &&
    ((req.bins?.length ?? 0) > 0 || (req.env?.length ?? 0) > 0 || (req.anyBins?.length ?? 0) > 0);
  const installs = meta.install?.filter((s) => s && typeof s.kind === 'string') ?? [];
  const envNames = preview.requiredEnvVarNames?.filter((n) => n.trim()) ?? [];

  return (
    <div className="space-y-6">
      <section aria-labelledby="skill-detail-summary-heading">
        <h3
          id="skill-detail-summary-heading"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted"
        >
          {sk.detailSummaryHeading}
        </h3>
        <div className="rounded-xl border border-edge bg-surface-base px-4 py-3 dark:bg-surface-hover/25">
          {meta.emoji?.trim() ? (
            <p className="text-2xl leading-none" aria-hidden>
              {meta.emoji.trim()}
            </p>
          ) : null}
          <p className={cn('text-sm leading-relaxed text-fg', meta.emoji?.trim() ? 'mt-2' : '')}>
            {preview.description}
          </p>
          {preview.disableModelInvocation ? (
            <p className="mt-3 rounded-lg border border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs leading-snug text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
              {sk.detailNotInjectedNote}
            </p>
          ) : null}
          <MetaRow label={sk.detailHomepageLabel}>
            {meta.homepage?.trim() ? (
              <a
                href={meta.homepage.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-accent underline-offset-2 hover:underline"
              >
                {meta.homepage.trim()}
              </a>
            ) : null}
          </MetaRow>
          <MetaRow label={sk.detailPlatformsLabel}>
            {meta.os && meta.os.length > 0 ? (
              <span className="font-mono text-xs text-fg-muted">{meta.os.join(', ')}</span>
            ) : null}
          </MetaRow>
          <MetaRow label={sk.detailRequiresLabel}>
            {hasRequires && req ? (
              <ul className="list-inside list-disc space-y-1 text-sm text-fg-muted">
                {req.bins && req.bins.length > 0 ? (
                  <li>
                    <span className="text-fg">{sk.detailRequiresBins}: </span>
                    {req.bins.join(', ')}
                  </li>
                ) : null}
                {req.env && req.env.length > 0 ? (
                  <li>
                    <span className="text-fg">{sk.detailRequiresEnv}: </span>
                    <span className="font-mono text-xs">{req.env.join(', ')}</span>
                  </li>
                ) : null}
                {req.anyBins && req.anyBins.length > 0 ? (
                  <li>
                    <span className="text-fg">{sk.detailRequiresAnyBins}: </span>
                    {req.anyBins.join(', ')}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </MetaRow>
          <MetaRow label={sk.detailInstallLabel}>
            {installs.length > 0 ? (
              <ul className="list-inside list-decimal space-y-1.5 text-sm text-fg-muted">
                {installs.map((spec, i) => (
                  <li key={spec.id || `${spec.kind}-${i}`} className="[overflow-wrap:anywhere]">
                    <span className="text-fg">{installSpecSummary(spec)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </MetaRow>
          <MetaRow label={sk.detailToolGatingLabel}>
            {hasToolGating && gate ? (
              <ul className="mt-1 space-y-2 text-sm text-fg-muted">
                {gate.requiresTools.length > 0 ? (
                  <li>
                    <span className="font-medium text-fg">{sk.detailToolsRequiresList}: </span>
                    {gate.requiresTools.join(', ')}
                  </li>
                ) : null}
                {gate.requiresToolsets.length > 0 ? (
                  <li>
                    <span className="font-medium text-fg">{sk.detailToolsetsRequiresList}: </span>
                    {gate.requiresToolsets.join(', ')}
                  </li>
                ) : null}
                {gate.fallbackForTools.length > 0 ? (
                  <li>
                    <span className="font-medium text-fg">{sk.detailToolsFallbackList}: </span>
                    {gate.fallbackForTools.join(', ')}
                  </li>
                ) : null}
                {gate.fallbackForToolsets.length > 0 ? (
                  <li>
                    <span className="font-medium text-fg">{sk.detailToolsetsFallbackList}: </span>
                    {gate.fallbackForToolsets.join(', ')}
                  </li>
                ) : null}
              </ul>
            ) : null}
          </MetaRow>
          <MetaRow label={sk.detailEnvVarsLabel}>
            {envNames.length > 0 ? (
              <span className="font-mono text-xs text-fg-muted">{envNames.join(', ')}</span>
            ) : null}
          </MetaRow>
        </div>
      </section>
      <section aria-labelledby="skill-detail-instructions-heading">
        <h3
          id="skill-detail-instructions-heading"
          className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted"
        >
          {sk.detailInstructionsHeading}
        </h3>
        {preview.bodyMarkdown.trim() ? (
          <div className="markdown-content min-w-0 break-words">
            <MarkdownView content={preview.bodyMarkdown} />
          </div>
        ) : (
          <p className="text-sm italic text-fg-muted">{sk.detailNoInstructionsBody}</p>
        )}
      </section>
    </div>
  );
}
