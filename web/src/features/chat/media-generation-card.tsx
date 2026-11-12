import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export function MediaGenerationCard({ children }: { children: ReactNode }) {
  return <article className="min-w-0 w-full max-w-lg space-y-2.5 rounded-xl border border-edge-subtle bg-surface-panel p-3 sm:p-4">
    {children}
  </article>;
}

export function MediaGenerationDetails({ label, children }: { label: string; children: ReactNode }) {
  return <details className="group text-xs text-fg-muted">
    <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm py-1 hover:text-fg focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
      <ChevronRight size={14} aria-hidden className="group-open:rotate-90" />
      {label}
    </summary>
    {children}
  </details>;
}
