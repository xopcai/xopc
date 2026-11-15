import { Copy, MessageSquarePlus } from 'lucide-react';
import { SPACE_WORKBOOK_SELECTION_MAX_BYTES, SPACE_WORKBOOK_SELECTION_MIME } from '@xopcai/gateway-contract';
import { useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useNavigate } from 'react-router-dom';
import { CommandType, createUniver, LifecycleStages, LocaleType, type IWorkbookData } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import enUS from '@univerjs/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';

import { Skeleton } from '@/components/ui/skeleton';
import { createComposerAttachmentHandoff } from '@/features/chat/composer/composer-attachment-handoff';
import { useThemeStore } from '@/stores/theme-store';

import { createSpaceWorkbook, saveSpaceWorkbook, spaceContent } from './space-api';
import { WorkbookChatPicker, type WorkbookChatTarget } from './workbook-chat-picker';

type Workbook = ReturnType<ReturnType<typeof createUniver>['univerAPI']['createWorkbook']>;
type Editor = { univerAPI: ReturnType<typeof createUniver>['univerAPI']; workbook: Workbook };

const drafts = new Map<string, IWorkbookData>();

function rememberDraft(versionId: string, snapshot: IWorkbookData) {
  drafts.delete(versionId);
  drafts.set(versionId, structuredClone(snapshot));
}

async function finishCellEdit({ univerAPI, workbook }: Editor) {
  if (workbook.isCellEditing() && !await workbook.endEditingAsync(true)) throw new Error('Cell edit could not be committed');
  const formula = univerAPI.getFormula();
  formula.executeCalculation();
  await formula.onCalculationResultApplied(5_000);
}

export default function SpaceWorkbook({ id, versionId, title, zh, editable, inTrash, sourceConversationId, projectId, onSaved, onCopy }: {
  id: string;
  versionId: string;
  title: string;
  zh: boolean;
  editable: boolean;
  inTrash: boolean;
  sourceConversationId?: string;
  projectId?: string;
  onSaved: (versionId: string) => void;
  onCopy: (id: string) => void;
}) {
  const navigate = useNavigate();
  const dark = useThemeStore(state => state.resolved === 'dark');
  const host = useRef<HTMLDivElement>(null);
  const selectionButton = useRef<HTMLButtonElement>(null);
  const runtime = useRef<Editor | null>(null);
  const latest = useRef({ dark, editable, zh });
  const pending = useRef(false);
  const baseVersion = useRef(versionId);
  const dirtyRef = useRef(false);
  const copyRequest = useRef<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<{ file: File; label: string }>();

  useBeforeUnload(event => {
    if (!dirtyRef.current && !runtime.current?.workbook.isCellEditing()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  useEffect(() => {
    latest.current = { dark, editable, zh };
    runtime.current?.univerAPI.toggleDarkMode(dark);
    runtime.current?.workbook.setEditable(editable);
  }, [dark, editable, zh]);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const request = new AbortController();
    let dispose: (() => void) | undefined;
    void (async () => {
      try {
        const blob = await spaceContent(id, versionId, request.signal);
        const stored = JSON.parse(await blob.text()) as IWorkbookData;
        if (request.signal.aborted) return;
        const { dark, editable, zh } = latest.current;
        const draft = editable ? drafts.get(versionId) : undefined;
        const { univer, univerAPI } = createUniver({
          locale: zh ? LocaleType.ZH_CN : LocaleType.EN_US,
          locales: { [LocaleType.EN_US]: enUS, [LocaleType.ZH_CN]: zhCN },
          // Univer's default focus handling starts cell edits when typing on the grid.
          presets: [UniverSheetsCorePreset({
            container, toolbar: false,
            footer: { statisticBar: false, menus: false, zoomSlider: false,
              addSheetButtonConfig: { defaultRowCount: 100, defaultColumnCount: 26 } },
          })],
        });
        dispose = () => univer.dispose();
        const workbook = univerAPI.createWorkbook(structuredClone(draft ?? stored));
        univerAPI.toggleDarkMode(dark);
        workbook.setEditable(editable);
        baseVersion.current = versionId;
        runtime.current = { univerAPI, workbook };
        dirtyRef.current = Boolean(draft);
        setDirty(dirtyRef.current);
        const listener = workbook.onCommandExecuted(command => {
          if (!latest.current.editable || command.type !== CommandType.MUTATION || command.id.includes('formula')) return;
          dirtyRef.current = true;
          setDirty(true);
        });
        const ready = () => { if (!request.signal.aborted) setState('ready'); };
        const lifecycle = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
          if (stage === LifecycleStages.Steady) ready();
        });
        dispose = () => {
          lifecycle.dispose();
          listener.dispose();
          if (dirtyRef.current) rememberDraft(baseVersion.current, workbook.save());
          univer.dispose();
        };
        if (univerAPI.getCurrentLifecycleStage() === LifecycleStages.Steady) ready();
      } catch {
        if (request.signal.aborted) return;
        dispose?.();
        dispose = undefined;
        runtime.current = null;
        setState('failed');
      }
    })();
    return () => {
      request.abort();
      runtime.current = null;
      dispose?.();
    };
  }, [attempt, id, versionId]);

  async function run(action: 'save' | 'copy' | 'ask') {
    const editor = runtime.current;
    if (!editor || pending.current) return;
    const hadEdits = dirtyRef.current || editor.workbook.isCellEditing();
    if (action === 'save' && !hadEdits) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await finishCellEdit(editor);
      if (runtime.current !== editor) return;
      if (action === 'ask' && !hadEdits) {
        dirtyRef.current = false;
        setDirty(false);
      }
      if (action !== 'ask') {
        const snapshot = editor.workbook.save();
        const previousVersion = baseVersion.current;
        const saved = action === 'save'
          ? await saveSpaceWorkbook(id, previousVersion, snapshot)
          : await createSpaceWorkbook(copyRequest.current ??= crypto.randomUUID(), `${title.slice(0, 220)}${zh ? '（副本）' : ' (copy)'}`, snapshot, { id, versionId: previousVersion });
        if (runtime.current !== editor) return;
        dirtyRef.current = false;
        drafts.delete(previousVersion);
        setDirty(false);
        setConflict(false);
        if (action === 'save') {
          baseVersion.current = saved.versionId;
          onSaved(saved.versionId);
        } else onCopy(saved.id);
        return;
      }

      const sheet = editor.workbook.getActiveSheet();
      const range = sheet?.getSelection()?.getActiveRange();
      if (!range) {
        setError(zh ? '请先选择单元格。' : 'Select cells first.');
        return;
      }
      const rows = range.getLastRow() - range.getRow() + 1;
      const columns = range.getLastColumn() - range.getColumn() + 1;
      const location = range.getA1Notation();
      const sheetName = sheet.getSheetName();
      const file = rows * columns <= 200 ? new File([JSON.stringify({
        workbook: title, sheet: sheetName, range: location, values: range.getValues(), formulas: range.getFormulas(),
      })], `Selection ${`${sheetName} ${location}`.replace(/[^\p{L}\p{N} _-]/gu, '_')}.txt`, { type: SPACE_WORKBOOK_SELECTION_MIME }) : undefined;
      if (!file || file.size > SPACE_WORKBOOK_SELECTION_MAX_BYTES) {
        setError(zh ? '选区过大，请缩小选区后重试。' : 'Select a smaller range and try again.');
        return;
      }
      setSelection({ file, label: `${title} · ${sheetName}!${location}` });
    } catch (cause) {
      if (runtime.current !== editor) return;
      const status = (cause as { status?: number })?.status;
      setConflict(status === 409 && action === 'save');
      setError(status === 409
        ? (zh ? '已有更新的版本，可将你的修改保存为副本。' : 'A newer version exists. Save your edits as a copy.')
        : (zh ? '操作未完成，请重试。' : 'Could not complete the action. Try again.'));
    } finally {
      pending.current = false;
      if (runtime.current === editor) setBusy(false);
    }
  }

  function sendToChat(target: WorkbookChatTarget) {
    if (!selection) return;
    const search = new URLSearchParams({ attachmentHandoff: createComposerAttachmentHandoff(selection.file) });
    if (target.agentId) {
      if (projectId) search.set('projectId', projectId);
      else search.set('projectScope', 'none');
    }
    navigate({ pathname: target.pathname, search: `?${search}` }, target.agentId
      ? { state: { forceNewChat: true, agentId: target.agentId } } : undefined);
  }

  function onEditorKeyDown(event: React.KeyboardEvent) {
    if (!editable || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    event.stopPropagation();
    if (dirtyRef.current || runtime.current?.workbook.isCellEditing()) void run('save');
  }

  return <div data-space-workbook className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" onKeyDownCapture={onEditorKeyDown}>
    {state === 'ready' ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-subtle px-3 py-2.5 text-xs">
      <span className="me-auto text-fg-muted" role="status">{!editable ? (zh ? '只读版本' : 'Read-only version') : busy
        ? (zh ? '正在处理…' : 'Working…') : dirty ? (zh ? '未保存的修改' : 'Unsaved changes') : (zh ? '已保存' : 'Saved')}</span>
      {!inTrash ? <button ref={selectionButton} type="button" disabled={busy} onClick={() => void run('ask')}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-accent-fg hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50">
        <MessageSquarePlus className="size-4" aria-hidden />{zh ? '在对话中使用选区' : 'Use selection in chat'}
      </button> : null}
      {editable ? <button type="button" disabled={busy} onClick={() => void run('save')}
        aria-keyshortcuts="Meta+S Control+S" className="min-h-10 rounded-lg bg-accent px-3 text-sm font-medium text-on-accent hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50">
        {zh ? '保存版本' : 'Save version'}
      </button> : null}
    </div> : null}
    {error ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-subtle px-3 py-2 text-xs">
      <p role="alert" className="text-danger">{error}</p>
      {conflict ? <button type="button" disabled={busy} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-edge px-2 font-medium hover:bg-surface-hover"
        onClick={() => void run('copy')}><Copy className="size-3.5" aria-hidden />{zh ? '保存副本' : 'Save a copy'}</button> : null}
    </div> : null}
    <div className="relative min-h-0 flex-1" aria-busy={state === 'loading'}>
      <div ref={host} inert={busy} className="absolute inset-0" />
      {state === 'loading' ? <div className="absolute inset-0 z-10 bg-surface-panel p-3"><Skeleton className="h-full rounded-xl" /></div> : null}
      {state === 'failed' ? <button type="button" className="relative m-3 rounded-lg px-2 py-1 text-sm text-accent-fg hover:bg-accent-soft"
        onClick={() => { setState('loading'); setAttempt(value => value + 1); }}>
        {zh ? '工作簿加载失败，重试' : 'Could not load the workbook. Retry'}
      </button> : null}
    </div>
    {selection ? <WorkbookChatPicker zh={zh} label={selection.label} sourceConversationId={sourceConversationId}
      onClose={() => setSelection(undefined)} onPick={sendToChat} restoreFocus={() => selectionButton.current?.focus()} /> : null}
  </div>;
}
