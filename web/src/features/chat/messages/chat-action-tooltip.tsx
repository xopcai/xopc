import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function ChatActionTooltipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delayDuration={300} skipDelayDuration={100}>{children}</Tooltip.Provider>;
}

export function ChatActionTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={7}
          collisionPadding={12}
          className="z-[100] max-w-[min(18rem,90vw)] rounded-md border border-edge bg-surface-panel px-2.5 py-1.5 text-xs text-fg shadow-popover"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
