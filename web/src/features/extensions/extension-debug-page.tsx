/**
 * Extension debug — Settings panel: extension list and declared permissions.
 */

import { useMemo } from 'react';

import { useExtensions } from '@/features/extensions/extension-provider';
import { SettingsPageFrame, SettingsPageHeader } from '@/features/settings/settings-page-layout';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

export function ExtensionDebugPage() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).extensionDebug;
  const extensions = useExtensions();
  const sorted = useMemo(
    () => extensions.toSorted((a, b) => a.id.localeCompare(b.id)),
    [extensions],
  );

  return (
    <SettingsPageFrame gap="gap-5">
      <SettingsPageHeader title={t.title} subtitle={t.subtitle} />

      <section className="rounded-xl bg-surface-hover/20 p-4">
        <h2 className="text-sm font-semibold text-fg">{t.listHeading}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-separate border-spacing-y-1 text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-fg-muted">
                <th className="px-3 py-2">{t.colId}</th>
                <th className="px-3 py-2">{t.colName}</th>
                <th className="px-3 py-2">{t.colPermissions}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} className="bg-surface-base/55">
                  <td className="rounded-l-lg px-3 py-2 font-mono text-xs text-fg">{e.id}</td>
                  <td className="px-3 py-2 text-fg">{e.name}</td>
                  <td className="rounded-r-lg px-3 py-2 font-mono text-xs text-fg-muted">
                    {(e.ui?.permissions ?? []).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl bg-surface-hover/20 p-4 text-sm text-fg-muted">
        <h2 className="text-sm font-semibold text-fg">{t.futureHeading}</h2>
        <p className="mt-2">{t.futureBody}</p>
      </section>
    </SettingsPageFrame>
  );
}
