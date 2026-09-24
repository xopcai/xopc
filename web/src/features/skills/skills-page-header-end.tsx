import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download, Loader2, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { memo } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { SkillsCopy } from '@/features/skills/skill-catalog-structured-preview';
import { messages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import { useLocaleStore } from '@/stores/locale-store';

export const SkillsHeaderOverflow = memo(function SkillsHeaderOverflow({
  loading,
  onReloadClick,
  sk,
  setPendingFile,
  setInstallOpen,
}: {
  loading: boolean;
  onReloadClick: () => void;
  sk: SkillsCopy;
  setPendingFile: (file: File | null) => void;
  setInstallOpen: (value: boolean) => void;
}) {
  const messageBundle = messages(useLocaleStore(state => state.language));
  const itemClassName = cn(
    'touch-target flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-fg outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover',
    interaction.transition,
  );

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button type="button" variant="secondary" className="size-9 shrink-0 p-0" aria-label={messageBundle.capabilitiesHub.moreActions} title={messageBundle.capabilitiesHub.moreActions}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-52 rounded-xl border border-edge bg-surface-panel p-1 shadow-popover">
          <DropdownMenu.Item asChild>
            <Link to="/settings/imports" className={itemClassName}>
              <Download className="size-4 text-fg-muted" aria-hidden />
              {messageBundle.imports.title}
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClassName} disabled={loading} onSelect={onReloadClick}>
            {loading ? <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden /> : <RefreshCw className="size-4 text-fg-muted" aria-hidden />}
            {sk.reloadRuntime}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={itemClassName}
            onSelect={() => {
              setPendingFile(null);
              setInstallOpen(true);
            }}
          >
            <Plus className="size-4 text-fg-muted" aria-hidden />
            {sk.installCta}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
});
