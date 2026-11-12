import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Paperclip, Video } from 'lucide-react';
import { useRef, type ReactElement } from 'react';

const itemClass = 'touch-target flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-45';
const icons = { video: Video };

export type ComposerAddActions = {
  label: string;
  items: Array<{ kind: keyof typeof icons; label: string; onSelect: () => void }>;
};

export function ComposerAddMenu({ trigger, fileLabel, filesDisabled, onPickFiles, actions }: {
  trigger: ReactElement;
  fileLabel: string;
  filesDisabled: boolean;
  onPickFiles: () => void;
  actions: ComposerAddActions;
}) {
  const creationSelected = useRef(false);
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content side="top" align="start" sideOffset={6}
        onCloseAutoFocus={event => {
          if (creationSelected.current) event.preventDefault();
          creationSelected.current = false;
        }}
        className="z-[100] min-w-40 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover">
        <DropdownMenu.Item className={itemClass} disabled={filesDisabled} onSelect={onPickFiles}>
          <Paperclip className="size-4" aria-hidden />{fileLabel}
        </DropdownMenu.Item>
        {actions.items.map(({ kind, label, onSelect }) => {
          const Icon = icons[kind];
          return <DropdownMenu.Item key={kind} className={itemClass} onSelect={() => {
            creationSelected.current = typeof globalThis.matchMedia === 'function'
              && globalThis.matchMedia('(hover: hover) and (pointer: fine)').matches;
            onSelect();
          }}>
            <Icon className="size-4" aria-hidden />{label}
          </DropdownMenu.Item>;
        })}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
