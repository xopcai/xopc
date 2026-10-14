import {
  AlertTriangle,
  MessageSquarePlus,
  RotateCcw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PageTabs } from '@/components/ui/page-tabs';
import { NumberInput } from '@/components/ui/number-input';
import { Button } from '@/components/ui/button';
import { DirectoryPickerPathField } from '@/features/fs/directory-picker-path-field';
import {
  AgentProfileEditor,
  type AgentProfileEditorHandle,
} from '@/features/settings/agents/agent-profile-editor';
import { ModelRouteEditor } from '@/features/settings/agents/agent-model-route-editor';
import { updateGatewayAgent, uploadGatewayAgentAvatar } from '@/features/settings/agents-admin-api';
import { CREATURE_PRESETS } from '@/features/settings/agents/agent-profile-markdown';
import type {
  AgentModelsOverride,
  AgentOverride,
  AgentProfile,
  GatewayAgentRow,
  ModelIntent,
  ModelRoute,
  ToolPolicy,
} from '@/features/settings/types/agent-gateway';
import { messages as getMessages, type AgentsSettingsMessages } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/use-media-query';

import { AgentAvatarField, type PendingAgentAvatar } from './agent-avatar-field';
import { bumpAgentAvatarCacheRevision } from './agent-avatar-cache';
import { SpecialistProfileEditor } from './specialist-profile-editor';

type AgentPanel = 'overview' | 'profile' | 'capabilities' | 'work';
type CapabilityPanel = 'specialties' | 'models' | 'tools';
type WorkPanel = 'directory' | 'instructions' | 'tools' | 'runtime';

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

function SummaryCard({ label, value, detail, onClick }: { label: string; value: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-w-0 rounded-2xl border border-edge bg-surface-base p-4 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-fg" title={value}>{value}</p>
      <p className="mt-1 text-xs text-fg-subtle">{detail}</p>
    </button>
  );
}

function AdvancedSection({ title, summary, children }: { title: string; summary?: React.ReactNode; children: React.ReactNode }) {
  return <details className="rounded-xl border border-edge bg-surface-base p-4">
    <summary className="cursor-pointer text-sm font-medium text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{title}{summary ? <span className="ml-2 text-xs font-normal text-fg-muted">{summary}</span> : null}</summary>
    <div className="mt-4">{children}</div>
  </details>;
}

function cleanObject<T extends Record<string, unknown>>(value: T): T | undefined {
  return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

export function AgentEditor({
  agent,
  toolIds,
  zh,
  messages,
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
  messages: AgentsSettingsMessages;
  externalError?: string | null;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
  onOpenDefaults: () => void;
  onChat: () => void;
  onDelete: () => void;
}) {
  const [panel, setPanel] = useState<AgentPanel>('overview');
  const desktopNavigation = useMediaQuery('(min-width: 640px)');
  const [capabilityPanel, setCapabilityPanel] = useState<CapabilityPanel>('specialties');
  const [workPanel, setWorkPanel] = useState<WorkPanel>('directory');
  const [workVisited, setWorkVisited] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});
  const [draft, setDraft] = useState<AgentOverride>(() => structuredClone(agent.override));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileVisited, setProfileVisited] = useState(false);
  const [documentDirty, setDocumentDirty] = useState({ soul: false, agents: false, tools: false });
  const profileFilesDirty = Object.values(documentDirty).some(Boolean);
  const profileEditorRef = useRef<AgentProfileEditorHandle>(null);
  const workEditorRef = useRef<AgentProfileEditorHandle>(null);
  const toolEditorRef = useRef<AgentProfileEditorHandle>(null);
  const [pendingAvatar, setPendingAvatar] = useState<PendingAgentAvatar | null>(null);
  const [avatarReading, setAvatarReading] = useState(false);

  const configDirty = JSON.stringify(draft) !== JSON.stringify(agent.override);
  const dirty = configDirty || profileFilesDirty || pendingAvatar !== null;
  const invalidModelOverride = [
    draft.models?.chat,
    ...Object.values(draft.models?.intents ?? {}),
    draft.models?.imageUnderstanding,
    draft.models?.imageGeneration,
  ].some((route) => route !== undefined && route !== null && !route.primary.trim());

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const allTools = useMemo(
    () => [...new Set([
      ...toolIds, ...Object.keys(agent.effective.tools), ...Object.keys(draft.tools ?? {}),
      ...(draft.toolAllowlist ?? []),
    ])].sort(),
    [agent.effective.tools, draft.toolAllowlist, draft.tools, toolIds],
  );
  const overrideLabels = [
    draft.models ? (zh ? '模型' : 'Models') : null,
    draft.skills ? (zh ? '技能' : 'Skills') : null,
    draft.tools ? (zh ? '工具权限' : 'Tool access') : null,
    draft.runtime || draft.workflows ? (zh ? '运行限制' : 'Runtime') : null,
  ].filter((label): label is string => Boolean(label));
  const toolAllowlist = draft.toolAllowlist;
  const availableToolCount = toolAllowlist
    ? allTools.filter((id) => toolAllowlist.includes(id) && agent.effective.tools[id]?.mode !== 'deny').length
    : null;
  const deniedToolCount = Object.values(agent.effective.tools).filter((policy) => policy.mode === 'deny').length;
  const skillSummary = agent.effective.skills.mode === 'selected'
    ? (zh ? `${agent.effective.skills.include.length} 个已选技能` : `${agent.effective.skills.include.length} selected skills`)
    : (zh ? '所有已启用技能' : 'All enabled skills');
  const profileName = draft.profile?.name ?? agent.name ?? agent.id;
  const updateIdentity = (field: keyof Pick<AgentProfile, 'name' | 'description' | 'creature' | 'style' | 'language' | 'emoji' | 'avatar'>, value: string) => {
    setDraft((current) => ({
      ...current,
      profile: { ...current.profile, name: current.profile?.name ?? agent.name ?? agent.id, [field]: value },
    }));
  };
  const workingDirectoryMessages = getMessages(zh ? 'zh' : 'en').chat.workingDirectory;
  const intentLabels: Record<ModelIntent, string> = {
    fast: messages.editorIntentFast,
    reasoning: messages.editorIntentReasoning,
    coding: messages.editorIntentCoding,
    review: messages.editorIntentReview,
    vision: messages.editorIntentVision,
    understanding: messages.editorIntentUnderstanding,
  };
  const toolModeLabels = {
    inherit: messages.editorToolModeInherit,
    allow: messages.editorToolModeAllow,
    ask: messages.editorToolModeAsk,
    deny: messages.editorToolModeDeny,
  } as const;

  const save = async () => {
    const completed: string[] = [];
    setSaving(true);
    setError(null);
    try {
      await profileEditorRef.current?.save();
      if (documentDirty.soul) completed.push(zh ? '个性与边界' : 'Personality & boundaries');
      await workEditorRef.current?.save();
      if (documentDirty.agents) completed.push(zh ? '工作规范' : 'Working instructions');
      await toolEditorRef.current?.save();
      if (documentDirty.tools) completed.push(zh ? '工具使用约定' : 'Tool guidance');
      if (pendingAvatar) {
        await uploadGatewayAgentAvatar(agent.id, pendingAvatar);
        bumpAgentAvatarCacheRevision(agent.id);
        completed.push(zh ? '头像图片' : 'Avatar image');
      }
      const next = await updateGatewayAgent(agent.id, {
        expectedRevision: agent.revision,
        specialistProfile: draft.specialistProfile ?? null,
        workspace: draft.workspace ?? null,
        profile: draft.profile,
        models: draft.models ?? null,
        skills: draft.skills ?? null,
        tools: draft.tools ?? null,
        toolAllowlist: draft.toolAllowlist ?? null,
        workflows: draft.workflows ?? null,
        runtime: draft.runtime ?? null,
      });
      const saved = next.agents.find((candidate) => candidate.id === agent.id);
      if (saved) setDraft(structuredClone(saved.override));
      setDocumentDirty({ soul: false, agents: false, tools: false });
      setSavedOnce(true);
      setPendingAvatar(null);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      setError(completed.length ? (zh ? `已保存：${completed.join('、')}。其余更改未保存，请重试。${reason}` : `Saved: ${completed.join(', ')}. Remaining changes were not saved; retry. ${reason}`) : reason);
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

  const setToolAvailable = (id: string, available: boolean) => {
    const toolAllowlist = new Set(draft.toolAllowlist ?? []);
    if (available) toolAllowlist.add(id);
    else toolAllowlist.delete(id);
    const tools = { ...(draft.tools ?? {}) };
    if (available && (tools[id]?.mode === 'deny' || agent.effective.tools[id]?.mode === 'deny')) {
      tools[id] = { ...tools[id], mode: 'allow' };
    }
    setDraft({
      ...draft,
      toolAllowlist: [...toolAllowlist],
      tools: Object.keys(tools).length > 0 ? tools : undefined,
    });
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

  const handleProfileFilesDirty = useCallback((value: boolean) => setDocumentDirty(current => ({ ...current, soul: value })), []);
  const handleWorkFilesDirty = useCallback((value: boolean) => setDocumentDirty(current => ({ ...current, agents: value })), []);
  const handleToolFilesDirty = useCallback((value: boolean) => setDocumentDirty(current => ({ ...current, tools: value })), []);
  const differs = (keys: Array<keyof AgentOverride>) => keys.some(key => JSON.stringify(draft[key]) !== JSON.stringify(agent.override[key]));
  const identityChanged = JSON.stringify({ ...draft.profile, instructions: undefined }) !== JSON.stringify({ ...agent.override.profile, instructions: undefined });
  const profileDirty = identityChanged || documentDirty.soul || pendingAvatar !== null;
  const capabilityDirty = differs(['models', 'skills', 'tools', 'toolAllowlist', 'specialistProfile']);
  const workDirty = differs(['workspace', 'runtime', 'workflows']) || draft.profile?.instructions !== agent.override.profile?.instructions || documentDirty.agents || documentDirty.tools;
  const dirtySuffix = (value: boolean) => value ? <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label={zh ? '有未保存的更改' : 'Unsaved changes'} /> : undefined;
  const navItems = [
    { id: 'overview' as const, label: zh ? '概览' : 'Overview' },
    { id: 'profile' as const, label: zh ? '个性' : 'Personality', suffix: dirtySuffix(profileDirty) },
    { id: 'capabilities' as const, label: zh ? '能力' : 'Capabilities', suffix: dirtySuffix(capabilityDirty) },
    { id: 'work' as const, label: zh ? '工作设置' : 'Work settings', suffix: dirtySuffix(workDirty) },
  ];
  const scrollKey = panel === 'capabilities' ? `${panel}:${capabilityPanel}` : panel === 'work' ? `${panel}:${workPanel}` : panel;
  const switchPanel = (next: AgentPanel, capability = capabilityPanel, work = workPanel) => {
    scrollPositions.current[scrollKey] = mainRef.current?.scrollTop ?? 0;
    if (next === 'profile') setProfileVisited(true);
    if (next === 'work') setWorkVisited(true);
    setPanel(next);
    setCapabilityPanel(capability);
    setWorkPanel(work);
  };
  useEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = scrollPositions.current[scrollKey] ?? 0;
  }, [scrollKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <aside className="shrink-0 border-b border-edge px-3 py-2 sm:w-44 sm:overflow-y-auto sm:border-b-0 sm:border-r sm:py-4">
        <PageTabs items={navItems} activeTab={panel} onChange={switchPanel}
          ariaLabel={zh ? '智能体设置' : 'Agent settings'} tabIdPrefix="agent-tab" panelIdPrefix="agent-panel"
          orientation={desktopNavigation ? 'vertical' : 'horizontal'}
          className="m-0 grid grid-cols-4 overflow-visible p-0 sm:flex sm:flex-col" buttonClassName="min-w-0 justify-center px-1 text-xs sm:justify-start sm:px-3 sm:py-3 sm:text-sm [&>span]:min-w-0 [&>span]:break-words"
          selectedClassName="bg-accent-soft text-accent-fg" />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <main ref={mainRef} role="tabpanel" id={`agent-panel-${panel}`} aria-labelledby={`agent-tab-${panel}`} tabIndex={0} className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:p-6">
          {error || externalError ? <p role="alert" className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{error ?? externalError}</p> : null}

          {panel === 'overview' ? (
            <div className="space-y-6">
              <SectionTitle
                title={profileName}
                description={zh ? '查看当前真正生效的配置。未覆盖的部分会持续跟随全局默认值。' : 'Review what actually takes effect. Anything not overridden keeps following global defaults.'}
                action={<Button onClick={onChat}><MessageSquarePlus className="size-4" />{zh ? '开始对话' : 'Start chat'}</Button>}
              />
              <section className="space-y-3 rounded-2xl border border-edge bg-surface-base p-4">
                <p className="text-sm leading-6 text-fg-muted">{draft.profile?.description || (zh ? '添加介绍，让这个智能体的定位更清晰。' : 'Add a description to explain this agent’s role.')}</p>
                <div className="flex flex-wrap items-center gap-2">
                  {(draft.specialistProfile?.specialties ?? []).map(item => <span key={item} className="rounded-lg bg-surface-hover px-2 py-1 text-xs text-fg-muted">{item}</span>)}
                  <Button variant="ghost" onClick={() => switchPanel('capabilities', 'specialties')}>{zh ? '查看专长' : 'View specialties'}</Button>
                  <Button variant="ghost" onClick={() => switchPanel('profile')}>{zh ? '编辑个性' : 'Edit personality'}</Button>
                </div>
              </section>
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
                      : (zh ? '修改全局默认配置后，这个智能体会自动同步。' : 'This agent updates automatically when global defaults change.')}
                  </p>
                </div>
                <Button onClick={onOpenDefaults}>{zh ? '查看全局默认配置' : 'View global defaults'}</Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard onClick={() => switchPanel('capabilities', 'models')} label={zh ? '对话模型' : 'Chat model'} value={agent.effective.models.chat.primary} detail={draft.models?.chat ? (zh ? '单独设置' : 'Agent override') : (zh ? '继承全局' : 'Inherited globally')} />
                <SummaryCard onClick={() => switchPanel('capabilities', 'tools')} label={zh ? '技能' : 'Skills'} value={skillSummary} detail={draft.skills ? (zh ? '单独设置' : 'Agent override') : (zh ? '继承全局' : 'Inherited globally')} />
                <SummaryCard onClick={() => switchPanel('capabilities', 'tools')} label={zh ? '工具权限' : 'Tool access'} value={availableToolCount !== null ? (zh ? `${availableToolCount} 个已开放` : `${availableToolCount} in scope`) : deniedToolCount > 0 ? (zh ? `${deniedToolCount} 个禁用` : `${deniedToolCount} denied`) : (zh ? '全部可用' : 'All available')} detail={toolAllowlist ? (zh ? '受智能体工具范围限制' : 'Limited by agent tool scope') : draft.tools ? (zh ? `${Object.keys(draft.tools).length} 个本地覆盖` : `${Object.keys(draft.tools).length} local overrides`) : (zh ? '继承全局' : 'Inherited globally')} />
                <SummaryCard onClick={() => switchPanel('work', capabilityPanel, 'directory')} label={zh ? '工作区' : 'Workspace'} value={agent.effective.workspace} detail={draft.workspace ? (zh ? '单独设置' : 'Agent specific') : (zh ? '自动工作区' : 'Automatic workspace')} />
              </div>
              {!agent.isDefault ? <Button onClick={() => void makeDefault()} disabled={saving}>{zh ? '设为默认智能体' : 'Make default agent'}</Button> : null}
              {!agent.isDefault ? <div className="flex items-center justify-between gap-4 rounded-2xl border border-red-500/25 bg-red-500/5 p-4"><div><h4 className="text-sm font-semibold text-red-600">{zh ? '删除智能体' : 'Delete agent'}</h4><p className="mt-1 text-xs text-fg-muted">{zh ? '配置条目会被移除，删除前仍会再次确认。' : 'The configuration entry will be removed after confirmation.'}</p></div><Button variant="ghost" className="text-red-600" onClick={onDelete}><AlertTriangle className="size-4" />{zh ? '删除' : 'Delete'}</Button></div> : <p className="rounded-2xl bg-surface-base p-4 text-sm text-fg-muted">{zh ? '默认智能体不能删除，请先将其他智能体设为默认。' : 'The default agent cannot be deleted. Make another agent the default first.'}</p>}
            </div>
          ) : null}

          {profileVisited ? (
            <div className={cn('space-y-6', panel !== 'profile' && 'hidden')}>
              <SectionTitle title={zh ? '资料与个性' : 'Identity and personality'} description={zh ? '设置它是谁，以及如何与你交流。' : 'Define who this agent is and how it communicates.'} />
              <section className="rounded-2xl border border-edge bg-surface-base p-4 sm:p-5">
                <div className="grid items-center gap-4 sm:grid-cols-2">
                <div className="min-w-0">
                  <AgentAvatarField agentId={agent.id} avatar={draft.profile?.avatar} zh={zh} disabled={saving}
                    pending={pendingAvatar} onPendingChange={setPendingAvatar} onReadingChange={setAvatarReading}
                    onChange={avatar => updateIdentity('avatar', avatar)} />
                </div>
                  <label className="text-xs font-medium text-fg-muted">{zh ? '名称' : 'Name'}<input className={`${inputClass} mt-1.5`} value={profileName} onChange={(event) => updateIdentity('name', event.target.value)} placeholder={zh ? '例如：小助' : 'e.g. Nova'} /></label>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-medium text-fg-muted sm:col-span-2">{zh ? '介绍' : 'Description'}<textarea rows={2} className={`${inputClass} mt-1.5 resize-y leading-6`} value={draft.profile?.description ?? ''} onChange={(event) => updateIdentity('description', event.target.value)} placeholder={zh ? '例如：帮你整理想法、查找资料，把复杂任务拆成可以执行的步骤。' : 'e.g. Helps organize ideas, research topics, and turn complex tasks into actionable steps.'} /><span className="mt-1.5 block text-xs font-normal">{zh ? '简要说明定位；详细行为在下方「个性与边界」设置。' : 'Describe the agent’s purpose and how it helps. Set detailed behavior in Personality & boundaries below.'}</span></label>

                  <label className="text-xs font-medium text-fg-muted">{zh ? '表达风格' : 'Style'}<input className={`${inputClass} mt-1.5`} value={draft.profile?.style ?? ''} onChange={(event) => updateIdentity('style', event.target.value)} placeholder={zh ? '例如：直接、温和' : 'e.g. direct and warm'} /></label>
                  <label className="text-xs font-medium text-fg-muted">{zh ? '主要语言' : 'Primary language'}<input className={`${inputClass} mt-1.5`} value={draft.profile?.language ?? ''} onChange={(event) => updateIdentity('language', event.target.value)} placeholder={zh ? '例如：简体中文' : 'e.g. English'} /></label>
                </div>
                <div className="mt-4"><AdvancedSection title={zh ? '更多身份设置' : 'More identity settings'} summary={[draft.profile?.creature, draft.profile?.emoji].filter(Boolean).join(' · ')}>
                  <div className="grid gap-4 sm:grid-cols-2">
                  <label className="text-xs font-medium text-fg-muted">{zh ? '签名表情（可选）' : 'Signature emoji (optional)'}<input className={`${inputClass} mt-1.5`} value={draft.profile?.emoji ?? ''} onChange={(event) => updateIdentity('emoji', event.target.value)} placeholder="✨" /><span className="mt-1.5 block text-xs font-normal">{zh ? '用于表达个性，与头像分开设置。' : 'A personal touch, separate from the avatar.'}</span></label>
                  <label className="text-xs font-medium text-fg-muted">{zh ? '角色定位' : 'Role'}<input className={`${inputClass} mt-1.5`} list={`agent-creatures-${agent.id}`} value={draft.profile?.creature ?? ''} onChange={(event) => updateIdentity('creature', event.target.value)} placeholder={zh ? 'AI 助手、研究伙伴…' : 'AI assistant, research partner…'} /><datalist id={`agent-creatures-${agent.id}`}>{CREATURE_PRESETS.map((item) => <option key={item.value} value={item.value}>{zh ? item.labelZh : item.labelEn}</option>)}</datalist></label>
                  </div>
                </AdvancedSection></div>
              </section>
              <AgentProfileEditor
                ref={profileEditorRef}
                file="SOUL.md"
                agentId={agent.id}
                zh={zh}
                onDirtyChange={handleProfileFilesDirty}
              />
            </div>
          ) : null}

          {panel === 'capabilities' ? <div className="mb-5 space-y-3">
            <SectionTitle title={zh ? '能力' : 'Capabilities'} description={zh ? '声明擅长的任务，并配置实际可用的模型、技能与工具。' : 'Describe specialties and configure the models, skills, and tools available to this agent.'} />
            <PageTabs items={[
              { id: 'specialties' as const, label: zh ? '擅长的任务' : 'Specialties' },
              { id: 'models' as const, label: zh ? '模型' : 'Models' },
              { id: 'tools' as const, label: zh ? '技能与工具' : 'Skills & tools' },
            ]} activeTab={capabilityPanel} onChange={next => switchPanel('capabilities', next)} ariaLabel={zh ? '能力设置' : 'Capability settings'} tabIdPrefix="agent-capability-tab" panelIdPrefix="agent-capability-panel" />
          </div> : null}
          {panel === 'capabilities' && capabilityPanel === 'specialties' ? <div role="tabpanel" id="agent-capability-panel-specialties" aria-labelledby="agent-capability-tab-specialties">
              <SpecialistProfileEditor profile={draft.specialistProfile} zh={zh}
                onChange={(specialistProfile) => setDraft(current => ({ ...current, specialistProfile }))} />
          </div> : null}

          {panel === 'capabilities' && capabilityPanel === 'models' ? (
            <div role="tabpanel" id="agent-capability-panel-models" aria-labelledby="agent-capability-tab-models" className="space-y-6">
              <SectionTitle title={zh ? '模型路由' : 'Model routing'} description={zh ? '日常对话使用 Chat；固定意图只在对应任务中生效。默认继承全局。' : 'Chat handles normal turns; fixed intents apply only to matching work. Everything inherits by default.'} action={draft.models ? <Button variant="ghost" onClick={() => setDraft({ ...draft, models: undefined })}><RotateCcw className="size-4" />{zh ? '全部继承' : 'Inherit all'}</Button> : undefined} />
              <ModelRouteEditor label={messages.editorChatModel} inherited={agent.effective.models.chat} value={draft.models?.chat} zh={zh} onChange={(chat) => {
                const models = { ...(draft.models ?? {}) };
                if (chat) models.chat = chat;
                else delete models.chat;
                setDraft({ ...draft, models: Object.keys(models).length > 0 ? models : undefined });
              }} />
              <AdvancedSection title={zh ? "任务模型路由" : "Task model routing"} summary={zh ? "当前任务路由继续生效；未覆盖的任务继承全局设置。" : "Task routes remain active; unspecified routes inherit global defaults."}>
                <div>
                  <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{zh ? '固定意图' : 'Fixed intents'}</h4>
                  <div className="space-y-3">
                    {INTENTS.map((intent) => (
                      <ModelRouteEditor
                        key={intent}
                        label={intentLabels[intent]}
                        inherited={agent.effective.models.intents[intent] ?? agent.effective.models.chat}
                        value={draft.models?.intents?.[intent]}
                        zh={zh}
                        allowChatFallback
                        modelKind={intent === 'vision' ? 'vision' : 'text'}
                        onChange={(route) => setIntent(intent, route)}
                      />
                    ))}
                  </div>
                </div>
              </AdvancedSection>
              <div>
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-subtle">{zh ? '图片能力' : 'Image capabilities'}</h4>
                <div className="space-y-3">
                  <ModelRouteEditor
                    label={zh ? '图片理解' : 'Image understanding'}
                    modelKind="vision"
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
                    modelKind="image"
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
                    <AdvancedSection title={zh ? "图片执行策略" : "Image execution policy"} summary={zh ? "当前超时和回退策略继续生效。" : "Current timeout and fallback settings remain active."}>

                      <div className="grid gap-4 rounded-2xl border border-edge bg-surface-base p-4 sm:grid-cols-2">
                        <label className="text-xs font-medium text-fg-muted">{zh ? '生成超时（毫秒）' : 'Generation timeout (ms)'}<NumberInput allowEmpty type="number" min={1} className={`${inputClass} mt-1.5`} value={draft.models.imageGeneration.timeoutMs ?? ''} onChange={(event) => setDraft({ ...draft, models: { ...draft.models, imageGeneration: { ...draft.models!.imageGeneration!, timeoutMs: optionalPositiveInt(event.target.value) } } })} /></label>
                        <div className="text-xs font-medium text-fg-muted"><span>{zh ? '提供商自动回退' : 'Automatic provider fallback'}</span><div className="mt-1.5 flex rounded-xl bg-surface-hover p-1">{([true, false] as const).map((enabled) => <button key={String(enabled)} type="button" onClick={() => setDraft({ ...draft, models: { ...draft.models, imageGeneration: { ...draft.models!.imageGeneration!, autoProviderFallback: enabled } } })} className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-medium', draft.models?.imageGeneration?.autoProviderFallback === enabled ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted')}>{enabled ? (zh ? '开启' : 'On') : (zh ? '关闭' : 'Off')}</button>)}</div></div>
                      </div>

                    </AdvancedSection>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {panel === 'capabilities' && capabilityPanel === 'tools' ? (
            <div role="tabpanel" id="agent-capability-panel-tools" aria-labelledby="agent-capability-tab-tools" className="space-y-7">
              <SectionTitle title={zh ? '技能与工具' : 'Skills and tools'} description={zh ? '默认继承全局能力；只设置确实不同的部分。' : 'Keep inheritance for global capabilities; override only agents that genuinely differ.'} />
              <section className="rounded-2xl border border-edge bg-surface-base p-4">
                <div className="flex items-center justify-between gap-3">
                  <div><h4 className="text-sm font-semibold text-fg">{zh ? '技能策略' : 'Skill policy'}</h4><p className="mt-1 text-xs text-fg-muted">{draft.skills ? (zh ? '当前使用单独设置' : 'Using an agent override') : (zh ? '当前继承全局' : 'Currently inherited globally')}</p></div>
                  {draft.skills ? <Button variant="ghost" onClick={() => setDraft({ ...draft, skills: undefined })}><RotateCcw className="size-4" />{zh ? '继承' : 'Inherit'}</Button> : null}
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant={draft.skills?.mode === 'merge' ? 'primary' : 'secondary'} onClick={() => setDraft({ ...draft, skills: { mode: 'merge', add: [], remove: [] } })}>{messages.editorSkillModeMerge}</Button>
                  <Button variant={draft.skills?.mode === 'replace' ? 'primary' : 'secondary'} onClick={() => setDraft({ ...draft, skills: { mode: 'replace', include: [] } })}>{messages.editorSkillModeReplace}</Button>
                </div>
                {draft.skills?.mode === 'merge' ? <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium text-fg-muted">{zh ? '新增技能' : 'Add skills'}<input className={`${inputClass} mt-1.5`} value={draft.skills.add.join(', ')} onChange={(event) => setDraft({ ...draft, skills: { mode: 'merge', add: splitList(event.target.value), remove: draft.skills?.mode === 'merge' ? draft.skills.remove : [] } })} /></label><label className="text-xs font-medium text-fg-muted">{zh ? '移除技能' : 'Remove skills'}<input className={`${inputClass} mt-1.5`} value={draft.skills.remove.join(', ')} onChange={(event) => setDraft({ ...draft, skills: { mode: 'merge', add: draft.skills?.mode === 'merge' ? draft.skills.add : [], remove: splitList(event.target.value) } })} /></label></div> : null}
                {draft.skills?.mode === 'replace' ? <label className="mt-4 block text-xs font-medium text-fg-muted">{zh ? '仅启用这些技能' : 'Enable only these skills'}<input className={`${inputClass} mt-1.5`} value={draft.skills.include.join(', ')} onChange={(event) => setDraft({ ...draft, skills: { mode: 'replace', include: splitList(event.target.value) } })} /></label> : null}
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between"><h4 className="text-sm font-semibold text-fg">{zh ? '工具权限' : 'Tool permissions'}</h4>{draft.tools ? <Button variant="ghost" onClick={() => setDraft({ ...draft, tools: undefined })}><RotateCcw className="size-4" />{zh ? '全部继承' : 'Inherit all'}</Button> : null}</div>
                {toolAllowlist ? <p className="mb-3 text-xs text-fg-muted">{zh ? '此智能体使用限定的工具范围。可在下方启用或移除工具，保存后从下一轮对话生效。' : 'This agent uses a limited tool set. Add or remove tools below; changes apply from the next conversation turn.'}</p> : null}
                <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-base">
                  {allTools.map((id) => {
                    if (toolAllowlist && !toolAllowlist.includes(id)) {
                      return <div key={id} className="flex items-center justify-between gap-3 px-4 py-3"><div><code className="text-xs text-fg-muted">{id}</code><p className="mt-1 text-[11px] text-fg-muted">{zh ? '未开放' : 'Unavailable'}</p></div><Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setToolAvailable(id, true)}>{zh ? '启用' : 'Enable'}</Button></div>;
                    }
                    const local = draft.tools?.[id]?.mode;
                    const effective = agent.effective.tools[id]?.mode ?? 'allow';
                    return <div key={id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div><code className="text-xs text-fg">{id}</code><p className="mt-1 text-[11px] text-fg-muted">{local ? (zh ? '单独设置' : 'Agent override') : `${zh ? '继承' : 'Inherits'} ${toolModeLabels[effective]}`}</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex rounded-xl bg-surface-hover p-1">{(['inherit', 'allow', 'ask', 'deny'] as const).map((mode) => <button key={mode} type="button" onClick={() => setTool(id, mode)} className={cn('rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors', (mode === 'inherit' ? !local : local === mode) ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg')}>{toolModeLabels[mode]}</button>)}</div>{toolAllowlist ? <Button variant="ghost" className="px-2 py-1.5 text-xs" onClick={() => setToolAvailable(id, false)}>{zh ? '移除' : 'Remove'}</Button> : null}</div></div>;
                  })}
                </div>
              </section>
            </div>
          ) : null}

          {workVisited ? (
            <div className={cn('space-y-6', panel !== 'work' && 'hidden')}>
              <SectionTitle title={zh ? '工作设置' : 'Work settings'} description={zh ? '管理工作目录、执行规范与运行策略。' : 'Manage the working directory, instructions, and execution policy.'} />
              <PageTabs items={[
                { id: 'directory' as const, label: zh ? '工作目录' : 'Directory', suffix: dirtySuffix(differs(['workspace'])) },
                { id: 'instructions' as const, label: zh ? '工作规范' : 'Instructions', suffix: dirtySuffix(documentDirty.agents || draft.profile?.instructions !== agent.override.profile?.instructions) },
                { id: 'tools' as const, label: zh ? '工具约定' : 'Tool guidance', suffix: dirtySuffix(documentDirty.tools) },
                { id: 'runtime' as const, label: zh ? '运行策略' : 'Runtime', suffix: dirtySuffix(differs(['runtime', 'workflows'])) },
              ]} activeTab={workPanel} onChange={next => switchPanel('work', capabilityPanel, next)}
                ariaLabel={zh ? '工作设置分区' : 'Work settings sections'} tabIdPrefix="agent-work-tab" panelIdPrefix="agent-work-panel" />
              <div role="tabpanel" id="agent-work-panel-directory" aria-labelledby="agent-work-tab-directory" hidden={workPanel !== 'directory'} className="space-y-6">
                <section className="rounded-2xl border border-edge bg-surface-base p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div><h4 className="text-sm font-semibold text-fg">{zh ? '工作区' : 'Workspace'}</h4><p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? '选择这个智能体读写文件时使用的目录；留空则使用自动工作区。' : 'Choose where this agent reads and writes files, or leave it empty to use the automatic workspace.'}</p></div>
                    {!draft.workspace ? <InheritedBadge>{zh ? '自动' : 'Automatic'}</InheritedBadge> : <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setDraft((current) => ({ ...current, workspace: undefined }))}><RotateCcw className="size-3.5" />{zh ? '恢复自动' : 'Use automatic'}</Button>}
                  </div>
                  <div className="mt-4">
                    <DirectoryPickerPathField
                      value={draft.workspace ?? ''}
                      onChange={(workspace) => setDraft((current) => ({ ...current, workspace: workspace || undefined }))}
                      wd={workingDirectoryMessages}
                      placeholder={agent.effective.workspace}
                      inputAriaLabel={zh ? '智能体工作区路径' : 'Agent workspace path'}
                      inputClassName={`${inputClass} font-mono`}
                      disabled={saving}
                    />
                  </div>
                </section>
              </div>
              <div role="tabpanel" id="agent-work-panel-instructions" aria-labelledby="agent-work-tab-instructions" hidden={workPanel !== 'instructions'} className="space-y-6">
                <AgentProfileEditor ref={workEditorRef} file="AGENTS.md" agentId={agent.id} zh={zh} onDirtyChange={handleWorkFilesDirty} />
                <AdvancedSection title={zh ? '附加规则' : 'Additional rules'} summary={draft.profile?.instructions ? (zh ? '已设置' : 'Configured') : undefined}>
                  <h4 className="text-sm font-semibold text-fg">{zh ? '附加指令' : 'Additional instructions'}</h4>
                  <p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? '补充简短的执行规则；长期工作规范请写入上方「工作规范」。' : 'Add short execution rules. Keep lasting work guidance in Working instructions above.'}</p>
                  <textarea rows={4} className={`${inputClass} mt-4 resize-y leading-6`} value={draft.profile?.instructions ?? ''} onChange={(event) => setDraft((current) => ({ ...current, profile: { ...current.profile, name: current.profile?.name || agent.name || agent.id, instructions: event.target.value || undefined } }))} placeholder={zh ? '可选：补充必须始终遵循的规则' : 'Optional: add a rule that must always be followed'} />
                </AdvancedSection>
              </div>
              <div role="tabpanel" id="agent-work-panel-tools" aria-labelledby="agent-work-tab-tools" hidden={workPanel !== 'tools'} className="space-y-6">
                <AgentProfileEditor ref={toolEditorRef} file="TOOLS.md" agentId={agent.id} zh={zh} onDirtyChange={handleToolFilesDirty} />
              </div>
              <div role="tabpanel" id="agent-work-panel-runtime" aria-labelledby="agent-work-tab-runtime" hidden={workPanel !== 'runtime'} className="space-y-6">
                <SectionTitle title={zh ? '运行限制' : 'Runtime limits'} description={zh ? '留空即继承全局限制。' : 'Leave blank to inherit global limits. Use overrides only to tighten or relax a specialist agent.'} action={draft.runtime || draft.workflows ? <Button variant="ghost" onClick={() => setDraft({ ...draft, runtime: undefined, workflows: undefined })}><RotateCcw className="size-4" />{zh ? '全部继承' : 'Inherit all'}</Button> : undefined} />
                <AdvancedSection title={zh ? "执行限制" : "Execution limits"} summary={zh ? "保留当前运行限制；未覆盖的字段继承全局设置。" : "Current limits remain active; unspecified limits inherit globally."}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {([
                      ['maxTurns', zh ? '单次最大轮数' : 'Maximum turns'],
                      ['timeoutMs', zh ? '单轮超时（毫秒）' : 'Turn timeout (ms)'],
                      ['maxToolFailuresPerTurn', zh ? '最大工具失败次数' : 'Maximum tool failures'],
                    ] as const).map(([key, label]) => <label key={key} className="text-xs font-medium text-fg-muted"><span className="flex items-center gap-2">{label}{draft.runtime?.[key] === undefined ? <InheritedBadge>{zh ? '继承' : 'Inherited'}</InheritedBadge> : null}</span><NumberInput allowEmpty type="number" min={1} className={`${inputClass} mt-1.5`} value={draft.runtime?.[key] ?? ''} placeholder={String(agent.effective.runtime[key] ?? '')} onChange={(event) => { const runtime = cleanObject({ ...(draft.runtime ?? {}), [key]: optionalPositiveInt(event.target.value) }); setDraft({ ...draft, runtime }); }} /></label>)}
                  </div>
                </AdvancedSection>
                <section className="rounded-2xl border border-edge bg-surface-base p-4">
                  <h4 className="text-sm font-semibold text-fg">{zh ? '工作流' : 'Workflows'}</h4>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <AdvancedSection title={zh ? "默认工作流" : "Default workflow"} summary={draft.workflows?.default ?? agent.effective.workflows.default ?? (zh ? "未自动绑定工作流" : "No workflow bound automatically")} >
                      <label className="text-xs font-medium text-fg-muted">{zh ? '默认工作流' : 'Default workflow'}<input className={`${inputClass} mt-1.5`} value={draft.workflows?.default ?? ''} placeholder={agent.effective.workflows.default} onChange={(event) => { const workflows = cleanObject({ ...(draft.workflows ?? {}), default: event.target.value || undefined }); setDraft({ ...draft, workflows }); }} /></label>
                    </AdvancedSection>
                    <label className="text-xs font-medium text-fg-muted">{zh ? '允许的工作流' : 'Allowed workflows'}<input className={`${inputClass} mt-1.5`} value={draft.workflows?.allowed?.join(', ') ?? ''} placeholder={agent.effective.workflows.allowed?.join(', ')} onChange={(event) => { const allowed = splitList(event.target.value); const workflows = cleanObject({ ...(draft.workflows ?? {}), allowed: allowed.length > 0 ? allowed : undefined }); setDraft({ ...draft, workflows }); }} /></label>
                  </div>
                </section>
                <AdvancedSection title={zh ? "提示词缓存" : "Prompt cache"} summary={draft.runtime?.promptCache?.mode ?? (zh ? "继承全局" : "Inherited globally")}>
                  <section className="rounded-2xl border border-edge bg-surface-base p-4">
                    <div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-semibold text-fg">{zh ? '提示词缓存' : 'Prompt cache'}</h4><p className="mt-1 text-xs text-fg-muted">{draft.runtime?.promptCache ? (zh ? '使用单独设置' : 'Using agent override') : (zh ? '继承全局' : 'Inherited globally')}</p></div>{draft.runtime?.promptCache ? <Button variant="ghost" onClick={() => { const runtime = cleanObject({ ...(draft.runtime ?? {}), promptCache: undefined }); setDraft({ ...draft, runtime }); }}><RotateCcw className="size-4" />{zh ? '继承' : 'Inherit'}</Button> : null}</div>
                    {draft.runtime?.promptCache ? <div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="text-xs font-medium text-fg-muted"><span>{zh ? '模式' : 'Mode'}</span><div className="mt-1.5 flex rounded-xl bg-surface-hover p-1">{(['auto', 'off'] as const).map((mode) => <button key={mode} type="button" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { ...draft.runtime!.promptCache!, mode } } })} className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-medium', draft.runtime?.promptCache?.mode === mode ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted')}>{mode === 'auto' ? messages.editorCacheModeAuto : messages.editorCacheModeOff}</button>)}</div></div><div className="text-xs font-medium text-fg-muted"><span>{zh ? '缓存周期' : 'Lifetime'}</span><div className="mt-1.5 flex rounded-xl bg-surface-hover p-1">{(['short', 'long'] as const).map((lifetime) => <button key={lifetime} type="button" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { ...draft.runtime!.promptCache!, lifetime } } })} className={cn('flex-1 rounded-lg px-3 py-2 text-xs font-medium', draft.runtime?.promptCache?.lifetime === lifetime ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted')}>{lifetime === 'short' ? messages.editorCacheLifetimeShort : messages.editorCacheLifetimeLong}</button>)}</div></div></div> : <Button className="mt-4" onClick={() => setDraft({ ...draft, runtime: { ...draft.runtime, promptCache: { ...(agent.effective.runtime.promptCache ?? { mode: 'auto', lifetime: 'short' }) } } })}>{zh ? '自定义缓存策略' : 'Customize cache policy'}</Button>}
                  </section>
                </AdvancedSection>
              </div>
            </div>
          ) : null}

        </main>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-edge bg-surface-panel px-5 py-3">
          <p className="text-xs text-fg-muted" role="status">{saving ? (zh ? '保存中…' : 'Saving…') : invalidModelOverride ? (zh ? '请补全自定义模型' : 'Complete the custom model reference') : dirty ? (zh ? '有未保存的更改' : 'Unsaved changes') : savedOnce ? (zh ? '更改已保存' : 'Changes saved') : (zh ? '未修改' : 'No changes')}</p>
          <div className="flex gap-2"><Button onClick={onClose}>{zh ? '关闭' : 'Close'}</Button><Button variant="primary" disabled={saving || avatarReading || !dirty || invalidModelOverride || (draft.profile !== undefined && !draft.profile.name.trim())} onClick={() => void save()}>{saving ? (zh ? '保存中…' : 'Saving…') : (zh ? '保存更改' : 'Save changes')}</Button></div>
        </footer>
      </div>
    </div>
  );
}
