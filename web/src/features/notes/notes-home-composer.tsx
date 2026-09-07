import { ArrowUp, AudioLines, CalendarDays, FileText, Folder, Loader2, Mic, Paperclip, ScanSearch, Sparkles, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { PopoverSelect } from '@/components/ui/popover-select';
import { openDiscussionCapture } from '@/features/discussions/discussion-events';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';

import { noteCreationChatHref, prepareAgentNote, type NoteCreationDraft } from './note-creation';
import type { NoteProjectSummary } from './notes-api';

const templateIcons = { meeting: AudioLines, requirements: FileText, research: ScanSearch, weekly: CalendarDays };
type TemplateId = keyof typeof templateIcons;

export function NotesHomeComposer({ projects, projectId, onProjectChange, onCreated, labels, projectsLoading, projectsError }: {
  projects: NoteProjectSummary[];
  projectId: string;
  onProjectChange: (id: string) => void;
  onCreated: () => void;
  labels: MessageBundle['notes'];
  projectsLoading: boolean;
  projectsError: boolean;
}) {
  const h = labels.home;
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [template, setTemplate] = useState<TemplateId | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectSearch, setProjectSearch] = useState('');
  const pending = useRef<NoteCreationDraft | null>(null);
  const submitting = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const locked = busy || Boolean(pending.current);
  const selectedTemplate = template ? h.templateOptions[template] : null;
  const canSubmit = Boolean(text.trim() || files.length);

  async function submit() {
    if (submitting.current || (!canSubmit && !pending.current)) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    pending.current ??= {
      requestId: crypto.randomUUID(),
      title: text.trim().split('\n')[0]?.slice(0, 80) || selectedTemplate?.label || labels.titlePlaceholder,
      markdown: `## ${h.requestHeading}\n\n${selectedTemplate ? `${selectedTemplate.prompt}\n` : ''}${text.trim()}`,
      projectId: projectId || undefined,
      files: [...files], attachments: [], materialHeading: h.materialsHeading,
    };
    try {
      const result = await prepareAgentNote(pending.current);
      onCreated();
      navigate(noteCreationChatHref(result.sessionKey, result.noteId, h.agentPrompt));
    } catch (err) {
      if (pending.current.note) onCreated();
      setError(err instanceof Error ? err.message : labels.quickCaptureFailedHint);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function startAnother() {
    pending.current = null;
    setError(null); setText(''); setFiles([]); setTemplate(null);
    textInput.current?.focus();
  }

  return (
    <section aria-label={h.askLabel}>
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}
        className="relative rounded-xl border border-edge bg-surface-panel p-4 focus-within:border-accent/60 sm:p-5">
        <fieldset disabled={locked} className="min-w-0">
          <label htmlFor="notes-home-prompt" className="flex items-center gap-2 text-xs font-medium text-accent-fg">
            <Sparkles className="size-4" aria-hidden />{h.askLabel}
          </label>
          {selectedTemplate ? (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-xs leading-5 text-accent-fg">
              <p className="min-w-0 flex-1"><span className="font-medium">{selectedTemplate.label} · </span>{selectedTemplate.prompt.split('\n\n')[0]}</p>
              <button type="button" onClick={() => setTemplate(null)} aria-label={labels.searchClear} className="shrink-0 rounded p-1 hover:bg-surface-hover"><X className="size-3.5" /></button>
            </div>
          ) : null}
          <textarea ref={textInput} id="notes-home-prompt" value={text} onChange={(event) => setText(event.target.value)}
            placeholder={selectedTemplate ? selectedTemplate.prompt.split('\n\n').at(-1) : h.askPlaceholder}
            rows={2} onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault(); void submit();
              }
            }}
            className="mt-2 min-h-16 w-full resize-y bg-transparent py-2 text-base leading-6 text-fg outline-none placeholder:text-fg-muted sm:text-sm" />
          {files.length ? <ul className="mb-3 flex flex-wrap gap-2">{files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex max-w-full items-center gap-2 rounded-md border border-edge px-2 py-1 text-xs text-fg-muted">
              <Paperclip className="size-3 shrink-0" aria-hidden /><span className="truncate">{file.name}</span>
              <button type="button" aria-label={`${h.removeMaterial}: ${file.name}`} onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="rounded p-1 hover:bg-surface-hover"><X className="size-3" /></button>
            </li>
          ))}</ul> : null}
          <div className="flex flex-wrap items-center gap-2 sm:pr-40">
            <div className="w-44 max-w-full">
              <PopoverSelect value={projectId} options={projects.filter((p) => p.name.toLowerCase().includes(projectSearch.toLowerCase())).map((p) => ({ value: p.id, label: p.name }))}
                selectedLabel={projectId ? projects.find((p) => p.id === projectId)?.name : h.unassigned}
                placeholder={h.unassigned} emptyLabel={h.unassigned} ariaLabel={h.assignProject}
                triggerIcon={<Folder className="size-4 shrink-0" aria-hidden />} triggerClassName="h-8 border-transparent bg-transparent px-2 text-xs text-fg-muted hover:bg-surface-hover"
                onChange={onProjectChange} disabled={locked} loading={projectsLoading} statusMessage={projectsError ? h.projectsLoadFailed : undefined}
                searchPlaceholder={h.projectSearch} searchValue={projectSearch} onSearchChange={setProjectSearch} />
            </div>
            <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-fg-muted hover:bg-surface-hover">
              <Paperclip className="size-4" aria-hidden />{h.addMaterials}
            </button>
            <input ref={fileInput} type="file" multiple className="hidden" aria-label={h.addMaterials} onChange={(event) => {
              const selectedFiles = Array.from(event.target.files ?? []);
              setFiles((current) => [...current, ...selectedFiles]); event.target.value = '';
            }} />
          </div>
        </fieldset>
        <div className="mt-2 flex justify-end sm:absolute sm:bottom-5 sm:right-5 sm:mt-0">
          <button type="submit" disabled={busy || (!pending.current && !canSubmit)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
            {busy ? h.creating : error ? h.retry : h.agentCreate}
          </button>
        </div>
      </form>
      {error ? <div className="mt-3 rounded-lg border border-danger/25 bg-danger-soft px-3 py-3 text-xs text-danger" role="alert">
        <p>{error}</p>
        {pending.current?.note ? <p className="mt-1">{h.partialFailure}</p> : null}
        <div className="mt-2 flex flex-wrap gap-3">
          {pending.current?.note ? <button type="button" onClick={() => navigate(`/notes/${encodeURIComponent(pending.current!.note!.id)}?edit=1`)} className="underline">{h.openSavedDraft}</button> : null}
          <button type="button" onClick={startAnother} className="underline">{h.newRequest}</button>
        </div>
      </div> : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-fg-muted">
        <span className="mr-1 py-2">{h.templates}</span>
        {(Object.keys(templateIcons) as TemplateId[]).map((id) => {
          const Icon = templateIcons[id];
          return <button key={id} type="button" disabled={locked} aria-pressed={template === id}
            onClick={() => { setTemplate(template === id ? null : id); textInput.current?.focus(); }}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-2 hover:bg-surface-hover disabled:opacity-50', template === id && 'bg-accent-soft text-accent-fg')}>
            <Icon className="size-3.5" aria-hidden />{h.templateOptions[id].label}
          </button>;
        })}
        <button type="button" disabled={busy} onClick={() => openDiscussionCapture()} className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-2 hover:bg-surface-hover">
          <Mic className="size-3.5" aria-hidden />{h.recordDiscussion}
        </button>
      </div>
    </section>
  );
}
