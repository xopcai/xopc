import {
  Bot,
  BriefcaseBusiness,
  Code2,
  Eye,
  FileCog,
  Heart,
  Pencil,
  Sparkles,
} from 'lucide-react';
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Skeleton } from '@/components/ui/skeleton';
import {
  fetchAgentProfileFileContent,
  fetchAgentProfileFiles,
  saveAgentProfileFileContent,
} from '@/features/settings/agents-admin-api';
import { cn } from '@/lib/cn';
import { useThemeStore } from '@/stores/theme-store';

import {
  CREATURE_PRESETS,
  type IdentityFields,
  SOUL_TEMPLATES,
  parseIdentityMarkdown,
  replaceProfileMarkdownBody,
  splitProfileMarkdownFrontMatter,
  updateIdentityMarkdown,
} from './agent-profile-markdown';

const loadBlockEditor = () => import('@/components/block-editor');
const loadMarkdownEditor = () => import('@/components/markdown/markdown-editor');
const BlockEditor = lazy(() => loadBlockEditor().then((module) => ({ default: module.BlockEditor })));
const MarkdownEditor = lazy(() => loadMarkdownEditor().then((module) => ({ default: module.MarkdownEditor })));

const PROFILE_FILES = ['SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'AGENTS.md', 'HEARTBEAT.md'] as const;
type ProfileFileName = typeof PROFILE_FILES[number];
type EditorMode = 'direct' | 'source' | 'preview';
type ProfileDrafts = Record<ProfileFileName, string>;

const EMPTY_DRAFTS: ProfileDrafts = {
  'SOUL.md': '',
  'IDENTITY.md': '',
  'TOOLS.md': '',
  'AGENTS.md': '',
  'HEARTBEAT.md': '',
};

export type AgentProfileEditorHandle = {
  save: () => Promise<void>;
};

type Props = {
  agentId: string;
  zh: boolean;
  inputClass: string;
  name: string;
  onNameChange: (name: string) => void;
  onDirtyChange: (dirty: boolean) => void;
};

function EditorFallback() {
  return (
    <div className="space-y-3 p-5" aria-busy="true">
      <Skeleton className="h-8 w-52" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-11/12" />
    </div>
  );
}

export const AgentProfileEditor = forwardRef<AgentProfileEditorHandle, Props>(function AgentProfileEditor({
  agentId,
  zh,
  inputClass,
  name,
  onNameChange,
  onDirtyChange,
}, ref) {
  const isDark = useThemeStore((state) => state.resolved === 'dark');
  const [drafts, setDrafts] = useState<ProfileDrafts>(EMPTY_DRAFTS);
  const [baseline, setBaseline] = useState<ProfileDrafts>(EMPTY_DRAFTS);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<ProfileFileName>('SOUL.md');
  const [mode, setMode] = useState<EditorMode>('direct');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    setDrafts({ ...EMPTY_DRAFTS });
    setBaseline({ ...EMPTY_DRAFTS });
    void (async () => {
      try {
        const listing = await fetchAgentProfileFiles(agentId);
        const existing = new Set(listing.files.filter((file) => !file.missing).map((file) => file.name));
        const entries = await Promise.all(PROFILE_FILES.map(async (file) => (
          [file, existing.has(file) ? await fetchAgentProfileFileContent(agentId, file) : ''] as const
        )));
        if (cancelled) return;
        const next = { ...EMPTY_DRAFTS };
        for (const [file, content] of entries) next[file] = content;
        setDrafts(next);
        setBaseline(next);
      } catch (cause) {
        if (cancelled) return;
        setLoadFailed(true);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  const dirty = useMemo(
    () => PROFILE_FILES.some((file) => drafts[file] !== baseline[file]),
    [baseline, drafts],
  );
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = useCallback(async () => {
    const changed = PROFILE_FILES.filter((file) => drafts[file] !== baseline[file]);
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all(changed.map((file) => saveAgentProfileFileContent(agentId, file, drafts[file])));
      setBaseline({ ...drafts });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setSaving(false);
    }
  }, [agentId, baseline, drafts]);
  useImperativeHandle(ref, () => ({ save }), [save]);

  const identity = useMemo(() => parseIdentityMarkdown(drafts['IDENTITY.md']), [drafts]);
  const effectiveIdentity = useMemo(
    () => ({ ...identity, name: identity.name || name }),
    [identity, name],
  );
  const updateIdentity = (patch: Partial<IdentityFields>) => {
    const next = { ...effectiveIdentity, ...patch };
    setDrafts((current) => ({
      ...current,
      'IDENTITY.md': updateIdentityMarkdown(current['IDENTITY.md'], next),
    }));
    if (patch.name !== undefined) onNameChange(patch.name);
  };

  const fileInfo: Record<ProfileFileName, { label: string; description: string }> = {
    'SOUL.md': {
      label: zh ? '个性与边界' : 'Personality & boundaries',
      description: zh ? '定义语气、价值观、行为原则与安全边界。' : 'Tone, values, behavior principles, and safety boundaries.',
    },
    'IDENTITY.md': {
      label: zh ? '身份资料' : 'Identity',
      description: zh ? '智能体如何介绍自己；上方表单与此文件保持同步。' : 'How the agent presents itself; synchronized with the form above.',
    },
    'TOOLS.md': {
      label: zh ? '工具说明' : 'Tool guidance',
      description: zh ? '补充工具偏好和使用约定，不负责授予权限。' : 'Tool preferences and conventions; this does not grant access.',
    },
    'AGENTS.md': {
      label: zh ? '工作规范' : 'Working instructions',
      description: zh ? '该智能体长期遵循的协作和执行规范。' : 'Persistent collaboration and execution instructions.',
    },
    'HEARTBEAT.md': {
      label: zh ? '主动检查' : 'Heartbeat',
      description: zh ? '定期唤醒时需要检查和处理的事项。' : 'What to inspect and handle during scheduled wake-ups.',
    },
  };

  const templateIcons = [BriefcaseBusiness, Heart, Code2, Pencil];
  const visualContent = splitProfileMarkdownFrontMatter(drafts[activeFile]).body;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-edge bg-surface-base p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Sparkles className="size-4" aria-hidden /></span>
          <div><h4 className="text-sm font-semibold text-fg">{zh ? '智能体身份' : 'Agent identity'}</h4><p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? '这些内容会写入 IDENTITY.md，并用于智能体自我介绍。' : 'These fields are written to IDENTITY.md and shape how the agent introduces itself.'}</p></div>
        </div>
        {loading ? <div className="mt-5 grid gap-4 sm:grid-cols-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : loadFailed ? <p className="mt-5 text-sm text-fg-muted">{zh ? '身份资料暂时无法加载，请关闭后重试。' : 'Identity details could not be loaded. Close the editor and try again.'}</p> : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-fg-muted">{zh ? '名称' : 'Name'}<input className={`${inputClass} mt-1.5`} value={effectiveIdentity.name} onChange={(event) => updateIdentity({ name: event.target.value })} placeholder={zh ? '例如：小助' : 'e.g. Nova'} /></label>
            <label className="text-xs font-medium text-fg-muted">{zh ? '一句话介绍' : 'Description'}<input className={`${inputClass} mt-1.5`} value={effectiveIdentity.description} onChange={(event) => updateIdentity({ description: event.target.value })} placeholder={zh ? '擅长什么、如何帮助你' : 'What this agent is great at'} /></label>
            <label className="text-xs font-medium text-fg-muted">{zh ? '类型' : 'Type'}<input className={`${inputClass} mt-1.5`} list={`agent-creatures-${agentId}`} value={effectiveIdentity.creature} onChange={(event) => updateIdentity({ creature: event.target.value })} placeholder={zh ? 'AI 助手、研究伙伴…' : 'AI assistant, research partner…'} /><datalist id={`agent-creatures-${agentId}`}>{CREATURE_PRESETS.map((item) => <option key={item.value} value={item.value}>{zh ? item.labelZh : item.labelEn}</option>)}</datalist></label>
            <label className="text-xs font-medium text-fg-muted">{zh ? '主要语言' : 'Primary language'}<input className={`${inputClass} mt-1.5`} value={effectiveIdentity.language} onChange={(event) => updateIdentity({ language: event.target.value })} placeholder={zh ? '例如：简体中文' : 'e.g. English'} /></label>
            <label className="text-xs font-medium text-fg-muted">{zh ? '签名表情' : 'Signature emoji'}<input className={`${inputClass} mt-1.5`} value={effectiveIdentity.emoji} onChange={(event) => updateIdentity({ emoji: event.target.value })} placeholder="✨" /></label>
            <label className="text-xs font-medium text-fg-muted">{zh ? '头像地址' : 'Avatar URL or path'}<input className={`${inputClass} mt-1.5`} value={effectiveIdentity.avatar} onChange={(event) => updateIdentity({ avatar: event.target.value })} placeholder={zh ? 'URL 或本地路径' : 'URL or local path'} /></label>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-edge bg-surface-base">
        <div className="border-b border-edge px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-fg-muted"><FileCog className="size-4" aria-hidden /></span>
            <div className="min-w-0"><h4 className="text-sm font-semibold text-fg">{zh ? '角色配置' : 'Profile documents'}</h4><p className="mt-1 text-xs leading-5 text-fg-muted">{zh ? '五类角色文件均可编辑。默认使用所见即所得编辑器，熟悉 Markdown 时再切换源码。' : 'All five profile documents are editable. The visual editor is the default; switch to Markdown source only when needed.'}</p></div>
          </div>
          <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label={zh ? '角色配置文件' : 'Profile documents'}>
            {PROFILE_FILES.map((file) => (
              <button key={file} type="button" role="tab" aria-selected={activeFile === file} onClick={() => { setActiveFile(file); setMode('direct'); }} className={cn('min-h-10 shrink-0 rounded-lg px-3 py-2 font-mono text-xs font-medium transition-colors', activeFile === file ? 'bg-accent-soft text-accent-fg' : 'text-fg-muted hover:bg-surface-hover hover:text-fg')}>{file}</button>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-sm font-medium text-fg">{fileInfo[activeFile].label}</p><p className="mt-1 text-xs leading-5 text-fg-muted">{fileInfo[activeFile].description}</p></div>
            <div className="flex rounded-lg bg-surface-hover p-1" role="group" aria-label={zh ? '编辑模式' : 'Editor mode'}>
              {([
                ['direct', Pencil, zh ? '直接编辑' : 'Visual'],
                ['source', Code2, 'Markdown'],
                ['preview', Eye, zh ? '预览' : 'Preview'],
              ] as const).map(([value, Icon, label]) => <button key={value} type="button" onClick={() => setMode(value)} aria-pressed={mode === value} className={cn('inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors', mode === value ? 'bg-surface-panel text-fg shadow-surface' : 'text-fg-muted hover:text-fg')}><Icon className="size-3.5" aria-hidden />{label}</button>)}
            </div>
          </div>

          {activeFile === 'SOUL.md' && !loading ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium text-fg-muted">{zh ? '从模板开始' : 'Start from a template'}</p>
              <div className="grid gap-2 sm:grid-cols-4">
                {SOUL_TEMPLATES.map((template, index) => {
                  const Icon = templateIcons[index] ?? Bot;
                  return <button key={template.id} type="button" onClick={() => { if (template.content) setDrafts((current) => ({ ...current, 'SOUL.md': replaceProfileMarkdownBody(current['SOUL.md'], template.content) })); setMode('direct'); }} className="flex min-h-11 items-center gap-2 rounded-xl border border-edge px-3 py-2 text-left text-xs font-medium text-fg-muted transition-colors hover:border-accent/40 hover:bg-surface-hover hover:text-fg"><Icon className="size-4 shrink-0 text-accent" aria-hidden />{zh ? template.labelZh : template.labelEn}</button>;
                })}
              </div>
            </div>
          ) : null}

          {error ? <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600" role="alert">{error}</p> : null}
          <div className="mt-4 h-[min(40vh,22rem)] min-h-64 overflow-hidden rounded-xl border border-edge bg-surface-panel" role="tabpanel">
            {loading ? <EditorFallback /> : loadFailed ? <div className="flex h-full items-center justify-center p-6 text-center text-sm text-fg-muted">{zh ? '无法加载角色配置，未对文件进行任何更改。' : 'Profile documents could not be loaded. No files were changed.'}</div> : mode === 'direct' ? (
              <Suspense fallback={<EditorFallback />}><BlockEditor key={`${agentId}-${activeFile}-direct`} initialContent={visualContent} onChange={(content) => setDrafts((current) => ({ ...current, [activeFile]: replaceProfileMarkdownBody(current[activeFile], content) }))} placeholder={zh ? '直接输入内容，或输入 / 使用快捷命令…' : 'Start writing, or type / for commands…'} /></Suspense>
            ) : mode === 'source' ? (
              <Suspense fallback={<EditorFallback />}><MarkdownEditor key={`${agentId}-${activeFile}-source`} initialContent={drafts[activeFile]} onChange={(content) => setDrafts((current) => ({ ...current, [activeFile]: content }))} isDark={isDark} lineWrap className="min-h-0 flex-1" /></Suspense>
            ) : (
              <div className="h-full overflow-y-auto p-5">{visualContent.trim() ? <MarkdownView content={visualContent} /> : <p className="text-sm italic text-fg-muted">{zh ? '暂无内容。' : 'No content yet.'}</p>}</div>
            )}
          </div>
          <div className="mt-2 flex justify-end text-xs text-fg-muted" aria-live="polite">{saving ? (zh ? '正在保存角色配置…' : 'Saving profile documents…') : dirty ? (zh ? '角色配置有未保存的更改' : 'Profile documents have unsaved changes') : (zh ? '角色配置已保存' : 'Profile documents saved')}</div>
        </div>
      </section>
    </div>
  );
});
