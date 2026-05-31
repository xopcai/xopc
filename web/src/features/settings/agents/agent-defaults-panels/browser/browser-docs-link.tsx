import { ExternalLink } from 'lucide-react';

import { cn } from '@/lib/cn';
import { browserDocsUrl } from '@/navigation';
import type { StoredLanguage } from '@/lib/storage';

export function BrowserDocsLink({
  language,
  label,
  className,
}: {
  language: StoredLanguage;
  label: string;
  className?: string;
}) {
  return (
    <a
      href={browserDocsUrl(language)}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className,
      )}
    >
      {label}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}
