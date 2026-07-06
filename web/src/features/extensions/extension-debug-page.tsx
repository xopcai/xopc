/**
 * Extension debug — Settings panel: extension list, declared permissions, UI grant fingerprints.
 */

import { useMemo, useState } from 'react';

import { useExtensions } from '@/features/extensions/extension-provider';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

const GRANTS_STORAGE_KEY = 'xopc.extensionUiGrants.v1';

export function ExtensionDebugPage() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).extensionDebug;
  const extensions = useExtensions();
  const [grantsRaw, setGrantsRaw] = useState(() => readGrantsSafe());

  const sorted = useMemo(
    () => extensions.toSorted((a, b) => a.id.localeCompare(b.id)),
    [extensions],
  );

  return (
    <div className="flex w-full flex-col gap-6 px-3 py-8 sm:px-5 xl:px-6">
      <div>
        <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
      </div>

      <section className="rounded-xl border border-edge bg-surface-base p-4">
        <h2 className="text-sm font-semibold text-fg">{t.grantsHeading}</h2>
        <p className="mt-1 text-xs text-fg-muted">{t.grantsHint}</p>
        <pre className="mt-3 max-h-48 overflow-auto rounded-lg border border-edge-subtle bg-surface-muted p-3 font-mono text-xs text-fg">
          {grantsRaw}
        </pre>
        <button
          type="button"
          className="mt-3 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover"
          onClick={() => setGrantsRaw(readGrantsSafe())}
        >
          {t.refresh}
        </button>
      </section>

      <section className="rounded-xl border border-edge bg-surface-base p-4">
        <h2 className="text-sm font-semibold text-fg">{t.listHeading}</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-edge text-xs uppercase text-fg-muted">
                <th className="py-2 pr-2">{t.colId}</th>
                <th className="py-2 pr-2">{t.colName}</th>
                <th className="py-2">{t.colPermissions}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id} className="border-b border-edge-subtle">
                  <td className="py-2 pr-2 font-mono text-xs text-fg">{e.id}</td>
                  <td className="py-2 pr-2 text-fg">{e.name}</td>
                  <td className="py-2 font-mono text-xs text-fg-muted">
                    {(e.ui?.permissions ?? []).join(', ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-dashed border-edge-subtle bg-surface-muted/50 p-4 text-sm text-fg-muted">
        <h2 className="text-sm font-semibold text-fg">{t.futureHeading}</h2>
        <p className="mt-2">{t.futureBody}</p>
      </section>
    </div>
  );
}

function readGrantsSafe(): string {
  try {
    const raw = localStorage.getItem(GRANTS_STORAGE_KEY);
    if (!raw) return '{}';
    const parsed = JSON.parse(raw) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
