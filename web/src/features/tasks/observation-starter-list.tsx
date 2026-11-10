import { useState } from 'react';
import { HomeOpportunityActionResponseSchema, OBSERVATION_STARTER_COPY, type ObservationStarter } from '@xopcai/gateway-contract';

import { Button } from '@/components/ui/button';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export function ObservationStarterList({starters,revision,language,onStarted,onUpdated}:{
  starters:ObservationStarter[];revision:number;language:'zh'|'en';onStarted(taskId:string):void;onUpdated():void;
}) {
  const zh=language==='zh';
  const [selected,setSelected]=useState<ObservationStarter['kind']>();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const starter=starters.find(s=>s.kind===selected);
  const copy=starter && OBSERVATION_STARTER_COPY[starter.kind][language];
  return <div className="mt-3 space-y-3">
    <p className="text-base font-semibold text-fg">{zh?'这些工作，可以先帮你整理一份':'Here is work I can prepare for you'}</p>
    <p className="text-sm text-fg-muted">{zh?'从近期的相关请求中整理资料和待办，先给你看结果，再决定是否定期交给我。':'Turn recent requests into useful drafts. Review the result before deciding whether to make it recurring.'}</p>
    <div className="grid gap-3 sm:grid-cols-2">{starters.map(s=>{
      const item=OBSERVATION_STARTER_COPY[s.kind][language];
      return <article key={s.kind} className="flex min-w-0 flex-col items-start gap-2 rounded-lg border border-edge p-3">
        <h4 className="text-sm font-semibold text-fg">{item.title}</h4>
        <p className="text-sm leading-6 text-fg-muted">{item.output}</p>
        <p className="mt-auto text-xs text-fg-subtle">{zh?`最近有 ${s.requestCount} 条相关请求`:`${s.requestCount} related recent requests`}</p>
        <Button disabled={busy} aria-expanded={selected===s.kind} onClick={()=>{setSelected(s.kind);setError('');}}>{zh?'看看会做什么':'See what I will prepare'}</Button>
      </article>;
    })}</div>
    {starter && copy ? <form className="space-y-3 rounded-lg border border-edge bg-surface-inset p-3" onSubmit={event=>{
      event.preventDefault();if(busy)return;setBusy(true);setError('');
      void fetchJson(apiUrl('/api/home/observation/prepare'),{method:'POST',body:JSON.stringify({kind:starter.kind,topicIds:starter.topicIds,expectedRevision:revision,idempotencyKey:crypto.randomUUID(),locale:language})})
        .then(value=>{const result=HomeOpportunityActionResponseSchema.parse(value);if(result.outcome!=='task')throw Error(zh?'暂时无法开始，请稍后重试。':'Could not start this draft.');onStarted(result.taskId);setSelected(undefined);onUpdated();})
        .catch(cause=>{const message=cause instanceof Error?cause.message:String(cause);setError(/revision|Refresh|available/i.test(message)?(zh?'工作记录有更新，已刷新可用任务，请重新确认。':'Work has changed. Review the refreshed task and try again.'):message);onUpdated();})
        .finally(()=>setBusy(false));
    }}>
      <p className="text-sm font-semibold text-fg">{zh?`你会得到：${copy.title}`:`You will get: ${copy.title}`}</p>
      <ul className="list-disc space-y-1 pl-4 text-sm text-fg-muted">{copy.deliverables.map(item=><li key={item}>{item}</li>)}</ul>
      <details className="text-xs text-fg-muted"><summary className="cursor-pointer">{zh?'这次参考的请求':'Requests used for this draft'}</summary>{starter.previews.map((text,i)=><p key={i} className="mt-2 break-words">{text}</p>)}</details>
      <p className="text-xs leading-5 text-fg-muted">{zh?'先准备私人草稿，资料不足会标出来。不发消息，也不自动设定时。':'Prepare a private draft and flag missing material. No messages or recurring runs.'}</p>
      {error?<p role="alert" className="text-sm text-danger">{error}</p>:null}
      <Button variant="primary" type="submit" disabled={busy}>{busy?(zh?'正在创建任务…':'Starting…'):(zh?'先生成一份':'Prepare this draft')}</Button>
      <Button variant="ghost" disabled={busy} onClick={()=>setSelected(undefined)}>{zh?'取消':'Cancel'}</Button>
    </form>:null}
  </div>;
}
