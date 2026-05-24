import { ExternalLink } from 'lucide-react';

import { cn } from '@/lib/cn';
import { remoteAccessDocsUrl, type RemoteAccessDocsSection } from '@/navigation';
import type { StoredLanguage } from '@/lib/storage';

type Props = {
  language: StoredLanguage;
  label: string;
  section?: RemoteAccessDocsSection;
  className?: string;
};

export function RemoteAccessDocsLink({ language, label, section, className }: Props) {
  return (
    <a
      href={remoteAccessDocsUrl(language, section)}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        className,
      )}
    >
      {label}
      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
    </a>
  );
}
