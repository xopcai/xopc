import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';

import { useLocaleStore } from '@/stores/locale-store';

type DiffPresentation = Extract<NonNullable<ProductDeliveryEnvelope['presentation']>, { kind: 'diff' }>;

/** Read-only preview. A historical result never carries write or approval authority. */
export function ProductDeliveryDiffPreview({ presentation }: { presentation: DiffPresentation }) {
  const zh = useLocaleStore(state => state.language) === 'zh';

  return (
    <section className="mt-2 rounded-lg border border-edge bg-surface-panel p-3" aria-label={zh ? '编辑预览' : 'Edit preview'}>
      <h3 className="text-sm font-medium text-fg">{zh ? '建议修改（尚未应用）' : 'Proposed changes (not applied)'}</h3>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-muted">{presentation.title}</p>
      <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">
        {presentation.edits.map((edit, index) => (
          <details key={index} className="rounded border border-edge-subtle p-2">
            <summary className="cursor-pointer rounded text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              {zh ? '替换范围' : 'Replace range'} {edit.from}–{edit.to}
            </summary>
            <pre className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-xs text-fg">{edit.text}</pre>
          </details>
        ))}
      </div>
      {presentation.truncated ? (
        <p role="status" className="mt-2 text-xs text-fg-muted">
          {zh ? '仅显示部分内容，请查看完整工具结果。' : 'Partial content shown. Inspect the full tool result.'}
        </p>
      ) : null}
    </section>
  );
}
