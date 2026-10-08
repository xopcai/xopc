import { ArtifactRecovery } from './artifact-recovery';
import { TaskExpandableContent } from './task-expandable-content';
import type { TaskEvidence } from '@xopcai/gateway-contract';
import { ExternalLink, FileText } from 'lucide-react';

import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';

export function TaskResultEvidence({ evidence, projectId, conversationId, language }: {
  evidence: TaskEvidence[]; projectId?: string; conversationId?: string; language: 'zh' | 'en';
}) {
  const setPath = useWorkspacePreviewStore((state) => state.setPath);
  if (!evidence.length) return null;
  return <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-label={language === 'zh' ? '交付物与验证依据' : 'Deliverables and evidence'}>
    {evidence.map((item, index) => {
      const uri = item.uri?.trim();
      const external = uri && /^https?:\/\//i.test(uri);
      const file = uri && !external && item.kind === 'artifact' && !/^[a-z][a-z0-9+.-]*:/i.test(uri) && !uri.startsWith('//');
      const label = item.title || (language === 'zh' ? '查看产物' : 'Open artifact');
      const controlClass = 'inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent hover:underline [overflow-wrap:anywhere]';
      return <div key={`${item.title}-${index}`} className="min-w-0 rounded-lg border border-edge-subtle p-3">
        <TaskExpandableContent content={label} contentKey={`${conversationId ?? projectId}:evidence-title:${index}:${item.title}`} language={language} previewHeight={60}>
        {external ? <a className={controlClass} href={uri} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4 shrink-0" /><span className="min-w-0 break-words">{label}</span></a>
          : file && (projectId || conversationId) ? <button type="button" className={controlClass} onClick={() => setPath(uri, null, projectId, conversationId)}><FileText className="size-4 shrink-0" />{label}</button>
          : <p className="break-words [overflow-wrap:anywhere] text-sm font-medium text-fg">{label}</p>}
        </TaskExpandableContent>
        {external && item.kind === 'artifact' && <ArtifactRecovery key={uri} uri={uri} zh={language === 'zh'} />}
        {item.summary ? <TaskExpandableContent content={item.summary} contentKey={`${conversationId ?? projectId}:evidence:${index}:${item.title}`} language={language} markdown={false} previewHeight={80} className="mt-1 text-xs leading-5 text-fg-muted" /> : null}
        <p className="mt-1 text-xs text-fg-subtle">{item.strength === 'verified' ? (language === 'zh' ? '已验证' : 'Verified') : (language === 'zh' ? '已记录，待验证' : 'Observed, not verified')}</p>
      </div>;
    })}
  </div>;
}
