import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

export function ModelUseGroup({ section, title, children }: { section: string; title: string; children: ReactNode }) {
  return <section data-model-section={section} className="min-w-0 border-t border-edge first:border-t-0">
    <h3 className="bg-surface-panel px-4 py-1.5 text-xs font-medium text-fg-muted">{title}</h3>
    <div className="divide-y divide-edge-subtle px-4">{children}</div>
  </section>;
}

export function ModelUseService({ name, manageLabel, onManage, disabled }: {
  name?: string;
  manageLabel: string;
  onManage?: () => void;
  disabled?: boolean;
}) {
  if (!onManage) return name ? <p className="px-1 text-xs text-fg-muted">{name}</p> : null;
  return <Button variant="ghost" disabled={disabled}
    aria-label={name ? `${manageLabel} · ${name}` : manageLabel}
    className="min-h-8 max-w-full justify-start gap-1 rounded-md px-1 py-1 text-xs font-normal"
    onClick={onManage}>
    <span className="truncate">{name || manageLabel}</span>
    <ChevronRight className="size-3 shrink-0" aria-hidden />
  </Button>;
}

export function ModelUseRow({ description, picker, actions, inline, actionColumn }: {
  description?: ReactNode;
  picker: ReactNode;
  actions?: ReactNode;
  inline?: boolean;
  actionColumn?: boolean;
}) {
  if (inline) return <div className="min-w-0 space-y-1 py-2">{picker}</div>;

  return <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2.5 @min-[40rem]:gap-x-4 ${actionColumn
    ? '@min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_4.5rem]'
    : '@min-[40rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]'}`}>
    <div className="col-start-1 row-start-1 min-w-0">{description}</div>
    <div className="col-span-2 row-start-2 w-full min-w-0 @min-[40rem]:col-span-1 @min-[40rem]:col-start-2 @min-[40rem]:row-start-1">{picker}</div>
    {actions && <div className="col-start-2 row-start-1 flex justify-end @min-[40rem]:col-start-3">{actions}</div>}
  </div>;
}
