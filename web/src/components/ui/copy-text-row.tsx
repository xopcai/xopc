import {
  Content as TooltipContent,
  Portal as TooltipPortal,
  Provider as TooltipProvider,
  Root as TooltipRoot,
  Trigger as TooltipTrigger,
} from '@radix-ui/react-tooltip';
import { Check, Copy } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { copyTextToClipboard, selectInputText } from '@/lib/copy-to-clipboard';
import { cn } from '@/lib/cn';

const copyTooltipClass =
  '!z-[10000] max-w-[min(28rem,90vw)] rounded-md border border-edge bg-surface-panel px-2.5 py-2 text-left text-xs leading-snug text-fg shadow-lg';

const copyInputClass =
  'block w-full min-w-0 truncate rounded border border-transparent bg-surface-hover px-2 py-1.5 font-mono text-xs text-fg focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';

const copyButtonClass = 'inline-flex w-[5.25rem] shrink-0 items-center justify-center gap-1 px-2 py-1 text-xs';

export type CopyTextRowLabels = {
  copy: string;
  copied: string;
  copyFailed: string;
};

export function CopyTextRow({
  label,
  text,
  compact,
  labels,
  monospace = true,
}: {
  label?: string;
  text: string;
  compact?: boolean;
  labels: CopyTextRowLabels;
  monospace?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const handleCopy = async () => {
    setCopyFailed(false);
    const ok = await copyTextToClipboard(text);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return;
    }
    selectInputText(inputRef.current);
    setCopyFailed(true);
    window.setTimeout(() => setCopyFailed(false), 2500);
  };

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', compact && 'gap-0.5')}>
      {label ? <span className="text-xs font-medium text-fg-muted">{label}</span> : null}
      <div className="grid grid-cols-[minmax(0,1fr)_5.25rem] items-center gap-2">
        <div className="min-w-0 overflow-hidden">
          <TooltipRoot>
            <TooltipTrigger asChild>
              <input
                ref={inputRef}
                readOnly
                type="text"
                value={text}
                aria-label={label ?? labels.copy}
                className={cn(copyInputClass, !monospace && 'font-sans')}
                onFocus={(e) => e.currentTarget.select()}
              />
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent side="top" sideOffset={6} collisionPadding={12} className={copyTooltipClass}>
                <span className="break-all">{text}</span>
              </TooltipContent>
            </TooltipPortal>
          </TooltipRoot>
        </div>
        <Button
          type="button"
          variant="secondary"
          className={copyButtonClass}
          onClick={() => void handleCopy()}
        >
          {copied ? <Check className="size-3.5 shrink-0" /> : <Copy className="size-3.5 shrink-0" />}
          <span className="truncate">{copied ? labels.copied : labels.copy}</span>
        </Button>
      </div>
      {copyFailed ? <p className="text-xs text-red-600 dark:text-red-400">{labels.copyFailed}</p> : null}
    </div>
  );
}

export function CopyTextRowList({
  rows,
  compact,
  labels,
}: {
  rows: Array<{ key: string; label?: string; text: string }>;
  compact?: boolean;
  labels: CopyTextRowLabels;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('flex min-w-0 flex-col gap-2', compact && 'gap-1.5')}>
        {rows.map((row) => (
          <CopyTextRow key={row.key} label={row.label} text={row.text} compact={compact} labels={labels} />
        ))}
      </div>
    </TooltipProvider>
  );
}
