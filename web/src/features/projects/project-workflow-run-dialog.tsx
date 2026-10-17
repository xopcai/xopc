import * as Dialog from '@radix-ui/react-dialog';
import { Check, GitBranch, Play, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import {
  listProjectWorkflowPresets,
  listWorkflowDefinitions,
  startWorkflowRun,
  type WorkflowRunContextRef,
} from '@/features/workflows/workflow-api';
import { WorkflowContextPicker } from '@/features/workflows/workflow-context-picker';
import { resolveWorkflowInputPayload, validateWorkflowInputEditorValue } from '@/features/workflows/workflow-input-editor.utils';
import { resolveWorkflowLocalizedCopy } from '@/features/workflows/workflow-meta-locale';
import { WorkflowRunSetupPanel, type WorkflowRunSetupValue } from '@/features/workflows/workflow-run-setup-panel';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';

const emptySetup = (): WorkflowRunSetupValue => ({ goal: '', argValues: {}, schemaInput: {}, concurrency: '', maxSubagents: '' });

export function ProjectWorkflowRunButton({ projectId }: { projectId: string }) {
  const language = useLocaleStore((state) => state.language);
  const labels = messages(language).workflows;
  const zh = language === 'zh';
  const [open, setOpen] = useState(false);
  const [workflowId, setWorkflowId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [setup, setSetup] = useState(emptySetup);
  const [contextRefs, setContextRefs] = useState<WorkflowRunContextRef[]>([]);
  const [rawJsonValid, setRawJsonValid] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<{ runId: string; agentId: string } | null>(null);
  const definitions = useSWR(open ? 'workflow-definitions' : null, listWorkflowDefinitions, { revalidateOnFocus: false });
  const agents = useSWR(open ? 'workflow-agents' : null, fetchGatewayAgents, { revalidateOnFocus: false });
  const presets = useSWR(open ? ['workflow-project-presets', projectId] : null, () => listProjectWorkflowPresets(projectId), { revalidateOnFocus: false });
  const definition = definitions.data?.find((item) => item.id === workflowId);
  const localized = definition ? resolveWorkflowLocalizedCopy(definition, language) : null;
  const agentId = selectedAgentId || agents.data?.defaultId;
  const loading = definitions.isLoading || agents.isLoading || presets.isLoading;
  const loadError = definitions.error || agents.error || presets.error;
  const valid = validateWorkflowInputEditorValue(definition, setup, rawJsonValid).valid;

  const changeOpen = (next: boolean) => {
    if (starting) return;
    if (next) {
      setWorkflowId(''); setSelectedAgentId(''); setSetup(emptySetup());
      setContextRefs([]); setRawJsonValid(true); setError(null); setStarted(null);
    }
    setOpen(next);
  };
  const selectWorkflow = (id: string) => {
    setWorkflowId(id); setSetup(emptySetup()); setRawJsonValid(true); setError(null);
    setContextRefs(presets.data?.find((preset) => preset.definitionId === id)?.contextRefs ?? []);
  };
  const start = async () => {
    if (!definition || !agentId || !valid || starting || started || loading || loadError) return;
    setStarting(true); setError(null);
    try {
      const result = await startWorkflowRun({
        definitionId: definition.id,
        agentId,
        projectId,
        goal: setup.goal.trim() || localized?.description || definition.title,
        input: resolveWorkflowInputPayload(definition, setup),
        contextRefs,
        concurrency: setup.concurrency.trim() ? Number(setup.concurrency) : undefined,
        maxSubagents: setup.maxSubagents.trim() ? Number(setup.maxSubagents) : undefined,
      });
      setStarted({ runId: result.runId, agentId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.startFailed);
      return;
    } finally {
      setStarting(false);
    }
  };

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild>
      <Button variant="secondary" className="h-9 rounded-lg"><GitBranch className="size-4" aria-hidden />{messages(language).projectDetailPage.common.runWorkflow}</Button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-50 bg-scrim backdrop-blur-[2px]" />
      <Dialog.Content className="xopc-dialog-content fixed left-1/2 top-1/2 z-50 flex h-[min(46rem,calc(100dvh-2rem))] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-edge bg-surface-overlay shadow-float">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-edge px-5 py-4">
          <div>
            <Dialog.Title className="text-base font-semibold text-fg">{messages(language).projectDetailPage.common.runWorkflow}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-fg-muted">{zh ? '选择工作流并运行，结果将关联到当前项目。' : 'Choose and run a workflow. The run will be linked to this project.'}</Dialog.Description>
          </div>
          <Dialog.Close asChild><Button variant="ghost" className="size-8 p-0" disabled={starting} aria-label={labels.pickStartClose}><X className="size-4" aria-hidden /></Button></Dialog.Close>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {started ? <div role="status" className="flex flex-col items-center gap-3 py-12 text-center">
            <Check className="size-8 text-success" aria-hidden />
            <p className="text-base font-medium text-fg">{labels.startSuccess}</p>
            <p className="text-sm text-fg-muted">{zh ? '工作流正在后台运行，你可以继续处理项目。' : 'The workflow is running in the background. You can continue working on your project.'}</p>
            <Button asChild variant="secondary"><Link to={`/workflows/runs/${encodeURIComponent(started.runId)}?agentId=${encodeURIComponent(started.agentId)}&projectId=${encodeURIComponent(projectId)}`}>{labels.taskOpenDetails}</Link></Button>
          </div> : loading ? <div className="space-y-4" aria-label={zh ? '正在加载工作流' : 'Loading workflows'}>
            <Skeleton className="h-10 w-full rounded-lg" /><Skeleton className="h-10 w-full rounded-lg" /><Skeleton className="h-56 w-full rounded-xl" />
          </div> : loadError ? <p role="alert" className="text-sm text-danger">{loadError instanceof Error ? loadError.message : labels.startFailed}</p> : !definitions.data?.length ? <p className="py-12 text-center text-sm text-fg-muted">{zh ? '还没有可运行的工作流，请先新建工作流。' : 'No workflows are available. Create a workflow to get started.'}</p> : <div className="space-y-4">
            <label className="block text-xs font-medium text-fg-muted">{labels.chooseWorkflow}
              <Select value={workflowId} onChange={(event) => selectWorkflow(event.target.value)} disabled={starting} aria-label={labels.chooseWorkflow} className="mt-1 w-full">
                <SelectOption value="">{labels.chooseWorkflow}</SelectOption>
                {definitions.data.map((item) => <SelectOption key={item.id} value={item.id}>{resolveWorkflowLocalizedCopy(item, language).title}</SelectOption>)}
              </Select>
            </label>
            <label className="block text-xs font-medium text-fg-muted">{zh ? '执行助手' : 'Execution assistant'}
              <Select value={agentId ?? ''} onChange={(event) => setSelectedAgentId(event.target.value)} disabled={starting} aria-label={zh ? '执行助手' : 'Execution assistant'} className="mt-1 w-full">
                {agents.data?.agents.map((agent) => <SelectOption key={agent.id} value={agent.id}>{agentListDisplayName(agent, messages(language).agentsSettings)}</SelectOption>)}
              </Select>
            </label>
            {definition && localized ? <>
              <p className="text-sm leading-6 text-fg-muted">{localized.description}</p>
              <WorkflowContextPicker projectId={projectId} language={language} value={contextRefs} onChange={setContextRefs} />
              <WorkflowRunSetupPanel definition={definition} language={language} value={setup} onChange={setSetup} mode="manual" onValidityChange={(validity) => setRawJsonValid(validity.reason !== 'raw-json')} />
            </> : null}
            {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          </div>}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-edge px-5 py-4">
          <Button asChild variant="ghost" disabled={starting}><Link to={`/workflows/new?projectId=${encodeURIComponent(projectId)}`} onClick={(event) => { if (starting) event.preventDefault(); }}>{labels.addWorkflow}</Link></Button>
          {started ? <Dialog.Close asChild><Button variant="primary">{labels.pickStartClose}</Button></Dialog.Close> : <Button variant="primary" disabled={loading || Boolean(loadError) || !definition || !agentId || !valid || starting} onClick={() => void start()}><Play className="size-4" aria-hidden />{starting ? labels.starting : labels.runWorkflow}</Button>}
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
