import { Copy } from 'lucide-react';
import { SPACE_WORKBOOK_SELECTION_MAX_BYTES, SPACE_WORKBOOK_SELECTION_MIME } from '@xopcai/gateway-contract';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { useBeforeUnload } from 'react-router-dom';
import { CommandType, createUniver, LifecycleStages, LocaleType, type IWorkbookData } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import enUS from '@univerjs/preset-sheets-core/locales/en-US';
import zhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';

import { Skeleton } from '@/components/ui/skeleton';
import type { ComposerContextRef } from '@/features/chat/composer/composer.types';
import { useThemeStore } from '@/stores/theme-store';

import { createSpaceWorkbook, saveSpaceWorkbook, spaceContent } from './space-api';

type Workbook = ReturnType<ReturnType<typeof createUniver>['univerAPI']['createWorkbook']>;
type Editor = { univerAPI: ReturnType<typeof createUniver>['univerAPI']; workbook: Workbook };

export type WorkbookEditorControls = {
  hasChanges: () => boolean;
  flushSave: () => Promise<string | undefined>;
  prepareChatContext: () => Promise<ComposerContextRef | null>;
  readSelection: () => Promise<File | undefined>;
};

const drafts = new Map<string, IWorkbookData>();
const autosaveDelay = 900;

function rememberDraft(versionId: string, snapshot: IWorkbookData) {
  drafts.delete(versionId);
  drafts.set(versionId, structuredClone(snapshot));
}

async function commitCellEdit({ workbook }: Editor) {
  if (workbook.isCellEditing() && !await workbook.endEditingAsync(true)) throw new Error('Cell edit could not be committed');
}

async function recalculate({ univerAPI }: Editor) {
  const formula = univerAPI.getFormula();
  formula.executeCalculation();
  await formula.onCalculationResultApplied(5_000);
}

export default function SpaceWorkbook({ id, versionId, title, zh, editable, targetSheet, targetRange, controls, newerVersionPending, onSaved, onCopy }: {
  id: string;
  versionId: string;
  title: string;
  zh: boolean;
  editable: boolean;
  targetSheet?: string;
  targetRange?: string;
  controls: Ref<WorkbookEditorControls>;
  newerVersionPending: boolean;
  onSaved: (versionId: string) => void;
  onCopy: (id: string) => void;
}) {
  const [initialVersion] = useState(versionId);
  const dark = useThemeStore(state => state.resolved === 'dark');
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<Editor | null>(null);
  const latest = useRef({ dark, editable, zh });
  const pendingAction = useRef<Promise<File | undefined> | null>(null);
  const pendingSave = useRef<Promise<string | undefined> | null>(null);
  const autosaveTimer = useRef<number | undefined>(undefined);
  const saveInBackground = useRef<() => void>(() => {});
  const baseVersion = useRef(initialVersion);
  const changeRevision = useRef(0);
  const savedRevision = useRef(0);
  const retryCount = useRef(0);
  const saveConflict = useRef(false);
  const copyRequest = useRef<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const clearAutosave = useCallback(() => {
    window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = undefined;
  }, []);

  const scheduleAutosave = useCallback((delay = autosaveDelay) => {
    clearAutosave();
    autosaveTimer.current = window.setTimeout(() => {
      autosaveTimer.current = undefined;
      saveInBackground.current();
    }, delay);
  }, [clearAutosave]);

  const hasChanges = () => changeRevision.current !== savedRevision.current || Boolean(runtime.current?.workbook.isCellEditing());

  useBeforeUnload(event => {
    if (!hasChanges()) return;
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
        const blob = await spaceContent(id, initialVersion, request.signal);
        const stored = JSON.parse(await blob.text()) as IWorkbookData;
        if (request.signal.aborted) return;
        const { dark, editable, zh } = latest.current;
        const draft = editable ? drafts.get(initialVersion) : undefined;
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
        baseVersion.current = initialVersion;
        runtime.current = { univerAPI, workbook };
        changeRevision.current = draft ? 1 : 0;
        savedRevision.current = 0;
        retryCount.current = 0;
        saveConflict.current = false;
        const listener = workbook.onCommandExecuted(command => {
          if (!latest.current.editable || command.type !== CommandType.MUTATION || command.id.includes('formula')) return;
          // Univer applies calculated values through the same mutation as user edits.
          if (command.params && 'sourceFormulaData' in command.params) return;
          changeRevision.current++;
          retryCount.current = 0;
          if (!saveConflict.current) scheduleAutosave();
        });
        const ready = () => {
          if (request.signal.aborted) return;
          setState('ready');
          if (changeRevision.current !== savedRevision.current) scheduleAutosave();
        };
        const lifecycle = univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
          if (stage === LifecycleStages.Steady) ready();
        });
        dispose = () => {
          lifecycle.dispose();
          listener.dispose();
          if (changeRevision.current !== savedRevision.current) rememberDraft(baseVersion.current, workbook.save());
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
      clearAutosave();
      runtime.current = null;
      dispose?.();
    };
  }, [attempt, clearAutosave, id, initialVersion, scheduleAutosave]);

  useEffect(() => {
    if (state !== 'ready' || !targetSheet || !targetRange || !/^[A-Z]{1,2}[1-9]\d{0,3}(?::[A-Z]{1,2}[1-9]\d{0,3})?$/.test(targetRange)) return;
    const frame = requestAnimationFrame(() => {
      const workbook = runtime.current?.workbook;
      const sheet = workbook?.getSheetBySheetId(targetSheet);
      if (!sheet || sheet.isSheetHidden()) return;
      const range = sheet.getRange(targetRange);
      if (range.getLastRow() >= sheet.getMaxRows() || range.getLastColumn() >= sheet.getMaxColumns()) return;
      workbook?.setActiveSheet(sheet);
      sheet.setActiveRange(range);
      sheet.scrollToCell(range.getRow(), range.getColumn());
    });
    return () => cancelAnimationFrame(frame);
  }, [state, targetSheet, targetRange]);

  async function persist(editor: Editor, commit: boolean) {
    try {
      if (commit) await commitCellEdit(editor);
      const revision = changeRevision.current;
      if (revision === savedRevision.current) return baseVersion.current;
      await recalculate(editor);
      if (runtime.current !== editor) return;
      if (revision !== changeRevision.current || editor.workbook.isCellEditing()) return baseVersion.current;
      const previousVersion = baseVersion.current;
      const saved = await saveSpaceWorkbook(id, previousVersion, editor.workbook.save());
      if (runtime.current !== editor) return;
      baseVersion.current = saved.versionId;
      savedRevision.current = revision;
      retryCount.current = 0;
      drafts.delete(previousVersion);
      setError('');
      setSaveFailed(false);
      if (previousVersion !== saved.versionId) onSaved(saved.versionId);
      return saved.versionId;
    } catch (cause) {
      if (runtime.current !== editor) return;
      const status = (cause as { status?: number })?.status;
      const conflicted = status === 409;
      saveConflict.current = conflicted;
      setConflict(conflicted);
      setSaveFailed(!conflicted);
      setError(conflicted
        ? (zh ? '已有更新的版本，当前修改仍保留。' : 'A newer version is available. Your edits are still here.')
        : (zh ? '自动保存失败，当前修改仍保留。' : 'Autosave failed. Your edits are still here.'));
      if ((!status || status === 429 || status >= 500) && retryCount.current < 2) {
        retryCount.current++;
        scheduleAutosave(retryCount.current * 3_000);
      }
    }
  }

  async function flushSave(commit = true): Promise<string | undefined> {
    const editor = runtime.current;
    if (!editor) return baseVersion.current;
    if (!latest.current.editable) return hasChanges() ? undefined : baseVersion.current;
    if (saveConflict.current) return;
    clearAutosave();
    if (pendingAction.current) await pendingAction.current;
    while (runtime.current === editor && latest.current.editable) {
      const editingCell = editor.workbook.isCellEditing();
      const dirty = changeRevision.current !== savedRevision.current;
      if (!dirty && (!commit || !editingCell)) return baseVersion.current;
      if (!commit && editingCell) {
        scheduleAutosave();
        return baseVersion.current;
      }
      pendingSave.current ??= persist(editor, commit).finally(() => { pendingSave.current = null; });
      const version = await pendingSave.current;
      if (!version || runtime.current !== editor) return;
      if (!commit) {
        if (changeRevision.current !== savedRevision.current && autosaveTimer.current === undefined) scheduleAutosave();
        return version;
      }
    }
  }

  useLayoutEffect(() => { saveInBackground.current = () => { void flushSave(false); }; });

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') saveInBackground.current();
    }
    function onOnline() {
      if (changeRevision.current === savedRevision.current || saveConflict.current) return;
      retryCount.current = 0;
      scheduleAutosave(0);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
    };
  }, [scheduleAutosave]);

  function run(action: 'copy' | 'attach-selection') {
    if (pendingAction.current) return Promise.resolve(undefined);
    const operation = runAction(action).finally(() => { pendingAction.current = null; });
    pendingAction.current = operation;
    return operation;
  }

  async function runAction(action: 'copy' | 'attach-selection') {
    const editor = runtime.current;
    if (!editor) return;
    setBusy(true);
    try {
      if (pendingSave.current) await pendingSave.current;
      if (runtime.current !== editor) return;
      await commitCellEdit(editor);
      await recalculate(editor);
      if (runtime.current !== editor) return;
      if (action === 'copy') {
        const previousVersion = baseVersion.current;
        const saved = await createSpaceWorkbook(copyRequest.current ??= crypto.randomUUID(), `${title.slice(0, 220)}${zh ? '（副本）' : ' (copy)'}`, editor.workbook.save(), { id, versionId: previousVersion });
        if (runtime.current !== editor) return;
        savedRevision.current = changeRevision.current;
        drafts.delete(previousVersion);
        onCopy(saved.id);
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
      if (!saveConflict.current && !saveFailed) setError('');
      return file;
    } catch {
      if (runtime.current !== editor) return;
      setError(zh ? '操作未完成，请重试。' : 'Could not complete the action. Try again.');
    } finally {
      if (runtime.current === editor) setBusy(false);
    }
  }

  useImperativeHandle(controls, () => ({
    hasChanges,
    flushSave,
    readSelection: () => run('attach-selection'),
    async prepareChatContext() {
      if (!runtime.current) return null;
      const version = await flushSave();
      return version ? { kind: 'workbook', sourceId: id, expectedVersion: version, title } : null;
    },
  }));

  function onEditorKeyDown(event: React.KeyboardEvent) {
    if (!editable || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    event.stopPropagation();
    void flushSave();
  }

  return <div data-space-workbook className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" onKeyDownCapture={onEditorKeyDown}>
    {error || newerVersionPending ? <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge-subtle px-3 py-2 text-xs">
      {error ? <p role="alert" className="text-danger">{error}</p> : <p role="status" className="text-fg-muted">
        {zh ? '已有新版本，当前修改仍保留。' : 'A newer version is available. Your edits are still here.'}
      </p>}
      {conflict || newerVersionPending ? <button type="button" disabled={busy} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-edge px-2 font-medium hover:bg-surface-hover"
        onClick={() => void run('copy')}><Copy className="size-3.5" aria-hidden />{zh ? '保存副本' : 'Save a copy'}</button> : null}
      {saveFailed ? <button type="button" disabled={busy} className="min-h-9 rounded-lg px-2 font-medium text-accent-fg hover:bg-accent-soft"
        onClick={() => void flushSave()}>{zh ? '重试' : 'Retry'}</button> : null}
    </div> : null}
    <div className="relative min-h-0 flex-1" aria-busy={state === 'loading'}>
      <div ref={host} inert={busy} className="absolute inset-0" />
      {state === 'loading' ? <div className="absolute inset-0 z-10 bg-surface-panel p-3"><Skeleton className="h-full rounded-xl" /></div> : null}
      {state === 'failed' ? <button type="button" className="relative m-3 rounded-lg px-2 py-1 text-sm text-accent-fg hover:bg-accent-soft"
        onClick={() => { setState('loading'); setAttempt(value => value + 1); }}>
        {zh ? '工作簿加载失败，重试' : 'Could not load the workbook. Retry'}
      </button> : null}
    </div>
  </div>;
}
