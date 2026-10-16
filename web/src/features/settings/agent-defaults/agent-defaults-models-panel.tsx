import { Link } from 'react-router-dom';

import { AgentDefaultsVoiceSummary } from './agent-defaults-voice-summary';
import { modelCapabilityPath } from '../models-hub/capability-navigation';
import type { AgentDefaults } from '../types/agent-gateway';

export function AgentDefaultsModelsPanel({ draft, zh }: { draft: AgentDefaults; zh: boolean }) {
  const rows = [
    { use: 'chat' as const, label: zh ? '对话与任务' : 'Chat and tasks', model: draft.models.chat.primary },
    { use: 'vision' as const, label: zh ? '看图' : 'Image understanding', model: draft.models.imageUnderstanding?.primary },
    { use: 'image' as const, label: zh ? '生成图片' : 'Image generation', model: draft.models.imageGeneration?.primary },
    { use: 'background' as const, label: zh ? '自动与后台任务' : 'Background tasks', model: draft.models.background?.primary },
  ];
  return <div className="space-y-5">
    <section className="rounded-xl border border-edge p-5">
      <h2 className="text-base font-semibold text-fg">{zh ? '共用模型' : 'Shared models'}</h2>
      <p className="mt-1 text-sm text-fg-muted">{zh ? '所有智能体默认使用这些模型。在「模型与能力」统一管理；单个智能体可以单独覆盖。' : 'Agents inherit these models. Manage them under Models and capabilities; individual agents can override them.'}</p>
      <div className="mt-4 divide-y divide-edge">
        {rows.map(row => <Link key={row.use} to={modelCapabilityPath(row.use)} className="flex min-h-14 items-center justify-between gap-4 py-3 text-sm hover:bg-surface-hover rounded-lg px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span className="min-w-0"><span className="block font-medium text-fg">{row.label}</span><span className="block break-all text-fg-muted">{row.model ?? (row.use === 'background' ? (zh ? '按对话模型的使用范围解析' : 'Resolved from the chat model usage scope') : (zh ? '未配置' : 'Not configured'))}</span></span>
          <span className="shrink-0 text-accent-fg">{zh ? '管理' : 'Manage'}</span>
        </Link>)}
      </div>
      <Link to={modelCapabilityPath()} className="mt-4 inline-block text-sm text-accent-fg hover:underline">{zh ? '查看全部模型与能力' : 'View all models and capabilities'}</Link>
    </section>
    <AgentDefaultsVoiceSummary zh={zh} />
  </div>;
}
