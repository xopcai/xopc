import {
  Bot,
  BriefcaseBusiness,
  Code2,
  Eye,
  Heart,
  Pencil,
} from 'lucide-react';
import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
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
  SOUL_TEMPLATES,
  replaceProfileMarkdownBody,
  splitProfileMarkdownFrontMatter,
} from './agent-profile-markdown';

const loadBlockEditor = () => import('@/components/block-editor');
const loadMarkdownEditor = () => import('@/components/markdown/markdown-editor');
const BlockEditor = lazy(() => loadBlockEditor().then((module) => ({ default: module.BlockEditor })));
const MarkdownEditor = lazy(() => loadMarkdownEditor().then((module) => ({ default: module.MarkdownEditor })));

type ProfileFileName = 'SOUL.md' | 'TOOLS.md' | 'AGENTS.md';
type EditorMode = 'direct' | 'source' | 'preview';
export type AgentProfileEditorHandle = {
  save: () => Promise<void>;
};

type Props = {
  agentId: string;
  file: ProfileFileName;
  zh: boolean;
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
  file: activeFile,
  zh,
  onDirtyChange,
}, ref) {
  const isDark = useThemeStore((state) => state.resolved === 'dark');
  const [draft, setDraft] = useState('');
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateUndo, setTemplateUndo] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>('direct');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    setDraft('');
    setBaseline('');
    setSavedOnce(false);
    setTemplateUndo(null);
    void (async () => {
      try {
        const listing = await fetchAgentProfileFiles(agentId);
        const existing = new Set(listing.files.filter((file) => !file.missing).map((file) => file.name));
        const content = existing.has(activeFile) ? await fetchAgentProfileFileContent(agentId, activeFile) : '';
        if (cancelled) return;
        setDraft(content);
        setBaseline(content);
      } catch (cause) {
        if (cancelled) return;
        setLoadFailed(true);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId, activeFile]);

  const dirty = draft !== baseline;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const save = useCallback(async () => {
    if (!dirty) return;
    setSaving(true);
    setError(null);
    try {
      await saveAgentProfileFileContent(agentId, activeFile, draft);
      setBaseline(draft);
      setSavedOnce(true);
      setTemplateUndo(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      throw cause;
    } finally {
      setSaving(false);
    }
  }, [agentId, activeFile, dirty, draft]);
  useImperativeHandle(ref, () => ({ save }), [save]);

  const fileInfo: Record<ProfileFileName, { label: string; description: string }> = {
    'SOUL.md': {
      label: zh ? '个性与边界' : 'Personality & boundaries',
      description: zh ? '定义语气、价值观、行为原则与安全边界。' : 'Tone, values, behavior principles, and safety boundaries.',
    },
    'TOOLS.md': {
      label: zh ? '工具使用约定' : 'Tool guidance',
      description: zh ? '补充工具偏好和使用约定，不负责授予权限。' : 'Tool preferences and conventions; this does not grant access.',
    },
    'AGENTS.md': {
      label: zh ? '工作规范' : 'Working instructions',
      description: zh ? '该智能体长期遵循的协作和执行规范。' : 'Persistent collaboration and execution instructions.',
    },
  };

  const templateIcons = [BriefcaseBusiness, Heart, Code2, Pencil];
  const visualContent = splitProfileMarkdownFrontMatter(draft).body;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-2xl border border-edge bg-surface-base">
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h4 className="text-sm font-semibold text-fg">{fileInfo[activeFile].label}</h4><p className="mt-1 text-xs leading-5 text-fg-muted">{fileInfo[activeFile].description}</p></div>
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
              <button type="button" disabled={loadFailed} aria-expanded={templateOpen} onClick={() => setTemplateOpen(!templateOpen)} className="text-xs font-medium text-accent hover:underline">{zh ? '使用模板' : 'Use a template'}</button>
              {templateUndo !== null ? <button type="button" className="ml-3 text-xs text-accent hover:underline" onClick={() => { setDraft(templateUndo); setTemplateUndo(null); }}>{zh ? '撤销模板替换' : 'Undo template replacement'}</button> : null}
              {templateOpen ? <>
              <p className="my-2 text-xs text-fg-muted">{zh ? '模板会替换当前个性正文，保存前可以撤销。' : 'A template replaces the personality text. You can undo before saving.'}</p>
              <div className="grid gap-2 sm:grid-cols-4">
                {SOUL_TEMPLATES.map((template, index) => {
                  const Icon = templateIcons[index] ?? Bot;
                  return <button key={template.id} type="button" onClick={() => { if (template.content) { setTemplateUndo(draft); setDraft(current => replaceProfileMarkdownBody(current, template.content)); } setMode('direct'); }} className="flex min-h-11 items-center gap-2 rounded-xl border border-edge px-3 py-2 text-left text-xs font-medium text-fg-muted transition-colors hover:border-accent/40 hover:bg-surface-hover hover:text-fg"><Icon className="size-4 shrink-0 text-accent" aria-hidden />{zh ? template.labelZh : template.labelEn}</button>;
                })}
              </div>
              </> : null}
            </div>
          ) : null}

          {error ? <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600" role="alert">{error}</p> : null}
          <div className="mt-4 h-[min(40vh,22rem)] min-h-64 overflow-hidden rounded-xl border border-edge bg-surface-panel">
            {loading ? <EditorFallback /> : loadFailed ? <div className="flex h-full items-center justify-center p-6 text-center text-sm text-fg-muted">{zh ? '无法加载角色配置，未对文件进行任何更改。' : 'Profile documents could not be loaded. No files were changed.'}</div> : mode === 'direct' ? (
              <Suspense fallback={<EditorFallback />}><BlockEditor key={`${agentId}-${activeFile}-direct`} initialContent={visualContent} onChange={(content) => setDraft(current => replaceProfileMarkdownBody(current, content))} placeholder={zh ? '直接输入内容，或输入 / 使用快捷命令…' : 'Start writing, or type / for commands…'} /></Suspense>
            ) : mode === 'source' ? (
              <Suspense fallback={<EditorFallback />}><MarkdownEditor key={`${agentId}-${activeFile}-source`} initialContent={draft} onChange={(content) => setDraft(content)} isDark={isDark} lineWrap className="min-h-0 flex-1" /></Suspense>
            ) : (
              <div className="h-full overflow-y-auto p-5">{visualContent.trim() ? <MarkdownView content={visualContent} /> : <p className="text-sm italic text-fg-muted">{zh ? '暂无内容。' : 'No content yet.'}</p>}</div>
            )}
          </div>
          <div className="mt-2 flex justify-end text-xs text-fg-muted" aria-live="polite">{saving ? (zh ? '正在保存角色配置…' : 'Saving profile documents…') : dirty ? (zh ? '角色配置有未保存的更改' : 'Profile documents have unsaved changes') : savedOnce ? (zh ? '文档更改已保存' : 'Document changes saved') : (zh ? '未修改' : 'No changes')}</div>
        </div>
      </section>
    </div>
  );
});
