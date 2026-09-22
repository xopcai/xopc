import type { ProductDeliveryEnvelope } from '@xopcai/gateway-contract';
import { productReferenceOpenRoute } from '@xopcai/gateway-contract';
import { Link } from 'react-router-dom';

import { useLocaleStore } from '@/stores/locale-store';

/** Read-only presentation. A historical card never carries write or approval authority. */
export function ProductDeliveryPresentation({ presentation }: {
  presentation: NonNullable<ProductDeliveryEnvelope['presentation']>;
}) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const truncated = presentation.truncated ? <p role="status" className="mt-2 text-xs text-fg-muted">
    {zh ? '仅显示部分内容，请打开原对象或查看完整工具结果。' : 'Partial content shown. Open the source or inspect the full tool result.'}
  </p> : null;
  if (presentation.kind === 'diff') return <section className="mt-2 rounded-lg border border-edge bg-surface-panel p-3" aria-label={zh ? '编辑预览' : 'Edit preview'}>
    <h3 className="text-sm font-medium text-fg">{zh ? '建议修改（尚未应用）' : 'Proposed changes (not applied)'}</h3>
    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-fg-muted">{presentation.title}</p>
    <div className="mt-2 max-h-80 space-y-2 overflow-y-auto">{presentation.edits.map((edit, index) => <details key={index} className="rounded border border-edge-subtle p-2">
      <summary className="cursor-pointer rounded text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        {zh ? '替换范围' : 'Replace range'} {edit.from}–{edit.to}
      </summary>
      <pre className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-xs text-fg">{edit.text}</pre>
    </details>)}</div>{truncated}
  </section>;
  return <section className="mt-2 min-w-0 rounded-lg border border-edge bg-surface-panel p-3" aria-label={zh ? '查询结果' : 'Query results'}>
    <div className="max-h-80 overflow-auto"><table className="w-full table-fixed text-left text-sm">
      <caption className="pb-2 text-left font-medium text-fg">{zh ? '查询结果' : 'Query results'} · {presentation.items.length}</caption>
      <thead className="text-xs text-fg-muted"><tr><th scope="col" className="w-2/3 py-2">{zh ? '对象' : 'Resource'}</th><th scope="col">{zh ? '状态' : 'Status'}</th></tr></thead>
      <tbody>{presentation.items.map((item, index) => {
        const route = item.capabilities.includes('open') ? productReferenceOpenRoute(item) : null;
        return <tr key={`${item.kind}:${item.id}:${index}`} className="border-t border-edge-subtle">
          <td className="py-2 pr-3 [overflow-wrap:anywhere]">{route
            ? <Link className="rounded text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" to={route}>{item.title}</Link>
            : item.title}<span className="mt-1 block text-xs text-fg-muted">{item.kind} · {item.id}</span></td>
          <td className="py-2 [overflow-wrap:anywhere] text-fg-muted">{item.status ?? '—'}</td>
        </tr>;
      })}</tbody>
    </table></div>
    {!presentation.items.length ? <p className="text-sm text-fg-muted">{zh ? '没有匹配的对象。' : 'No matching resources.'}</p> : null}{truncated}
  </section>;
}
