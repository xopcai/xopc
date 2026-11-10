// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ObservationState, HomeAdvisor } from '@xopcai/gateway-contract';

import { HomeObservationCard } from './home-observation-card';

const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('@/lib/fetch', () => ({ fetchJson }));
vi.mock('./home-task-review', () => ({ HomeTaskReview: ({ taskId }: { taskId: string }) => <div>Trial review {taskId}</div> }));
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach(f => f()); vi.clearAllMocks(); });
const state: ObservationState = { id: 'observation', status: 'active', revision: 3, analyzedRevision: 3, lastProcessedAt: 1,
  topics: [{ id: 'topic', title: '项目周报', revision: 1, entries: [{ id: 'source', kind: 'user_work', text: '整理周报', createdAt: 1 }],
    feedback: [], trials: [] }] };
function render(observation = state, advisor: HomeAdvisor = { state: 'quiet', reason: 'no_change' }) {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); const updated = vi.fn();
  act(() => root.render(<HomeObservationCard observation={observation} advisor={advisor} language="zh" onUpdated={updated} />));
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  const button = (text: string) => [...container.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
  return { container, button, updated };
}
describe('Home observation card', () => {
  it('keeps raw conversation titles and scan status out of the empty card, with a usable chat entry', () => {
    const {container,button}=render({...state,analyzedRevision:0});
    expect(container.textContent).toContain('先做一件具体的事');
    expect(container.textContent).not.toContain('项目周报');
    expect(container.textContent).not.toContain('正在整理');
    const link=container.querySelector<HTMLAnchorElement>('a')!;
    expect(link.textContent).toContain('PR 审查准备清单');
    expect(new URL(link.href).hash).toContain('/chat/new?draft=');
    expect(fetchJson).not.toHaveBeenCalled();
    act(()=>button('记录与设置').click());
    expect(container.textContent).toContain('正在整理最近的工作记录');
    expect(container.textContent).not.toContain('项目周报');
    expect(container.textContent).not.toContain('整理周报');
  });

  it('confirms a concrete deliverable and starts a real private Task without a chat handoff',async()=>{
    fetchJson.mockResolvedValue({outcome:'task',taskId:'prepared',href:'/tasks/prepared'});
    const {container,button}=render({...state,starters:[{kind:'pr_review',topicIds:['topic'],requestCount:3,previews:['审查 PR 11622']}]});
    expect(container.textContent).toContain('最近有 3 条相关请求');
    expect(container.textContent).toContain('PR 审查准备清单');
    expect(container.querySelector('a')).toBeNull();
    act(()=>button('看看会做什么').click());
    expect(fetchJson).not.toHaveBeenCalled();
    expect(container.textContent).toContain('你会得到：PR 审查准备清单');
    await act(async()=>container.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    expect(fetchJson.mock.calls[0][0]).toContain('/observation/prepare');
    expect(JSON.parse(fetchJson.mock.calls[0][1].body)).toMatchObject({kind:'pr_review',topicIds:['topic'],expectedRevision:3,locale:'zh'});
    expect(container.textContent).toContain('Trial review prepared');
  });

  it('offers a grounded first attempt without turning unrelated history into a recommendation',async()=>{
    const advisor:HomeAdvisor={state:'ready',placement:'primary',generatedAt:1,expiresAt:9999999999999,stale:false,alternatives:[],primary:{
      id:'opportunity',revision:2,kind:'automation_candidate',title:'整理项目周报草稿',outcome:'一份附来源的周报草稿',rationale:'根据近期工作记录整理',
      evidence:[{id:'observation:topic:entry',sourceType:'conversation',sourceRef:'conversation',revision:'1',observation:'你整理过项目进展',observedAt:1,freshUntil:9999999999999}],
      confidence:'high',urgency:'this_week',risk:'analysis',proposedSteps:['整理进展'],capabilities:[],verification:['每项有来源'],actionPrompt:'整理草稿',
      actions:{canStart:true,canDiscuss:true,degradedStartAvailable:false},generatedAt:1,expiresAt:9999999999999,
    }};
    fetchJson.mockResolvedValue({outcome:'task',taskId:'trial',href:'/tasks/trial'});
    const {container,button}=render(state,advisor);
    expect(container.textContent).toContain('一份附来源的周报草稿');
    expect(container.querySelector('details')?.open).toBe(false);
    await act(async()=>button('先帮我做一次').click());
    expect(JSON.parse(fetchJson.mock.calls[0][1].body)).toMatchObject({topicId:'topic',opportunityId:'opportunity',expectedOpportunityRevision:2});
    expect(container.textContent).toContain('Trial review trial');
  });

  it('keeps one-off feedback scoped and retains the input on a stale revision response', async () => {
    const { container, button } = render({...state,topics:state.topics.map(t=>({...t,feedback:[{id:'feedback',text:'每项附来源',scope:'similar',status:'active',createdAt:1}]}))});
    act(() => button('记录与设置').click());
    act(() => button('管理').click());
    act(() => button('调整要求').click());
    const input = container.querySelector('textarea')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '只在发布期需要');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    fetchJson.mockRejectedValueOnce(new Error('Observation revision changed'));
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const body = JSON.parse(fetchJson.mock.calls[0][1].body);
    expect(body.command).toEqual({ kind: 'feedback', topicId: 'topic', text: '只在发布期需要', scope: 'once' });
    expect(body.expectedRevision).toBe(3);
    expect(container.querySelector('textarea')?.value).toBe('只在发布期需要');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('revision changed');
  });

  it('requires explicit resume coverage and a separate forget confirmation', async () => {
    fetchJson.mockResolvedValue(state);
    const { container, button } = render({ ...state, status: 'paused',topics:state.topics.map(t=>({...t,feedback:[{id:'feedback',text:'每项附来源',scope:'similar',status:'active',createdAt:1}]})) });
    act(() => button('恢复寻找建议').click());
    expect(fetchJson).not.toHaveBeenCalled();
    await act(async () => button('只看之后的工作').click());
    expect(JSON.parse(fetchJson.mock.calls[0][1].body).command).toEqual({ kind: 'resume', mode: 'new_only' });
    act(() => button('记录与设置').click());
    act(() => button('管理').click());
    act(() => button('不再参考这件事').click());
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('原始记录、已有任务和自动化保留');
    await act(async () => button('确认不再参考').click());
    expect(JSON.parse(fetchJson.mock.calls[1][1].body).command.kind).toBe('forget');
  });

  it('offers an explicit opt-in explaining its coverage', async () => {
    fetchJson.mockResolvedValue(state);
    const { container, button } = render({ status: 'disabled', revision: 0, analyzedRevision: 0, lastProcessedAt: null, topics: [] });
    expect(container.textContent).toContain('不扫描屏幕');
    expect(fetchJson).not.toHaveBeenCalled();
    await act(async () => button('帮我发现重复工作').click());
    expect(JSON.parse(fetchJson.mock.calls[0][1].body).command).toEqual({ kind: 'start', backfillDays: 30 });
  });
});
