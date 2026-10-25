import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { automationApi } from '@/features/automations/automation-api';
import { automationTriggerLabel, isCompletedOneTimeTask } from '@/features/automations/automation-display';
import { getLocalApp, getLocalAppSnapshot } from '@/features/local-apps/api';
import { localAppOpenRoute } from '@/features/local-apps/open-route';
import { fetchProject } from '@/features/projects/api';
import { messages } from '@/i18n/messages';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

import { AutomationRunPreview } from './automation-run-preview';
import { ProductPreviewSkeleton } from './product-preview-modal';
import type { ProductPreviewTarget } from './product-preview-route';

async function loadPreview(target: ProductPreviewTarget) {
  switch (target.kind) {
    case 'project': return { kind: target.kind, value: await fetchProject(target.id) } as const;
    case 'automation': {
      const [list, history] = await Promise.all([automationApi.list(), automationApi.runs(5, target.id)]);
      return { kind: target.kind, value: list.automations.find((item) => item.id === target.id), runs: history.runs } as const;
    }
    case 'local_app': {
      const app = await getLocalApp(target.id);
      const snapshot = target.sourceHash ? await getLocalAppSnapshot(target.id, target.sourceHash) : undefined;
      return { kind: target.kind, value: app, previewUrl: snapshot?.previewUrl || app.draftPreviewUrl } as const;
    }
  }
}

const STATES: Record<string, [string, string]> = {
  pending: ['等待中', 'Pending'], planned: ['计划中', 'Planned'], active: ['进行中', 'Active'], paused: ['已暂停', 'Paused'], completed: ['已完成', 'Completed'], cancelled: ['已取消', 'Cancelled'], archived: ['已归档', 'Archived'],
  queued: ['排队中', 'Queued'], running: ['运行中', 'Running'], succeeded: ['成功', 'Succeeded'], failed: ['失败', 'Failed'], timeout: ['超时', 'Timed out'], cancelling: ['取消中', 'Cancelling'],
  unknown: ['尚未评估', 'Not assessed'], on_track: ['进展正常', 'On track'], at_risk: ['存在风险', 'At risk'], off_track: ['偏离计划', 'Off track'],
};

export default function ProductPreviewContent({ target }: { target: ProductPreviewTarget }) {
  if (target.kind === 'automation' && target.view === 'run') return <AutomationRunPreview automationId={target.id} runId={target.runId} />;
  return <ProductDetailsPreview target={target} />;
}

function ProductDetailsPreview({ target }: { target: ProductPreviewTarget }) {
  const token = useGatewayStore((state) => state.conversationId);
  const language = useLocaleStore((state) => state.language);
  const zh = language === 'zh';
  const labels = messages(language);
  const stateLabel = (state: string) => STATES[state]?.[zh ? 0 : 1] || state;
  const { data, error, isLoading } = useSWR(['chat-product-preview', target.href, token], () => loadPreview(target), {
    shouldRetryOnError: false,
    refreshInterval: (latest) => latest?.kind === 'automation' && latest.value?.state.runningRunId ? 3000 : 0,
  });
  if (isLoading) return <ProductPreviewSkeleton />;
  if (error) return <p role="alert" className="text-sm text-fg-muted">{zh ? '无法加载内容，它可能已删除或暂时不可用。' : 'Unable to load this content. It may have been deleted or be temporarily unavailable.'}</p>;
  if (!data?.value) return <p className="text-sm text-fg-muted">{zh ? '内容不存在或已删除。' : 'This content is unavailable or has been deleted.'}</p>;
  const markdown = (content?: string) => content?.trim() ? <MarkdownView content={content} mermaidActions={false} /> : null;
  const headingClass = 'break-words text-lg font-semibold text-fg';
  const metaClass = 'text-sm text-fg-muted';
  const sectionClass = 'space-y-3';

  if (data.kind === 'project') {
    const project = data.value;
    return <div className="space-y-6">
      <div className={sectionClass}><h2 className={headingClass}>{project.name}</h2><p className={metaClass}>{stateLabel(project.status)} · {stateLabel(project.health)}</p>{markdown(project.description)}{markdown(project.brief)}{markdown(project.outcome)}</div>
      {project.successCriteria?.length > 0 && <section className={sectionClass}><h3 className="font-medium text-fg">{zh ? '完成标准' : 'Success criteria'}</h3><ul className="list-disc space-y-2 pl-5 text-sm text-fg">{project.successCriteria.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
      {project.milestones?.length > 0 && <section className={sectionClass}><h3 className="font-medium text-fg">{zh ? '里程碑' : 'Milestones'}</h3>{project.milestones.slice(0, 8).map((item) => <p key={item.id} className={metaClass}>{item.title} · {stateLabel(item.status)}</p>)}</section>}
      {project.recentUpdates?.[0] && <section className={sectionClass}><h3 className="font-medium text-fg">{zh ? '最近进展' : 'Latest update'}</h3>{markdown(project.recentUpdates[0].summary)}</section>}
    </div>;
  }


  if (data.kind === 'automation') {
    const automation = data.value;
    const instruction = automation.action.kind === 'agent' ? automation.action.instruction : undefined;
    return <div className="space-y-6"><div className={sectionClass}><h2 className={headingClass}>{automation.name}</h2><p className={metaClass}>{isCompletedOneTimeTask(automation) ? (zh ? '已完成' : 'Completed') : automation.enabled ? (zh ? '已启用' : 'Enabled') : (zh ? '已暂停' : 'Paused')} · {automationTriggerLabel(automation.trigger, labels.automations, labels.cron, language)}</p>{markdown(automation.description)}{markdown(instruction)}
      {automation.state.nextRunAtMs && <p className={metaClass}>{zh ? '下次运行' : 'Next run'} · {new Date(automation.state.nextRunAtMs).toLocaleString(zh ? 'zh-CN' : 'en-US')}</p>}
      {automation.state.lastError && <p role="alert" className="text-sm text-danger">{automation.state.lastError}</p>}</div>
      <section className={sectionClass}><h3 className="font-medium text-fg">{zh ? '最近运行' : 'Recent runs'}</h3>{data.runs.length ? data.runs.map((run) => <div key={run.id} className="space-y-2 rounded-lg border border-edge p-3"><p className={metaClass}>{stateLabel(run.status)} · {new Date(run.createdAtMs).toLocaleString(zh ? 'zh-CN' : 'en-US')}</p>{markdown(run.summary)}{run.error && <p className="text-sm text-danger">{run.error}</p>}</div>) : <p className={metaClass}>{zh ? '暂无运行记录。' : 'No runs yet.'}</p>}</section>
    </div>;
  }
  const app = data.value;
  return <div className="space-y-5"><h2 className={headingClass}>{app.name}</h2>{markdown(app.description || app.idea)}
    {data.previewUrl && <iframe title={zh ? `${app.name} 交互预览` : `${app.name} interactive preview`} src={apiUrl(data.previewUrl)} sandbox="allow-scripts allow-forms" className="h-[min(30rem,55dvh)] w-full rounded-lg border border-edge bg-white" />}
    {app.installationState === 'installed' && app.enabled && app.status === 'installed' && <Link to={localAppOpenRoute(app)} className="inline-flex rounded-lg bg-accent px-3 py-2 text-sm text-white focus-visible:ring-2 focus-visible:ring-accent">{zh ? '使用应用' : 'Use app'}</Link>}
  </div>;
}
