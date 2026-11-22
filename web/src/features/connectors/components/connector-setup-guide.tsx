import { ExternalLink } from 'lucide-react';

import { useLocaleStore } from '@/stores/locale-store';

import type { ConnectorDefinition } from '../connectors-api';

export function ConnectorSetupGuide({ setup }: { setup?: ConnectorDefinition['setup'] }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const instructions = setup?.instructions;
  const copy = zh ? instructions?.['zh-CN'] ?? instructions?.en : instructions?.en ?? instructions?.['zh-CN'];
  const links = setup?.links ?? [];
  if (!copy && !links.length) return null;
  return (
    <div className="space-y-2 rounded-xl border border-edge bg-surface-base p-3">
      {copy ? <p className="whitespace-pre-line text-sm text-fg-muted">{copy}</p> : null}
      {links.length > 0 ? <div className="flex flex-wrap gap-2">
        {links.map(link => {
          const external = link.external !== false && /^https:\/\//i.test(link.href);
          return (
            <a
              key={`${link.label}:${link.href}`}
              href={external ? link.href : `#${link.href}`}
              target={external ? '_blank' : undefined}
              rel={external ? 'noopener noreferrer' : undefined}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-fg hover:underline"
            >
              {link.label}
              {external ? <ExternalLink className="size-3.5" aria-hidden /> : null}
            </a>
          );
        })}
      </div> : null}
    </div>
  );
}
