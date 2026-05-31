import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { SettingsFormSection } from '@/features/settings/settings-form-section';

export function BrowserWorkspace({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <SettingsFormSection>
      <div className="mb-4 flex items-start gap-3 border-b border-edge pb-4">
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent"
          aria-hidden
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{subtitle}</p>
        </div>
      </div>
      {children}
    </SettingsFormSection>
  );
}
