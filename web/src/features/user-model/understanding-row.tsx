import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';

import { MemoryActions } from './memory-actions';
import type { UserAssertion } from './user-model-api';
import { formatUnderstandingDate, type UnderstandingLanguage } from './understanding-row.utils';

function authorityLabel(item: UserAssertion, language: UnderstandingLanguage): string {
  const labels = language === 'zh'
    ? {
        user_explicit: '你告诉我的',
        user_observed: '从协作中观察到',
        system_inferred: 'xopc 的推测',
        external_untrusted: '来自连接的信息',
      }
    : {
        user_explicit: 'You told me',
        user_observed: 'Observed while working together',
        system_inferred: 'Inferred by xopc',
        external_untrusted: 'From connected information',
      };
  return labels[item.authority];
}

function timeHorizon(item: UserAssertion, language: UnderstandingLanguage): string {
  if (item.validTo) {
    const date = formatUnderstandingDate(item.validTo, language);
    return language === 'zh' ? `适用至 ${date}` : `Applies until ${date}`;
  }
  const labels = language === 'zh'
    ? { stable: '相对稳定', slow: '会随时间复核', dynamic: '近期状态', event: '特定阶段' }
    : { stable: 'Relatively stable', slow: 'Reviewed over time', dynamic: 'Current context', event: 'Specific period' };
  return labels[item.volatility];
}

function confidenceLabel(item: UserAssertion, language: UnderstandingLanguage): string | null {
  if (item.authority === 'user_explicit') return null;
  if (item.confidence >= 0.85) return language === 'zh' ? '把握较高' : 'High confidence';
  if (item.confidence >= 0.65) return language === 'zh' ? '把握中等' : 'Medium confidence';
  return language === 'zh' ? '证据较少' : 'Limited evidence';
}

function scopeLabel(scope: UserAssertion['scope'], language: UnderstandingLanguage): string {
  const labels = language === 'zh'
    ? { global: '所有协作', agent: '当前智能体', workspace: '当前工作区', project: '当前项目', session: '当前会话' }
    : { global: 'All work', agent: 'This agent', workspace: 'This workspace', project: 'This project', session: 'This conversation' };
  return labels[scope.type];
}

export function UnderstandingRow({
  item,
  language,
  busy,
  editing,
  draft,
  onDraftChange,
  onEdit,
  onCancel,
  onDelete,
  onCorrect,
  onScopeChange,
}: {
  item: UserAssertion;
  language: UnderstandingLanguage;
  busy: boolean;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onCorrect: () => void;
  onScopeChange?: (scope: UserAssertion['scope']) => void;
}) {
  const inputId = useId();
  const [expanded, setExpanded] = useState(false);
  const zh = language === 'zh';
  const confidence = confidenceLabel(item, language);
  const sourceLabels = [...new Set(item.sources?.map((source) => source.label).filter(Boolean))];
  const editLabel = zh ? '修改' : 'Edit';

  return (
    <article className="border-t border-edge-subtle px-4 py-3 first:border-t-0 sm:px-5 [content-visibility:auto] [contain-intrinsic-size:auto_100px]">
      {editing ? (
        <div className="space-y-3">
          <label className="text-sm font-medium text-fg" htmlFor={inputId}>{zh ? '修改这条理解' : 'Edit this understanding'}</label>
          <textarea
            id={inputId}
            value={draft}
            disabled={busy}
            onChange={(event) => onDraftChange(event.target.value)}
            className="mt-2 min-h-28 w-full resize-y rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-base leading-7 text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onCancel}>{zh ? '取消' : 'Cancel'}</Button>
            <Button variant="primary" disabled={!draft.trim() || busy} onClick={onCorrect}>{busy ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存修改' : 'Save changes')}</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 sm:flex sm:gap-4">
          <div className="contents min-w-0 flex-1 pt-1.5 sm:block">
            <p className="col-span-2 whitespace-pre-wrap break-words text-base leading-7 text-fg">{!expanded && item.statement.length > 240 ? `${item.statement.slice(0, 240)}…` : item.statement}</p>
            {item.statement.length > 240 ? <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="col-span-2 mt-1 min-h-11 rounded-md text-left text-sm text-accent-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{expanded ? (zh ? '收起全文' : 'Show less') : (zh ? '展开全文' : 'Read more')}</button> : null}
            <div className="col-start-1 mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-fg-muted">
              <span>{authorityLabel(item, language)}</span>
              {item.usable === false ? <span>{zh ? '暂不使用' : 'Not in use'}</span> : null}
              {item.validTo ? <span>{timeHorizon(item, language)}</span> : null}
              {item.authority !== 'user_explicit' && item.confidence < 0.65 ? <span>{confidence}</span> : null}
              <details className="open:basis-full">
                <summary className="flex min-h-11 w-fit cursor-pointer items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"><span className="sm:hidden">{zh ? '查看来源' : 'Sources'}</span><span className="hidden sm:inline">{zh ? '来源与使用方式' : 'Sources & use'}</span></summary>
                <div className="my-2 space-y-1 border-l-2 border-edge pl-3 text-sm leading-6">
                  <p>{item.usable === false ? (zh ? '目前不会用于回答。' : 'Currently not used in responses.') : (zh ? '回答相关问题时，xopc 会参考这条信息。' : 'xopc can refer to this when answering related questions.')}</p>
                  <p>{zh ? '适用范围：' : 'Applies to: '}{scopeLabel(item.scope, language)}</p>
                  {item.validTo ? <p>{timeHorizon(item, language)}</p> : null}
                  {confidence ? <p>{zh ? '确定程度：' : 'Confidence: '}{confidence}</p> : null}
                  <p>{zh ? '最近记录：' : 'Last noted: '}{formatUnderstandingDate(item.observedAt, language)}</p>
                  {sourceLabels.length ? sourceLabels.map((label) => <p className="break-words" key={label}>{label}</p>) : <p>{zh ? '暂无更详细的来源记录' : 'No further source details available'}</p>}
                </div>
              </details>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <Button variant="ghost" className="min-h-11 min-w-11 px-2" disabled={busy} onClick={onEdit}>{editLabel}</Button>
            <MemoryActions language={language} busy={busy} statement={item.statement} scope={item.scope} onEdit={onEdit} onDelete={onDelete} onScopeChange={onScopeChange} />
          </div>
        </div>
      )}
    </article>
  );
}
