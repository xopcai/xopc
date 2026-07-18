import type { GlobalHit } from '@/features/search/global-command-palette/types';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';

function formatAccelerator(accelerator: string | undefined): string | undefined {
  if (!accelerator) return undefined;
  return accelerator
    .replace(/CmdOrCtrl/g, 'Ctrl')
    .replace(/Command/g, 'Ctrl')
    .replace(/\+/g, ' + ');
}

/**
 * The native application menu is the source of truth for desktop actions.
 * Surface its commands in the palette instead of maintaining a second list.
 */
export async function buildDesktopMenuActionHits(
  language: StoredLanguage,
  closePalette: () => void,
): Promise<Array<Omit<GlobalHit, 'rank'>>> {
  const menu = window.electronAPI?.menu;
  if (!menu) return [];

  try {
    const groups = await menu.getModel();
    const groupLabel = messages(language).commandPalette.groups.actions;

    return groups.flatMap((group) =>
      group.items.flatMap((item) => {
        if (item.type !== 'item' || item.id.startsWith('role.')) return [];
        const accelerator = formatAccelerator(item.accelerator);
        return [
          {
            kind: 'action' as const,
            id: `desktop-menu:${item.id}`,
            title: item.label,
            subtitle: [group.label, accelerator].filter(Boolean).join(' · ') || undefined,
            groupLabel,
            keywords: [item.id, group.id, group.label, item.accelerator ?? ''],
            run: () => {
              closePalette();
              void menu.invoke(item.id);
            },
          },
        ];
      }),
    );
  } catch {
    return [];
  }
}
