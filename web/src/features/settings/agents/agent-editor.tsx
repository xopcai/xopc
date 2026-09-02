import {
  AlertTriangle,
  Bot,
  Gauge,
  MessageSquarePlus,
  RotateCcw,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { updateGatewayAgent } from '@/features/settings/agents-admin-api';
import type {
  AgentModelsOverride,
  AgentOverride,
  GatewayAgentRow,
  ModelIntent,
  ModelRoute,
  ToolPolicy,
} from '@/features/settings/types/agent-gateway';
import { cn } from '@/lib/cn';

type AgentPanel = 'overview' | 'profile' | 'models' | 'capabilities' | 'runtime' | 'danger';

const INTENTS: ModelIntent[] = ['fast', 'reasoning', 'coding', 'review', 'vision', 'understanding'];
const inputClass = 'w-full rounded-xl border border-edge bg-surface-base px-3 py-2.5 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';

function splitList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function optionalPositiveInt(value: string): number | undefined {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function InheritedBadge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent">{children}</span>;
}

function SectionTitle({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="text-base font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-1 text-sm leading-5 text-fg-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-edge bg-surface-base p-4">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-fg" title={value}>{value}</p>
      <p className="mt-1 text-xs text-fg-subtle">{detail}</p>
    </div>
  );
}

function ModelRouteEditor({
  label,
  inherited,
  value,
  zh,
  allowChatFallback = false,
  allowDisabled = false,
  onChange,
}: {
  label: string;
  inherited?: ModelRoute;
  value: ModelRoute | null | undefined;
  zh: boolean;
  allowChatFallback?: boolean;
  allowDisabled?: boolean;
  onChange: (value: ModelRoute | null | undefined) => void;
}) {
  const customized = value !== undefined && value !== null;
  return (
    <div className="rounded-2xl border border-edge bg-surface-base p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-fg">{label}</h4>
            {value === undefined ? <InheritedBadge>{zh ? '继承' : 'Inherited'}</InheritedBadge> : null}
            {value === null ? <InheritedBadge>{allowDisabled ? (zh ? '已禁用' : 'Disabled') : (zh ? '使用 Chat' : 'Uses Chat')}</InheritedBadge> : null}
          </div>
          {value === undefined ? <p className="mt-1 truncate font-mono text-xs text-fg-muted">{inherited?.primary ?? (zh ? '全局未配置' : 'Not configured globally')}</p> : null}
        </div>
        <div className="flex gap-1">
          {value !== undefined ? <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange(undefined)}>{zh ? '继承' : 'Inherit'}</Button> : null}
          {allowChatFallback && value !== null ? <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange(null)}>{zh ? '使用 Chat' : 'Use Chat'}</Button> : null}
          {allowDisabled && value !== null ? <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onChange(null)}>{zh ? '禁用' : 'Disable'}</Button> : null}
          {!customized ? <Button className="px-2 py-1 text-xs" onClick={() => onChange({ primary: inherited?.primary ?? '', fallbacks: [...(inherited?.fallbacks ?? [])] })}>{zh ? '自定义' : 'Customize'}</Button> : null}
        </div>
      </div>
      {customized ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
          <label className="text-xs font-medium text-fg-muted">
            {zh ? '主模型' : 'Primary model'}
            <input className={`${inputClass} mt-1.5 font-mono`} value={value.primary} onChange={(event) => onChange({ ...value, primary: event.target.value })} />
          </label>
          <label className="text-xs font-medium text-fg-muted">
            {zh ? '回退模型' : 'Fallbacks'}
            <input className={`${inputClass} mt-1.5 font-mono`} value={value.fallbacks.join(', ')} onChange={(event) => onChange({ ...value, fallbacks: splitList(event.target.value) })} placeholder={zh ? '逗号分隔' : 'Comma separated'} />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function cleanObject<T extends Record<string, unknown>>(value: T): T | undefined {
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

export function AgentEditor({
  agent,
  toolIds,
  zh,
  externalError,
  onDirtyChange,
  onClose,
  onOpenDefaults,
  onChat,
  onDelete,
}: {
  agent: GatewayAgentRow;
  toolIds: string[];
  zh: boolean;
  externalError?: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  onOpenDefaults: () => void;
  onChat: () => void;
  onDelete: () => void;
}) {
  const [panel, setPanel] = useState<AgentPanel>('overview');
  const [draft, setDraft] = useState<AgentOverride>(() => structuredClone(agent.override));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(agent.override);
  const invalidModelOverride = [
    draft.models?.chat,
    ...Object.values(draft.models?.intents ?? {}),
    draft.models?.imageUnderstanding,
    draft.models?.imageGeneration,
  ].some((route) => route !== undefined && route !== null && !route.primary.trim());

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const allTools = useMemo(
    () => [...new Set([...toolIds, ...Object.keys(agent.effective.tools), ...Object.keys(draft.tools ?? {})])].sort(),
    [agent.effective.tools, draft.tools, toolIds],
  );
  const overrideLabels = [
    draft.models ? (zh ? '模型' : 'Models') : null,
    draft.skills ? (zh ? '技能' : 'Skills') : null,
    draft.tools ? (zh ? '工具权限' : 'Tool access') : null,
    draft.runtime || draft.workflows ? (zh ? '运行限制' : 'Runtime') : null,
  ].filter((label): label is string => Boolean(label));
  const deniedToolCount = Object.values(agent.effective.tools).filter((policy) => policy.mode === 'deny').length;
  const skillSummary = agent.effective.skills.mode === 'selected'
    ? (zh ? `${agent.effective.skills.include.length} 个已选技能` : `${agent.effective.skills.include.length} selected skills`)
    : (zh ? '所有已启用技能' : 'All enabled skills');

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await updateGatewayAgent(agent.id, {
        workspace: draft.workspace ?? null,
        profile: draft.profile,
        models: draft.models ?? null,
        skills: draft.skills ?? null,
        tools: draft.tools ?? null,
        workflows: draft.workflows ?? null,
        runtime: draft.runtime ?? null,
      });
      const saved = next.agents.find((candidate) => candidate.id === agent.id);
      if (saved) setDraft(structuredClone(saved.override));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const makeDefault = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateGatewayAgent(agent.id, { setDefault: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const setTool = (id: string, mode: ToolPolicy['mode'] | 'inherit') => {
    const tools = { ...(draft.tools ?? {}) };
    if (mode === 'inherit') delete tools[id];
    else tools[id] = { ...tools[id], mode };
    setDraft({ ...draft, tools: Object.keys(tools).length > 0 ? tools : undefined });
  };

  const setIntent = (intent: ModelIntent, route: ModelRoute | null | undefined) => {
    const models: AgentModelsOverride = { ...(draft.models ?? {}) };
    const intents = { ...(models.intents ?? {}) };
    if (route === undefined) delete intents[intent];
    else intents[intent] = route;
    if (Object.keys(intents).length > 0) models.intents = intents;
    else delete models.intents;
    setDraft({ ...draft, models: Object.keys(models).length > 0 ? models : undefined });
  };

  const navItems: Array<{ id: AgentPanel; label: string; icon: typeof Gauge }> = [
    { id: 'overview', label: zh ? '概览' : 'Overview', icon: Gauge },
    { id: 'profile', label: zh ? '个性' : 'Profile', icon: UserRound },
    { id: 'models', label: zh ? '模型' : 'Models', icon: Sparkles },
    { id: 'capabilities', label: zh ? '技能与工具' : 'Skills & tools', icon: Bot },
    { id: 'runtime', label: zh ? '运行限制' : 'Runtime', icon: Gauge },
    { id: 'danger', label: zh ? '危险区' : 'Danger zone', icon: AlertTriangle },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <aside className="shrink-0 overflow-x-auto border-b border-edge px-3 py-3 sm:w-52 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:px-3 sm:py-4">
        <nav className="flex gap-1 sm:flex-col">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPanel(id)}
              className={cn(
                'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                panel === id ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {error || externalError ? <p className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error ?? externalError}</p> : null}

          {panel === 'overview' ? (
            <div className="space-y-6">
              <SectionTitle
                title={zh ? '配置概览' : 'Configuration overview'}
                description={zh ? '查看当前真正生效的配置。Agent 未覆盖的部分会持续跟随全局默认值。' : 'Review what actually takes effect. Anything not overridden keeps following global defaults.'}
                action={<Button onClick={onChat}><MessageSquarePlus className="size-4" />{zh ? '开始对话' : 'Start chat'}</Button>}
              />
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-4">
                <div>
                  <p className="text-sm font-medium text-fg">
                    {overrideLabels.length > 0
                      ? (zh ? `已自定义：${overrideLabels.join('、')}` : `Customized: ${overrideLabels.join(', ')}`)
                      : (zh ? '能力配置使用全局默认' : 'Capabilities use global defaults')}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">
                    {overrideLabels.length > 0
                      ? (zh ? '其他能力会继续跟随全局默认配置。' : 'All other capabilities continue to follow global defaults.')
                      : (zh ? '修改全局默认配置后，这个 Agent 会自动同步。' : 'This agent updates automatically when global defaults change.')}
                  </p>
                </div>
                <Button onClick={onOpenDefaults}>{zh ? '查看全局默认配置' : 'View global defaults'}</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard label={zh ? '对话模型' : 'Chat model'} value={agent.effective.models.chat.primary} detail={draft.models?.chat ? (zh ? 'Agent 覆盖' : 'Agent override') : (zh ? '继承全局' : 'Inherited globally')} />
                <SummaryCard label={zh ? '技能' : 'Skills'} value={skillSummary} detail={draft.skills ? (zh ? 'Agent 覆盖' : 'Agent override') : (zh ? '继承全局' : 'Inherited globally')} />
                <SummaryCard label={zh ? '工具权限' : 'Tool access'} value={deniedToolCount > 0 ? (zh ? `${deniedToolCount} 个禁用` : `${deniedToolCount} denied`) : (zh ? '全部可用' : 'All available')} detail={draft.tools ? (zh ? `${Object.keys(draft.tools).length} 个本地覆盖` : `${Object.keys(draft.tools).length} local overrides`) : (zh ? '继承全局' : 'Inherited globally')} />
                <SummaryCard label={zh ? '工作区' : 'Workspace'} value={agent.effective.workspace} detail={draft.workspace ? (zh ? 'Agent 自定义' : 'Agent specific') : (zh ? '自动工作区' : 'Automatic workspace')} />
              </div>
              {!agent.isDefault ? <Button onClick={() => void makeDefault()} disabled={saving}>{zh ? '设为默认 Agent' : 'Make default agent'}</Button> : null}
            </div>
          ) : null}

          {panel === 'profile' ? (
            <div className="space-y-6">
              <SectionTitle title={zh ? '个性与工作区' : 'Profile and workspace'} description={zh ? '这里只放这个 Agent 独有的身份、表达方式和工作目录。' : 'Keep only this agent’s identity, behavior, and workspace here.'} />
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-medium text-fg-muted">
                  {zh ? '名称' : 'Name'}
                  <input className={`${inputClass} mt-1.5`} value={draft.profile?.name ?? ''} onChange={(event) => setDraft({ ...draft, profile: { name: event.target.value, ...(draft.profile?.instructions ? { instructions: draft.profile.instructions } : {}) } })} />
                </label>
                <label className="text-xs font-medium text-fg-muted">
                  <span className="flex items-center gap-2">{zh ? '工作区' : 'Workspace'}{!draft.workspace ? <InheritedBadge>{zh ? '自动' : 'Automatic'}</InheritedBadge> : null}</span>
                  <input className={`${inputClass} mt-1.5 font-mono`} value={draft.workspace ?? ''} placeholder={agent.effective.workspace} onChange={(event) => setDraft({ ...draft, workspace: event.target.value || undefined })} />
                </label>
              </div>
              <label className="block text-xs font-medium text-fg-muted">
                {zh ? '个性指令' : 'Personality instructions'}
                <textarea rows={10} className={`${inputClass} mt-1.5 resize-y leading-6`} value={draft.profile?.instructions ?? ''} onChange={(event) => setDraft({ ...draft, profile: { name: draft.profile?.name || agent.name, instructions: event.target.value || undefined } })} placeholder={zh ? '描述角色、语气、判断偏好和工作方式' : 'Describe the role, tone, judgment preferences, and working style'} />
              </label>
            </div>
          ) : null}

          {panel === 'models' ? (
            <div className="space-y-6">
              <SectionTitle title={zh ? '模型路由' : 'Model routing'} description={zh ? '日常对话使用 Chat；固定意图只在对应任务中生效。默认继承全局。' : 'Chat handles normal turns; fixed intents apply only to matching work. Everything inherits by default.'} action={draft.models ? <Button variant="ghost" onClick={() => setDraft({ ...draft, models: undefined })}><RotateCcw className="size-4" />{zh ? '全部继承' : 'Inherit all'}</Button> : undefined} />
              <ModelRouteEditor label="Chat" inherited={agent.effective.models.chat} value={draft.models?.chat} zh={zh} onChange={(chat) => {
                const models = { ...(draft.models ?? {}) };
                if (chat) models.chat = chat;
                else delete models.chat;
                setDraft({ ...draft, models: Object.keys(models).length > 0 ? models : undefined });
              }} />
              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{zh ? '固定意图' : 'Fixed intents'}</h4>
                <div className="space-y-3">
                  {INTENTS.map((intent) => (
                    <ModelRouteEditor
                      key={intent}
                      label={intent}
                      inherited={agent.effective.models.intents[intent] ?? agent.effective.models.chat}
                      value={draft.models?.intents?.[intent]}
                      zh={zh}
                      allowChatFallback
                      onChange={(route) => setIntent(intent, route)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{zh ? '图片能力' : 'Image capabilities'}</h4>
                <div className="space-y-3">
                  <ModelRouteEditor
                    label={zh ? '图片理解' : 'Image understanding'}
                    inherited={agent.effective.models.imageUnderstanding}
                    value={draft.models?.imageUnderstanding}
                    zh={zh}
                    allowDisabled
                    onChange={(imageUnderstanding) => {
                      const models = { ...(draft.models ?? {}) };
                      if (imageUnderstanding === undefined) delete models.imageUnderstanding;
                      else models.imageUnderstanding = imageUnderstanding;
                      setDraft({ ...draft, models: Object.keys(models).length > 0 ? models : undefined });
                    }}
                  />
                  <ModelRouteEditor
                    label={zh ? '图片生成' : 'Image generation'}
                    inherited={agent.effective.models.imageGeneration}
                    value={draft.models?.imageGeneration}
                    zh={zh}
                    allowDisabled
                    onChange={(imageGeneration) => {
                      const models = { ...(draft.models ?? {}) };
                      if (imageGeneration === undefined) delete models.imageGeneration;
                      else if (imageGeneration === null) models.imageGeneration = null;
                      else models.imageGeneration = {
                        ...imageGeneration,
                        timeoutMs: draft.models?.imageGeneration?.timeoutMs ?? agent.effective.models.imageGeneration?.timeoutMs,
                        autoProviderFallback: draft.models?.imageGeneration?.autoProviderFallback ?? agent.effective.models.imageGeneration?.autoProviderFallback ?? true,
                      };
                      setDraft({ ...draft, models: Object.keys(models).length > 0 ? models : undefined });
                    }}
                  />
                  {draft.models?.imageGeneration ? (
                    <div className="grid gap-4 rounded-2xl border border-edge bg-surface-base p-4 sm:grid-cols-2">
                      <label className="text-xs font-medium text-fg-muted">{zh ? '生成超时（毫秒）' : 'Generation timeout (ms)'}<input type="number" min={1} className={`${inputClass} mt-1.5`} value={draft.models.imageGeneration.timeoutMs ?? ''} onChange={(event) => setDraft({ ...draft, models: { ...draft.models, imageGeneration: { ...draft.models!.imageGeneration!, timeoutMs: optionalPositiveInt(event.target.value) } } })} /></label>
                      <div className="text-xs font-medium text-fg-muted"><span>{zh ? '提供商自动回退' : 'Automatic provider fallback'}</span><div className="mt-1.5 flex rounded-xl bg-surface-hover p-1">{([true, false] as const).map((enabled) => <button key={String(enabled)} type="button" onClick={() => setDraft({ ...draft, models: { ...draft.models, imageGeneration: { ...draft.models!.imageGeneration!, autoProviderFallback: enabled } } })} className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-medium', draft.models?.imageGeneration?.autoProviderFallback === enabled ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted')}>{enabled ? (zh ? '开启' : 'On') : (zh ? '关闭' : 'Off')}</button>)}</div></div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {panel === 'capabilities' ? (
            <div className="space-y-7">
              <SectionTitle title={zh ? '技能与工具' : 'Skills and tools'} description={zh ? '保持继承即可获得全局能力；只有确实不同的 Agent 才需要覆盖。' : 'Keep inheritance for global capabilities; override only agents that genuinely differ.'} />
              <section className="rounded-2xl border border-edge bg-surface-base p-4">
                <div className="flex items-center justify-between gap-3">
                  <div><h4 className="text-sm font-semibold text-fg">{zh ? '技能策略' : 'Skill policy'}</h4><p className="mt-1 text-xs text-fg-muted">{draft.skills ? (zh ? '当前使用 Agent 覆盖' : 'Using an agent override') : (zh ? '当前继承全局' : 'Currently inherited globally')}</p></div>
                  {draft.skills ? <Button variant="ghost" onClick={() => setDraft({ ...draft, skills: undefined })}><RotateCcw className="size-4" />{zh ? '继承' : 'Inherit'}</Button> : null}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant={draft.skills?.mode === 'merge' ? 'primary' : 'secondary'} onClick={() => setDraft({ ...draft, skills: { mode: 'merge', add: [], remove: [] } })}>Merge</Button>
                  <Button variant={draft.skills?.mode === 'replace' ? 'primary' : 'secondary'} onClick={() => setDraft({ ...draft, skills: { mode: 'replace', include: [] } })}>Replace</Button>
                </div>
                {draft.skills?.mode === 'merge' ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-fg-muted">{zh ? '新增技能' : 'Add skills'}<input className={`${inputClass} mt-1.5`} value={draft.skills.add.join(', ')} onChange={(event) => setDraft({ ...draft, skills: { mode: 'merge', add: splitList(event.target.value), remove: draft.skills?.mode === 'merge' ? draft.skills.remove : [] } })} /></label><label className="text-xs font-medium text-fg-muted">{zh ? '移除技能' : 'Remove skills'}<input className={`${inputClass} mt-1.5`} value={draft.skills.remove.join(', ')} onChange={(event) => setDraft({ ...draft, skills: { mode: 'merge', add: draft.skills?.mode === 'merge' ? draft.skills.add : [], remove: splitList(event.target.value) } })} /></label></div> : null}
                {draft.skills?.mode === 'replace' ? <label className="mt-4 block text-xs font-medium text-fg-muted">{zh ? '仅启用这些技能' : 'Enable only these skills'}<input className={`${inputClass} mt-1.5`} value={draft.skills.include.join(', ')} onChange={(event) => setDraft({ ...draft, skills: { mode: 'replace', include: splitList(event.target.value) } })} /></label> : null}
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-semibold text-fg">{zh ? '工具权限' : 'Tool permissions'}</h4>{draft.tools ? <Button variant="ghost" onClick={() => setDraft({ ...draft, tools: undefined })}><RotateCcw className="size-4" />{zh ? '全部继承' : 'Inherit all'}</Button> : null}</div>
                <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-base">
                  {allTools.map((id) => {
                    const local = draft.tools?.[id]?.mode;
                    const effective = agent.effective.tools[id]?.mode ?? 'allow';
                    return <div key={id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><code className="text-xs text-fg">{id}</code><p className="mt-1 text-[11px] text-fg-muted">{local ? (zh ? 'Agent 覆盖' : 'Agent override') : `${zh ? '继承' : 'Inherits'} ${effective}`}</p></div><div className="flex rounded-xl bg-surface-hover p-1">{(['inherit', 'allow', 'ask', 'deny'] as const).map((mode) => <button key={mode} type="button" onClick={() => setTool(id, mode)} className={cn('rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors', (mode === 'inherit' ? !local : local === mode) ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg')}>{mode}</button>)}</div></div>;
                  })}
                </div>
              </section>
            </div>
          ) : null}

          {panel === 'runtime' ? (
            <div className="space-y-6">
              <SectionTitle title={zh ? '运行限制' : 'Runtime limits'} description={zh ? '留空即继承全局限制。这里适合为特殊 Agent 收紧或放宽执行边界。' : 'Leave blank to inherit global limits. Use overrides only to tighten or relax a specialist agent.'} action={draft.runtime || draft.workflows ? <Button variant="ghost" onClick={() => setDraft({ ...draft, runtime: undefined, workflows: undefined })}><RotateCcw className="size-4" />{zh ? '全部继承' : 'Inherit all'}</Button> : undefined} />
              <div className="grid gap-4 sm:grid-cols-2">
                {([
                  ['maxTurns', zh ? '单次最大轮数' : 'Maximum turns'],
                  ['timeoutMs', zh ? '单轮超时（毫秒）' : 'Turn timeout (ms)'],
                  ['maxToolFailuresPerTurn', zh ? '最大工具失败次数' : 'Maximum tool failures'],
                ] as const).map(([key, label]) => <label key={key} className="text-xs font-medium text-fg-muted"><span className="flex items-center gap-2">{label}{draft.runtime?.[key] === undefined ? <InheritedBadge>{zh ? '继承' : 'Inherited'}</InheritedBadge> : null}</span><input type="number" min={1} className={`${inputClass} mt-1.5`} value={draft.runtime?.[key] ?? ''} placeholder={String(agent.effective.runtime[key] ?? '')} onChange={(event) => { const runtime = cleanObject({ ...(draft.runtime ?? {}), [key]: optionalPositiveInt(event.target.value) }); setDraft({ ...draft, runtime }); }} /></label>)}
              </div>
              <section className="rounded-2xl border border-edge bg-surface-base p-4">
                <h4 className="text-sm font-semibold text-fg">{zh ? '工作流' : 'Workflows'}</h4>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-medium text-fg-muted">{zh ? '默认工作流' : 'Default workflow'}<input className={`${inputClass} mt-1.5`} value={draft.workflows?.default ?? ''} placeholder={agent.effective.workflows.default} onChange={(event) => { const workflows = cleanObject({ ...(draft.workflows ?? {}), default: event.target.value || undefined }); setDraft({ ...draft, workflows }); }} /></label>
                  <label className="text-xs font-medium text-fg-muted">{zh ? '允许的工作流' : 'Allowed workflows'}<input className={`${inputClass} mt-1.5`} value={draft.workflows?.allowed?.join(', ') ?? ''} placeholder={agent.effective.workflows.allowed?.join(', ')} onChange={(event) => { const allowed = splitList(event.target.value); const workflows = cleanObject({ ...(draft.workflows ?? {}), allowed: allowed.length > 0 ? allowed : undefined }); setDraft({ ...draft, workflows }); }} /></label>
                </div>
              </section>
              <section className="rounded-2xl border border-edge bg-surface-base p-4">
                <div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold text-fg">{zh ? '提示词缓存' : 'Prompt cache'}</h4><p className="mt-1 text-xs text-fg-muted">{draft.runtime?.promptCache ? (zh ? '使用 Agent 覆盖' : 'Using agent override') : (zh ? '继承全局' : 'Inherited globally')}</p></div>{draft.runtime?.promptCache ? <Button variant="ghost" onClick={() => { const runtime = cleanObject({ ...(draft.runtime ?? {}), promptCache: undefined }); setDraft({ ...draft, runtime }); }}><RotateCcw className="size-4" />{zh ? '继承' : 'Inherit'}</Button> : null}</div>
                {draft.runtime?.promptCache ? <div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="text-xs font-medium text-fg-muted"><span>{zh ? '模式' : 'Mode'}</span><div className="mt-1.5 flex rounded-xl bg-surface-hover p-1">{(['auto', 'off'] as const).map((mode) => <button key={mode} type="button" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { ...draft.runtime!.promptCache!, mode } } })} className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-medium', draft.runtime?.promptCache?.mode === mode ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted')}>{mode}</button>)}</div></div><div className="text-xs font-medium text-fg-muted"><span>{zh ? '缓存周期' : 'Lifetime'}</span><div className="mt-1.5 flex rounded-xl bg-surface-hover p-1">{(['short', 'long'] as const).map((lifetime) => <button key={lifetime} type="button" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { ...draft.runtime!.promptCache!, lifetime } } })} className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-medium', draft.runtime?.promptCache?.lifetime === lifetime ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted')}>{lifetime}</button>)}</div></div></div> : <Button className="mt-4" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { ...(agent.effective.runtime.promptCache ?? { mode: 'auto', lifetime: 'short' }) } } })}>{zh ? '自定义缓存策略' : 'Customize cache policy'}</Button>}
              </section>
            </div>
          ) : null}

          {panel === 'danger' ? (
            <div className="space-y-6">
              <SectionTitle title={zh ? '危险区' : 'Danger zone'} description={zh ? '这些操作会改变默认路由或移除 Agent。' : 'These actions change default routing or remove the agent.'} />
              {!agent.isDefault ? <div className="flex items-center justify-between gap-4 rounded-2xl border border-edge bg-surface-base p-4"><div><h4 className="text-sm font-semibold text-fg">{zh ? '设为默认 Agent' : 'Make default agent'}</h4><p className="mt-1 text-xs text-fg-muted">{zh ? '新会话和未指定路由将使用这个 Agent。' : 'New sessions and unspecified routes will use this agent.'}</p></div><Button disabled={saving} onClick={() => void makeDefault()}>{zh ? '设为默认' : 'Make default'}</Button></div> : null}
              {!agent.isDefault ? <div className="flex items-center justify-between gap-4 rounded-2xl border border-red-500/25 bg-red-500/5 p-4"><div><h4 className="text-sm font-semibold text-red-600">{zh ? '删除 Agent' : 'Delete agent'}</h4><p className="mt-1 text-xs text-fg-muted">{zh ? '配置条目会被移除，删除前仍会再次确认。' : 'The configuration entry will be removed after confirmation.'}</p></div><Button variant="ghost" className="text-red-600" onClick={onDelete}><AlertTriangle className="size-4" />{zh ? '删除' : 'Delete'}</Button></div> : <p className="rounded-2xl bg-surface-base p-4 text-sm text-fg-muted">{zh ? '默认 Agent 不能删除，请先将其他 Agent 设为默认。' : 'The default agent cannot be deleted. Make another agent the default first.'}</p>}
            </div>
          ) : null}
        </main>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-edge bg-surface-panel px-5 py-3">
          <p className="text-xs text-fg-muted">{invalidModelOverride ? (zh ? '请补全自定义模型' : 'Complete the custom model reference') : dirty ? (zh ? '有未保存的更改' : 'Unsaved changes') : (zh ? '所有更改已保存' : 'All changes saved')}</p>
          <div className="flex gap-2"><Button onClick={onClose}>{zh ? '关闭' : 'Close'}</Button><Button variant="primary" disabled={saving || !dirty || invalidModelOverride || (draft.profile !== undefined && !draft.profile.name.trim())} onClick={() => void save()}>{saving ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存更改' : 'Save changes')}</Button></div>
        </footer>
      </div>
    </div>
  );
}
