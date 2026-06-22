import JSZip from 'jszip';
import { useEffect, useState } from 'react';

import { PreviewOpenAlternativesBar } from '@/features/preview/preview-open-alternatives';
import type { PreviewPlugin, PreviewRuntimeRenderProps } from '@/features/preview-runtime/preview-types';
import { messages } from '@/i18n/messages';

export function ArchivePreviewPluginView(props: PreviewRuntimeRenderProps) {
  const [entries, setEntries] = useState<Array<{ name: string; dir: boolean; size: number }>>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.binaryBuffer) return;
    let cancelled = false;
    void JSZip.loadAsync(props.binaryBuffer)
      .then((zip) => {
        if (cancelled) return;
        setEntries(
          Object.values(zip.files)
            .slice(0, 500)
            .map((f) => ({
              name: f.name,
              dir: f.dir,
              size: f.dir ? 0 : ((f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0),
            })),
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [props.binaryBuffer]);

  if (error) {
    const m = messages(props.language);
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        <PreviewOpenAlternativesBar
          message={m.chat.attachmentPreviewOpenElsewhereHint}
          downloadLabel={m.chat.attachmentPreviewDownloadFull}
          onDownload={props.actions.onDownload}
        />
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <div className="overflow-hidden rounded-lg border border-edge bg-surface-panel">
        {entries.length === 0 ? (
          <p className="p-4 text-sm text-fg-muted">Loading archive...</p>
        ) : (
          <table className="w-full text-left text-xs">
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.name} className="border-b border-edge-subtle last:border-b-0 dark:border-edge">
                  <td className="max-w-0 truncate px-3 py-2 font-mono text-fg" title={entry.name}>
                    {entry.dir ? `${entry.name}/` : entry.name}
                  </td>
                  <td className="w-24 px-3 py-2 text-right text-fg-muted">{entry.dir ? '' : formatBytes(entry.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export const archivePlugin: PreviewPlugin = {
  id: 'archive',
  readMode: 'binary',
  capabilities: ['download'],
  render: (props) => <ArchivePreviewPluginView {...props} />,
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}
