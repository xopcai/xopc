import type { HomeEvidence, HomeOpportunity } from '@xopcai/gateway-contract';

import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

import { HomeEvidenceLink } from './home-evidence-link';

export function HomeEvidenceList({ opportunity, onOpen }: {
  opportunity: Pick<HomeOpportunity, 'evidence' | 'evidencePresentation'>;
  onOpen?: () => void;
}) {
  const language = useLocaleStore((state) => state.language);
  const copy = messages(language).projectsPage.home.advisorEvidenceCopy;
  const presentation = opportunity.evidencePresentation;
  const groups = presentation?.locale === language ? presentation.groups : undefined;
  const dateFormatter = new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en', {
    dateStyle: 'medium', timeStyle: 'short',
  });
  const originals = (records: HomeEvidence[]) => (
    <ul className="mt-2 space-y-3 border-l border-edge pl-3 text-xs leading-5 text-fg-muted">
      {records.map((record) => {
        const canOpen = Boolean(record.href && (/^https?:\/\//i.test(record.href)
          || (record.href.startsWith('/') && !record.href.startsWith('//'))));
        return (
          <li key={record.id} className="min-w-0 [overflow-wrap:anywhere]">
            <p className="text-fg-subtle">
              {copy.sources[record.sourceType]} · <time dateTime={new Date(record.observedAt).toISOString()}>{dateFormatter.format(record.observedAt)}</time>
            </p>
            <p className="mt-1 whitespace-pre-wrap">{record.observation}</p>
            <p className="mt-1">
              {canOpen ? <HomeEvidenceLink href={record.href} onOpen={onOpen}>{copy.openSource}</HomeEvidenceLink> : copy.noSource}
            </p>
          </li>
        );
      })}
    </ul>
  );
  const renderGroup = (group: NonNullable<typeof groups>[number], index: number) => (
    <li key={index} className="min-w-0 [overflow-wrap:anywhere]">
      <p className="text-fg-muted">{group.summary}</p>
      <details className="mt-1">
        <summary className="min-h-9 cursor-pointer rounded-sm py-2 text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          {copy.originals} · {copy.sourceCount.replace('{{count}}', String(group.evidenceIds.length))}
        </summary>
        {originals(opportunity.evidence.filter((record) => group.evidenceIds.includes(record.id)))}
      </details>
    </li>
  );
  if (!groups) return (
    <div className="mt-2 text-xs leading-5 text-fg-muted">
      <p>{copy.unavailable}</p>
      <details>
        <summary className="min-h-9 cursor-pointer rounded-sm py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{copy.originals}</summary>
        {originals(opportunity.evidence)}
      </details>
    </div>
  );
  return (
    <div className="mt-2 text-xs leading-5">
      <p className="mb-3 text-fg-subtle">{copy.aiNote}</p>
      <ul className="space-y-3 border-l border-edge pl-3">{groups.slice(0, 3).map(renderGroup)}</ul>
      {groups.length > 3 ? (
        <details className="mt-2">
          <summary className="min-h-9 cursor-pointer rounded-sm py-2 text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{copy.more.replace('{{count}}', String(groups.length - 3))}</summary>
          <ul className="space-y-3 border-l border-edge pl-3">{groups.slice(3).map(renderGroup)}</ul>
        </details>
      ) : null}
    </div>
  );
}
