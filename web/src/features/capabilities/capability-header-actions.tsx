import * as Popover from '@radix-ui/react-popover';
import { Search } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/lib/use-media-query';

export type CapabilityHeaderContribution = {
  search?: ReactNode;
  searchLabel?: string;
  secondary?: ReactNode;
  primary?: ReactNode;
  overflow?: ReactNode;
};

export type CapabilityHeaderActionChange = (contribution: CapabilityHeaderContribution | null) => void;

export const CapabilityHeaderSearch = memo(function CapabilityHeaderSearch({
  value,
  onChange,
  placeholder,
  ariaLabel = placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
}) {
  return (
    <label className="relative flex h-11 min-w-0 w-full cursor-text items-center rounded-xl border border-edge bg-surface-base pl-9 pr-3 text-fg shadow-none focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/30 md:h-9">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <input
        type="search"
        aria-label={ariaLabel}
        enterKeyHint="search"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="min-w-0 flex-1 appearance-none border-0 bg-transparent text-base leading-normal text-fg caret-current placeholder:text-fg-muted focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 md:text-sm"
      />
    </label>
  );
});

export function CapabilityHeaderActions({ contribution }: { contribution: CapabilityHeaderContribution | null }) {
  const showInlineSearch = useMediaQuery('(min-width: 768px)');

  return (
    <div className="flex min-w-0 items-center justify-end gap-2 xl:w-[27rem] 2xl:w-[31rem]">
      {contribution?.search ? (
        showInlineSearch ? (
          <div className="min-w-0 max-w-60 flex-1">{contribution.search}</div>
        ) : (
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button
                type="button"
                variant="secondary"
                className="size-9 shrink-0 p-0"
                aria-label={contribution.searchLabel}
                title={contribution.searchLabel}
              >
                <Search className="size-4" aria-hidden />
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={8}
                className="z-50 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-edge bg-surface-panel p-2 shadow-popover"
              >
                {contribution.search}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )
      ) : null}
      {contribution?.secondary}
      {contribution?.primary}
      {contribution?.overflow}
    </div>
  );
}
