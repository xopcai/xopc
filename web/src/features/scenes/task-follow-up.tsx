import { useEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import useSWR from 'swr';

import type { TaskFollowUpInput } from '../../../../src/scenes/taskFollowUp/contracts';
import { Button } from '@/components/ui/button';
import { PageContextCaptureButton } from '@/features/chat/context/page-context-capture-button';
import { Select, SelectOption } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchProjects } from '@/features/projects/api';
import { useLocaleStore } from '@/stores/locale-store';

import { sceneErrorText, sceneGet, sceneWrite, type SceneActivation, type SceneTemplate } from './api';
import { SceneDirtyGuard } from './scene-dirty-guard';

const field = 'min-h-11 w-full rounded-md border border-edge bg-surface-panel px-3 py-2 text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:text-sm';
const panel = 'min-w-0 space-y-4 rounded-xl border border-edge bg-surface-panel p-4';
export type TaskExecutionDetails = {
  activation: SceneActivation; task: { id: string; title: string; phase: string }; input: TaskFollowUpInput;
  source?: { content: string; observedAt: number }; artifactPath?: string;
  environment?: { rootPath: string; branchRef?: string };
  observedRevision: number; deliveredRevision: number; processedRevision: number; lastError: string | null;
  run?: { status: string }; receipt?: { summary: string; needsUser: boolean; verification: { status: string }; remainingWork: string[];
    evidence: Array<{ title: string; summary: string }>; changes: Array<{ title: string; summary: string }> };
};

function capabilities(resource: TaskFollowUpInput['resource'], writable: boolean, command: string): TaskFollowUpInput['capabilities'] {
  return resource === 'none' ? [] : ['workspace.read', ...(writable ? ['workspace.write' as const] : []),
    ...(resource === 'worktree' && command.trim() ? ['verification.run' as const] : [])];
}

export function CreateTaskExecution({ template }: { template: SceneTemplate }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const text = (cn: string, en: string) => zh ? cn : en;
  const navigate = useNavigate();
  const providers = useSWR<{ providers: Array<{ id: string; label: string }> }>('/source-providers', sceneGet);
  const [provider, setProvider] = useState('');
  const providerId = provider || providers.data?.providers[0]?.id || '';
  const accounts = useSWR<{ accounts: Array<{ id: string; label: string }> }>(providerId ? `/source-providers/${encodeURIComponent(providerId)}/accounts` : null, sceneGet);
  const projects = useSWR('follow-up-projects', () => fetchProjects({ limit: 100 }));
  const [account, setAccount] = useState('');
  const [project, setProject] = useState('');
  const [url, setUrl] = useState('');
  const [goal, setGoal] = useState('');
  const [instruction, setInstruction] = useState('');
  const [resource, setResource] = useState<TaskFollowUpInput['resource']>('none');
  const [writable, setWritable] = useState(false);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const availableProjects = projects.data?.items.filter(item => item.workspaceRoot) ?? [];
  const accountId = account || (accounts.data?.accounts.length === 1 ? accounts.data.accounts[0].id : '');
  const projectId = project || (availableProjects.length === 1 ? availableProjects[0].id : '');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const { source } = await sceneWrite<{ source: TaskFollowUpInput['source'] }>(`/source-providers/${encodeURIComponent(providerId)}/resolve-link`, 'POST', { accountId, url });
      const input = { source, sourceUrl: url, goal, instruction, resource,
        ...(resource === 'worktree' ? { projectId } : {}),
        capabilities: capabilities(resource, writable, command),
        ...(resource === 'worktree' && command.trim() ? { verificationCommand: command.trim() } : {}) };
      const request = { templateKey: template.key, templateVersion: template.version, configuration: input };
      const preflight = await sceneWrite<{ ready: boolean; missing: string[] }>('/preflight', 'POST', request);
      if (!preflight.ready) {
        const labels: Record<string, string> = {
          verification_backend: text('可选验证需要配置隔离后端；也可清空验证命令，先生成修改。', 'Optional verification needs an isolation backend. Clear the command to proceed without running tests.'),
          verification_backend_unavailable: text('验证后端不可用；检查配置或清空验证命令。', 'Verification backend unavailable. Check settings or clear the command.'),
          clean_base_checkout: text('项目基础工作区有未提交改动，请先整理。', 'The project base checkout has uncommitted changes.'),
          source_read_permission: text('来源读取权限不足，请检查连接。', 'Source read permission is missing. Check the connection.'),
          model_credentials: text('请配置模型凭据。', 'Configure model credentials.'),
          model_configuration: text('请选择可用模型。', 'Choose an available model.'),
        };
        setError(preflight.missing.map(item => labels[item] ?? item).join(' ')); return;
      }
      const created = await sceneWrite<TaskExecutionDetails>('/activations', 'POST', request);
      flushSync(() => setSaved(true)); navigate(`/scenes/${created.activation.id}`, { replace: true });
    } catch (cause) { setError(sceneErrorText(cause, zh)); }
    finally { setBusy(false); setTimeout(() => errorRef.current?.focus(), 0); }
  }
  if (providers.error || accounts.error || projects.error) return <p role="alert">{sceneErrorText(providers.error ?? accounts.error ?? projects.error, zh)}</p>;
  if (!providers.data || !projects.data || (providerId && !accounts.data)) return <div aria-busy="true"><Skeleton className="h-12" /><Skeleton className="mt-4 h-32" /></div>;
  return <form className="space-y-5" onSubmit={submit}>
    <SceneDirtyGuard dirty={!saved && Boolean(url || goal || instruction)} zh={zh} />
    <h2 className="text-lg font-semibold text-fg">{template.title}</h2>
    <p className="text-sm text-fg-muted">{template.description}</p>
    <fieldset disabled={busy} className="space-y-5">
      <label className="grid gap-2 text-sm text-fg">{text('来源', 'Source')}<Select aria-label={text('来源', 'Source')} value={providerId} onChange={e => { setProvider(e.target.value); setAccount(''); }} required>
        {providers.data.providers.map(item => <SelectOption key={item.id} value={item.id}>{item.label}</SelectOption>)}
      </Select></label>
      {!accounts.data?.accounts.length && <p className="text-sm text-fg-muted">{text('请先连接可读取的账号。', 'Connect an account with read access first.')} <Link className="text-accent-fg" to="/capabilities/connectors">{text('连接', 'Connections')}</Link></p>}
      <label className="grid gap-2 text-sm text-fg">{text('账号', 'Account')}<Select aria-label={text('账号', 'Account')} value={accountId} onChange={e => setAccount(e.target.value)} required>
        <SelectOption value="">{text('选择账号', 'Choose an account')}</SelectOption>{accounts.data?.accounts.map(item => <SelectOption key={item.id} value={item.id}>{item.label}</SelectOption>)}
      </Select></label>
      <label className="grid gap-2 text-sm text-fg">{text('来源链接', 'Source link')}<input className={field} type="url" required maxLength={2000} value={url} onChange={e => setUrl(e.target.value)} /></label>
      <label className="grid gap-2 text-sm text-fg">{text('你希望完成什么？', 'What should be accomplished?')}<textarea className={field} required maxLength={6000} rows={3} value={goal} onChange={e => setGoal(e.target.value)} /></label>
      <label className="grid gap-2 text-sm text-fg">{text('处理指令（可选）', 'Instructions (optional)')}<textarea className={field} rows={3} maxLength={12000} value={instruction} onChange={e => setInstruction(e.target.value)}
        placeholder={text('例如：持续更新决策记录；有冲突时向我确认。', 'For example: keep a decision log updated; ask me about conflicts.')} /></label>
      <section className={panel}>
        <h3 className="font-medium text-fg">{text('资源与权限', 'Resources and permissions')}</h3>
        <label className="grid gap-2 text-sm text-fg">{text('工作资源', 'Workspace resource')}<Select aria-label={text('工作资源', 'Workspace resource')} value={resource} onChange={e => { setResource(e.target.value as TaskFollowUpInput['resource']); setCommand(''); setWritable(false); }}>
          <SelectOption value="none">{text('无文件资源 · 分析与建议', 'No files · analysis and recommendations')}</SelectOption>
          <SelectOption value="artifacts">{text('任务产物目录 · 文档等文件', 'Task artifact folder · documents and files')}</SelectOption>
          <SelectOption value="worktree">{text('Git worktree · 项目修改', 'Git worktree · project changes')}</SelectOption>
        </Select></label>
        {resource === 'worktree' && <label className="grid gap-2 text-sm text-fg">{text('项目', 'Project')}<Select aria-label={text('项目', 'Project')} required value={projectId} onChange={e => setProject(e.target.value)}>
          <SelectOption value="">{text('选择本地 Git 项目', 'Choose a local Git project')}</SelectOption>{availableProjects.map(item => <SelectOption key={item.id} value={item.id}>{item.name}</SelectOption>)}
        </Select></label>}
        {resource !== 'none' && <label className="flex min-h-11 items-center gap-3 text-sm text-fg"><input className="ui-checkbox" type="checkbox" checked={writable} onChange={e => setWritable(e.target.checked)} />{text('允许创建和修改此任务工作区内的文件', 'Allow creating and editing files in this task workspace')}</label>}
        {resource === 'worktree' && <details className="space-y-3"><summary className="cursor-pointer text-sm text-fg">{text('可选：授权运行验证命令', 'Optional: authorize a verification command')}</summary>
          <label className="grid gap-2 text-sm text-fg">{text('固定验证命令（留空则不执行命令）', 'Fixed verification command (blank means no commands)')}<input className={field} maxLength={2000} value={command} onChange={e => setCommand(e.target.value)} placeholder="pnpm test" /></label>
          <p className="text-sm text-fg-muted">{text('仅此可选工具需要已配置的隔离后端。留空也能修改文件，但结果会标记未验证。不会自动改为宿主机执行。', 'Only this optional tool needs a configured isolation backend. File edits work without it and remain unverified. No automatic host execution.')}</p>
          <Link to="/settings/agent-defaults" className="text-sm text-accent-fg">{text('查看执行设置', 'Execution settings')}</Link>
        </details>}
        <p className="text-sm text-fg-muted">{text('不会提交、推送、部署或对外发消息。约每分钟检查一次，Gateway 需要保持在线。', 'No commits, pushes, deployment or outgoing messages. Checks about once a minute while the Gateway is online.')}</p>
      </section>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="text-sm text-danger">{error}</p>}
      <Button variant="primary" type="submit" disabled={busy || !accountId || (resource === 'worktree' && !projectId)}>{busy ? text('正在检查并开启…', 'Checking and starting…') : text('确认范围并开始跟进', 'Confirm scope and start following')}</Button>
    </fieldset>
  </form>;
}

export function TaskExecutionDetail({ id, initial }: { id: string; initial: TaskExecutionDetails }) {
  const [configurationDirty, setConfigurationDirty] = useState(false);
  const zh = useLocaleStore(state => state.language) === 'zh';
  const text = (cn: string, en: string) => zh ? cn : en;
  const path = `/activations/${encodeURIComponent(id)}`;
  const detail = useSWR<{ details: TaskExecutionDetails }>(path, sceneGet, { refreshInterval: 5000, fallbackData: { details: initial } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function transition(status: 'active' | 'paused' | 'archived') {
    setBusy(true); setError('');
    try { await sceneWrite(path, 'PATCH', { expectedRevision: detail.data!.details.activation.revision, status }); await detail.mutate(); }
    catch (cause) { setError(sceneErrorText(cause, zh)); }
    finally { setBusy(false); }
  }
  if (detail.error) return <p role="alert">{sceneErrorText(detail.error, zh)}</p>;
  if (!detail.data) return <div aria-busy="true"><Skeleton className="h-48" /></div>;
  const item = detail.data.details;
  const current = item.processedRevision > 0 && item.processedRevision === item.observedRevision;
  return <div className="space-y-5">
    <h2 className="break-words text-lg font-semibold text-fg">{item.activation.goal}</h2>
    <PageContextCaptureButton resource={{ kind: 'scene', id: item.activation.id, revision: String(item.activation.revision) }} disabled={busy || configurationDirty} />
    <p className="text-sm text-fg-muted" role="status">{item.activation.status === 'archived' ? text('已停止跟进，任务与产物已保留', 'Stopped following; task and artifacts retained')
      : item.lastError || item.activation.status === 'needs_setup' || item.receipt?.needsUser ? text('需要你处理', 'Needs your attention')
      : item.activation.status === 'paused' ? text('已暂停', 'Paused')
      : item.run?.status === 'running' ? text('正在处理', 'Working')
      : current ? text('已处理当前来源版本，继续观察变化', 'Current source revision processed; watching for updates') : text('正在跟进', 'Following updates')}</p>
    <section className={panel}>
      <h3 className="font-medium text-fg">{text('来源 → 任务 → 产物', 'Source → task → artifacts')}</h3>
      <p className="break-words text-sm text-fg-muted">{item.input.source.provider}</p>
      <div className="flex flex-wrap gap-4"><Link className="text-sm text-accent-fg" to={`/tasks/${item.task.id}`}>{text('打开关联任务', 'Open linked task')}</Link>
        {item.input.sourceUrl && <a className="text-sm text-accent-fg" href={item.input.sourceUrl} target="_blank" rel="noopener noreferrer">{text('打开原讨论', 'Open source')}</a>}</div>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-fg-muted">{text('已观察版本', 'Observed revision')}</dt><dd>{item.observedRevision}</dd></div>
        <div><dt className="text-fg-muted">{text('已交付版本', 'Delivered revision')}</dt><dd>{item.deliveredRevision}</dd></div>
        <div><dt className="text-fg-muted">{text('已处理版本', 'Processed revision')}</dt><dd>{item.processedRevision || '—'}</dd></div>
      </dl>
      {(item.environment || item.artifactPath) && <div className="space-y-2 break-all text-sm text-fg-muted">
        {item.environment?.branchRef && <p>{text('任务分支：', 'Task branch: ')}{item.environment.branchRef}</p>}
        <p>{text('产物位置：', 'Artifact location: ')}{item.environment?.rootPath ?? item.artifactPath}</p>
      </div>}
      <p className="text-sm text-fg-muted">{text('已处理不代表通过验收。验证状态以工具证据为准。', 'Processed does not mean accepted. Verification status comes from tool evidence.')}</p>
    </section>
    {item.lastError && <p role="alert" className="break-words text-sm text-danger">{item.lastError}</p>}
    {item.receipt && <section className={panel}>
      <h3 className="font-medium text-fg">{text('最近结果', 'Latest result')}</h3>
      <p className="text-sm text-fg-muted">{item.receipt.verification.status === 'passed' ? text('已授权命令通过；仍需审阅业务结果', 'Approved command passed; review the outcome') : text('未验证：没有当前版本的通过证据', 'Unverified: no passing evidence for the current revision')}</p>
      <p className="whitespace-pre-wrap break-words text-sm text-fg">{item.receipt.summary}</p>
      {item.receipt.remainingWork.map((work, index) => <p key={index} className="text-sm text-fg-muted">{work}</p>)}
      <details><summary className="cursor-pointer text-sm text-fg">{text('产物与验证证据', 'Artifacts and verification evidence')}</summary>
        {[...item.receipt.changes, ...item.receipt.evidence].map((entry, index) => <pre key={index} className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs text-fg-muted">{entry.title}{'\n'}{entry.summary}</pre>)}
      </details>
    </section>}
    {item.input.resource === 'worktree' && item.input.projectId && <TaskBranches projectId={item.input.projectId} taskId={item.task.id} />}
    {item.activation.status === 'paused' && <FollowUpConfiguration key={item.activation.id} item={item} onSaved={() => detail.mutate()} onDirty={setConfigurationDirty} />}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap gap-3">{item.activation.status !== 'archived' && <>
      <Button variant="secondary" disabled={busy} onClick={() => void transition(item.activation.status === 'active' ? 'paused' : 'active')}>
        {busy ? text('处理中…', 'Working…') : item.activation.status === 'active' ? text('暂停跟进与执行', 'Pause observation and execution') : text('确认后恢复', 'Resume after review')}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => void transition('archived')}>{text('停止跟进（保留产物）', 'Stop following (keep artifacts)')}</Button>
    </>}</div>
  </div>;
}

function FollowUpConfiguration({ item, onSaved, onDirty }: { item: TaskExecutionDetails; onSaved: () => Promise<unknown>; onDirty: (dirty: boolean) => void }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const text = (cn: string, en: string) => zh ? cn : en;
  const [draft, setDraft] = useState<{ base: TaskExecutionDetails; instruction: string; writable: boolean; command: string } | null>(null);
  const fields = draft ?? { base: item, instruction: item.input.instruction, writable: item.input.capabilities.includes('workspace.write'), command: item.input.verificationCommand ?? '' };
  const { instruction, writable, command } = fields;
  const edit = (patch: Partial<Pick<typeof fields, 'instruction' | 'writable' | 'command'>>) => setDraft(previous => ({ ...(previous ?? fields), ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = instruction !== item.input.instruction || writable !== item.input.capabilities.includes('workspace.write') || command !== (item.input.verificationCommand ?? '');
  useEffect(() => { onDirty(dirty || busy); return () => onDirty(false); }, [dirty, busy, onDirty]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const base = fields.base;
      await sceneWrite(`/activations/${item.activation.id}`, 'PATCH', { expectedRevision: base.activation.revision,
        configuration: { ...base.input, instruction, capabilities: capabilities(base.input.resource, writable, command), verificationCommand: command.trim() || undefined } });
      await onSaved();
      setDraft(null);
    } catch (cause) { setError(sceneErrorText(cause, zh)); } finally { setBusy(false); }
  }
  return <details className={panel}><summary className="cursor-pointer text-sm text-fg">{text('调整指令与授权', 'Edit instructions and permissions')}</summary>
    <SceneDirtyGuard dirty={dirty} zh={zh} />
    <form className="space-y-3" onSubmit={submit}>
      <label className="grid gap-2 text-sm text-fg">{text('处理指令', 'Instructions')}<textarea disabled={busy} className={field} rows={4} maxLength={12000} value={instruction} onChange={e => edit({ instruction: e.target.value })} /></label>
      {fields.base.input.resource !== 'none' && <label className="flex min-h-11 items-center gap-3 text-sm text-fg"><input disabled={busy} type="checkbox" className="ui-checkbox" checked={writable} onChange={e => edit({ writable: e.target.checked })} />{text('允许修改任务工作区文件', 'Allow task workspace file edits')}</label>}
      {fields.base.input.resource === 'worktree' && <label className="grid gap-2 text-sm text-fg">{text('验证命令（可选；留空不执行）', 'Verification command (optional; blank disables execution)')}<input disabled={busy} className={field} maxLength={2000} value={command} onChange={e => edit({ command: e.target.value })} /></label>}
      <p className="text-sm text-fg-muted">{text('保存后仍保持暂停。确认授权范围后再恢复。', 'Saving keeps the monitor paused. Review permissions before resuming.')}</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={busy || !dirty}>{busy ? text('正在保存…', 'Saving…') : text('保存指令与授权', 'Save instructions and permissions')}</Button>
      {draft && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>{text('放弃修改', 'Discard edits')}</Button>}
    </form>
  </details>;
}

type Branch = { ref: string; sha: string; subject: string; worktree?: string; taskId: string | null; activationId: string | null; association: string; changedSinceConfirmation: boolean };

function TaskBranches({ projectId, taskId }: { projectId: string; taskId: string }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inventory = useSWR<{ checkoutDirty: boolean; branches: Branch[] }>(open ? `/resources/projects/${encodeURIComponent(projectId)}/branches` : null, sceneGet);
  const branch = inventory.data?.branches.find(item => item.ref === selected);
  async function associate() {
    if (!branch) return; setBusy(true); setError('');
    try {
      await sceneWrite('/resources/branch-links', 'POST', { projectId, taskId, branchRef: branch.ref, expectedSha: branch.sha });
      await inventory.mutate();
    } catch (cause) { setError(sceneErrorText(cause, zh)); }
    finally { setBusy(false); }
  }
  return <details className={panel} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-sm text-fg">{zh ? '已有分支与需求关联' : 'Existing branches and requirements'}</summary>
    <p className="text-sm text-fg-muted">{zh ? '只读盘点。确认关联仅记录归属，不接管该分支，也不修改、重命名或清理代码。' : 'Read-only inventory. Confirming records ownership only: no takeover, edits, renaming or cleanup.'}</p>
    {inventory.error ? <p role="alert" className="text-sm text-danger">{sceneErrorText(inventory.error, zh)}</p> : !inventory.data ? <Skeleton className="h-24" /> : <>
      {inventory.data.checkoutDirty && <p className="text-sm text-fg-muted">{zh ? '基础工作区存在未提交改动，已保留。' : 'The base checkout has uncommitted changes; they are preserved.'}</p>}
      <Select aria-label={zh ? '选择已有分支' : 'Choose an existing branch'} value={selected} onChange={event => setSelected(event.target.value)}>
        <SelectOption value="">{zh ? '选择分支查看归属' : 'Choose a branch to inspect'}</SelectOption>
        {inventory.data.branches.map(item => <SelectOption key={item.ref} value={item.ref}>{item.ref.replace('refs/heads/', '')}</SelectOption>)}
      </Select>
      {branch && <div className="space-y-3 break-all text-sm text-fg"><p>{branch.subject}</p><p className="text-fg-muted">{branch.sha}</p>
        {branch.worktree && <p className="text-fg-muted">{branch.worktree}</p>}
        {branch.taskId ? <Link className="text-accent-fg" to={branch.activationId ? `/scenes/${branch.activationId}` : `/tasks/${branch.taskId}`}>{zh ? '查看对应事项' : 'Open associated work'}</Link>
          : <Button variant="secondary" disabled={busy} onClick={() => void associate()}>{busy ? (zh ? '关联中…' : 'Linking…') : (zh ? '确认关联到当前任务' : 'Confirm association with this task')}</Button>}
        {branch.changedSinceConfirmation && <p className="text-fg-muted">{zh ? '该分支在确认关联后已有新提交。' : 'This branch has new commits since confirmation.'}</p>}
      </div>}
    </>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </details>;
}
