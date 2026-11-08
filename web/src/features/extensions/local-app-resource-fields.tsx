import type { LocalAppExecutionAuthority, LocalAppResourceScope, LocalAppResourceScopes } from '@xopcai/gateway-contract';
import { useState } from 'react';
import useSWR from 'swr';

import { Select, SelectOption, SelectOptionList } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

function ResourcePicker({ extensionId, kind, values, onChange, zh }: {
  extensionId: string; kind: 'notes' | 'tasks' | 'projects' | 'automations' | 'files'; values: string[]; onChange: (ids: string[]) => void; zh: boolean;
}) {
  const [search, setSearch] = useState('');
  const url = `/api/extensions/${encodeURIComponent(extensionId)}/resource-options?kind=${kind}&search=${encodeURIComponent(search)}`;
  const { data, error, isLoading } = useSWR(url, path => fetchJson<{ items: Array<{ id: string; title: string }> }>(apiUrl(path)));
  const label = kind === 'notes' ? zh ? '笔记' : 'Notes' : kind === 'tasks' ? zh ? '任务' : 'Tasks'
    : kind === 'automations' ? zh ? '自动化' : 'Automations' : kind === 'files' ? zh ? '文件' : 'Files' : zh ? '项目' : 'Projects';
  const options = (data?.items ?? []).map(item => ({ value: item.id, label: item.title }));
  for (const id of values) if (!options.some(option => option.value === id)) options.push({ value: id, label: id });
  return <div className="mt-2 rounded-lg border border-edge p-2">
    <input aria-label={zh ? `搜索${label}` : `Search ${label}`} value={search} onChange={event => setSearch(event.target.value)}
      placeholder={zh ? `搜索${label}（最多显示 100 项）` : `Search ${label} (up to 100 results)`} className="w-full rounded-md border border-edge bg-surface-panel px-2 py-1.5 text-xs text-fg" />
    <div className="mt-1 max-h-36 overflow-y-auto">
      {isLoading ? <Skeleton className="h-16" /> : error ? <p role="alert" className="text-xs text-danger">{zh ? '无法加载，请重试' : 'Could not load resources'}</p>
        : <SelectOptionList ariaLabel={label} multiple options={options} values={values} onChange={onChange} />}
    </div>
  </div>;
}

export function LocalAppResourceFields({ extensionId, permissions, value, onChange, zh }: {
  extensionId: string; permissions: string[]; value: LocalAppResourceScopes; onChange: (next: LocalAppResourceScopes) => void; zh: boolean;
}) {
  const sections: Array<{ key: 'notesRead' | 'notesWrite' | 'tasksRead' | 'tasksWrite' | 'projectsRead' | 'projectsWrite' | 'automationsRead'; label: string; kind: 'notes' | 'tasks' | 'projects' | 'automations'; visible: boolean }> = [
    { key: 'notesRead', label: zh ? '读取笔记的范围' : 'Notes this app may read', kind: 'notes', visible: permissions.some(p => /capability:xopc.notes.(get|list)$/.test(p)) },
    { key: 'notesWrite', label: zh ? '修改与创建笔记的范围' : 'Notes this app may change or create', kind: 'notes', visible: permissions.some(p => /capability:xopc.notes.(create|update|append)$/.test(p)) },
    { key: 'tasksRead', label: zh ? '读取任务的范围' : 'Tasks this app may read', kind: 'tasks', visible: permissions.some(p => /capability:xopc.tasks.(get|list)$/.test(p)) },
    { key: 'automationsRead', label: zh ? '读取自动化的范围' : 'Automations this app may read', kind: 'automations', visible: permissions.some(p => /capability:xopc.automations.(get|list|get_run|history|run_events)$/.test(p)) },
    { key: 'tasksWrite', label: zh ? '创建和更新任务的范围' : 'Tasks this app may capture or edit', kind: 'tasks', visible: permissions.some(p => /capability:xopc.tasks.(create|update)$/.test(p)) },
    { key: 'projectsRead', label: zh ? '读取项目的范围' : 'Projects this app may read', kind: 'projects', visible: permissions.some(p => /capability:xopc.projects.(get|list|list_milestones|list_updates)$/.test(p)) },
    { key: 'projectsWrite', label: zh ? '更新项目和进度的范围' : 'Projects this app may update', kind: 'projects', visible: permissions.some(p => /capability:xopc.projects.(update|create_milestone|update_milestone|create_update)$/.test(p)) },
  ];
  return <div className="mt-4 space-y-4">
    {permissions.some(p => /capability:xopc.connectors./.test(p)) ? <ConnectorResourceFields extensionId={extensionId} value={value} onChange={onChange} zh={zh} /> : null}
    {permissions.includes('capability:xopc.files.read') ? <fieldset className="rounded-lg border border-edge p-3"><legend className="text-sm font-medium text-fg">{zh ? '文件与附件读取' : 'File and attachment reads'}</legend>
      <label className="flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={value.filesRead.mode === 'selected'} onChange={event => onChange({ ...value, filesRead: event.target.checked ? { mode: 'selected', ids: [] } : { mode: 'none' } })} />{zh ? '允许读取以下选定的工作区文件（每个最多 512 KiB）' : 'Allow reading these selected workspace files (up to 512 KiB each)'}</label>
      {value.filesRead.mode === 'selected' ? <ResourcePicker extensionId={extensionId} kind="files" values={value.filesRead.ids} zh={zh} onChange={ids => onChange({ ...value, filesRead: { mode: 'selected', ids } })} /> : null}
      <label className="mt-2 flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={value.filesImport} onChange={event => onChange({ ...value, filesImport: event.target.checked })} />{zh ? '允许在宿主中逐次选择并导入本机附件' : 'Allow choosing a local attachment in the host for each import'}</label>
    </fieldset> : null}
    {permissions.includes('capability:xopc.files.propose_export') ? <label className="flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={value.filesExport} onChange={event => onChange({ ...value, filesExport: event.target.checked })} />{zh ? '允许提出文件导出请求；每次均需在宿主确认保存，不直接覆盖 Gateway 文件' : 'Allow export requests; each browser save requires host confirmation and does not overwrite Gateway files'}</label> : null}

    {permissions.some(p => /capability:xopc.automations.(propose|get_proposal|simulate)$/.test(p)) ? <label className="flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={value.automationProposals}
      onChange={event => onChange({ ...value, automationProposals: event.target.checked })} />{zh ? '允许模拟和提交自动化提案；创建、修改或启用仍须在宿主逐项审核' : 'Allow simulation and automation proposals; creation, changes and activation still require host review'}</label> : null}
    {permissions.includes('capability:xopc.agent.delegate') ? <fieldset className="rounded-lg border border-edge p-3">
      <legend className="text-sm font-medium text-fg">{zh ? '受限 Agent 委托' : 'Restricted Agent delegation'}</legend>
      <label className="flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={value.agentDelegate}
        onChange={event => onChange({ ...value, agentDelegate: event.target.checked })} />
        {zh ? '允许发送应用指令、上下文和授权引用到已配置的模型' : 'Allow sending app instructions, context and approved references to the configured model'}</label>
      <p className="mt-2 text-xs text-fg-muted">{zh ? '可能产生模型费用。每应用每小时最多 20 次，每次最多 30 秒、4096 输出 token，支持文本或 JSON。无聊天历史、记忆、文件、工具或自动写入权限。预览不运行真实委托。' : 'May incur model costs. Up to 20 calls per app per hour, 30 seconds and 4096 output tokens per call, as text or JSON. No chat history, memory, files, tools or automatic writes. Unavailable in previews.'}</p>
    </fieldset> : null}
    {permissions.some(p => /capability:xopc.automations.(run|cancel)$/.test(p))
      ? <AutomationExecutionFields extensionId={extensionId} value={value} onChange={onChange} zh={zh} /> : null}
    {sections.filter(section => section.visible).map(section => {
    const scope = value[section.key];
    const update = (next: LocalAppResourceScope) => onChange({ ...value, [section.key]: next });
    return <fieldset key={section.key} className="min-w-0"><legend className="mb-2 text-sm font-medium text-fg">{section.label}</legend>
      <Select aria-label={section.label} value={scope.mode} onChange={event => update(event.target.value === 'selected'
        ? { mode: 'selected', ids: [], projectIds: [], includeCreated: false } : { mode: event.target.value as 'none' | 'workspace' })}>
        <SelectOption value="none">{zh ? '不允许' : 'No access'}</SelectOption>
        <SelectOption value="selected">{zh ? '仅选择的记录或项目' : 'Selected records or projects'}</SelectOption>
        <SelectOption value="workspace">{zh ? '整个工作区（包含所有记录）' : 'Entire workspace (all records)'}</SelectOption>
      </Select>
      {scope.mode === 'workspace' ? <p className="mt-1 text-xs text-warning">{zh ? '这会授权访问整个工作区，请确认符合此工具的用途。' : 'This grants workspace-wide access. Check that this matches the tool’s purpose.'}</p> : null}
      {scope.mode === 'selected' ? <>
        {section.kind === 'notes' || section.kind === 'tasks' ? <label className="mt-2 flex items-center gap-2 text-xs text-fg"><input type="checkbox" checked={scope.includeCreated}
          onChange={event => update({ ...scope, includeCreated: event.target.checked })} />{section.kind === 'notes' ? zh ? '包括此应用创建的笔记' : 'Include notes created by this app' : zh ? '包括此应用创建的任务' : 'Include tasks created by this app'}</label> : null}
        <ResourcePicker extensionId={extensionId} kind={section.kind} values={section.kind === 'projects' ? [...new Set([...scope.ids, ...scope.projectIds])] : scope.ids} onChange={ids => update({ ...scope, ids, ...(section.kind === 'projects' ? { projectIds: [] } : {}) })} zh={zh} />
        {section.kind !== 'projects' ? <><p className="mt-2 text-xs text-fg-muted">{zh ? '也可授权以下项目中的记录，包括以后加入项目的记录。' : 'You may also allow records in these projects, including future additions.'}</p>
        <ResourcePicker extensionId={extensionId} kind="projects" values={scope.projectIds} onChange={projectIds => update({ ...scope, projectIds })} zh={zh} /></> : null}
      </> : null}
    </fieldset>;
  })}</div>;
}

type AutomationOption = {
  id: string; title: string; configurationDigest: string; runnable: boolean;
  review: {
    action: { kind: string; instruction?: string; agentId?: string; model?: string; workingDirectory?: string;
      mcpSourceId?: string; timeoutSeconds?: number; taskId?: string; command?: { type: string } };
    safety?: { mode: string }; conversationMode: string;
    delivery: { notificationPolicy: string; destinations: Array<{ key: string; kind: string; endpoint?: string;
      conversationId?: string; pathTemplate?: string; targetId?: string; templateId?: string; channelId?: string }> };
    reliability?: { executionTimeoutSeconds?: number; retryCount?: number };
  };
};

function AutomationExecutionFields({ extensionId, value, onChange, zh }: {
  extensionId: string; value: LocalAppResourceScopes; onChange: (next: LocalAppResourceScopes) => void; zh: boolean;
}) {
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, LocalAppExecutionAuthority>>({});
  const url = `/api/extensions/${encodeURIComponent(extensionId)}/resource-options?kind=automations&search=${encodeURIComponent(search)}`;
  const { data, error, isLoading } = useSWR(url, path => fetchJson<{ items: AutomationOption[] }>(apiUrl(path)));
  const approvals = value.automationsRun.mode === 'selected' ? value.automationsRun.approvals : [];
  const setApprovals = (next: typeof approvals) => onChange({ ...value,
    automationsRun: next.length ? { mode: 'selected', approvals: next } : { mode: 'none' } });
  return <fieldset className="rounded-lg border border-edge p-3">
    <legend className="text-sm font-medium text-fg">{zh ? '允许执行的自动化' : 'Approved automation execution'}</legend>
    <p className="mb-2 text-xs text-warning">{zh
      ? '所选自动化可能使用 Agent 工具、修改文件或向外发送结果，并产生费用。请展开检查后再勾选。应用只能运行确认过的配置，每小时最多 20 次；配置变化需重新授权。授权到期或撤权后，受限运行会中止后续调用。'
      : 'These automations may use Agent tools, change files, send results externally and incur costs. Inspect each before approving. Up to 20 submissions per app per hour. Configuration changes require new approval. Expiry or revocation stops further calls in bounded runs.'}</p>
    <input aria-label={zh ? '搜索可执行自动化' : 'Search executable automations'} value={search}
      onChange={event => setSearch(event.target.value)} placeholder={zh ? '搜索自动化' : 'Search automations'}
      className="w-full rounded-md border border-edge bg-surface-panel px-2 py-1.5 text-xs text-fg" />
    {isLoading ? <Skeleton className="mt-2 h-16" /> : error ? <p role="alert" className="text-xs text-danger">{zh ? '无法加载自动化' : 'Could not load automations'}</p>
      : (data?.items ?? []).map(item => {
        const approved = approvals.some(approval => approval.id === item.id && approval.configurationDigest === item.configurationDigest
          && approval.authority.model && approval.authority.maxRuns > 0 && approval.authority.expiresAt > Date.now());
        const stale = !approved && approvals.some(approval => approval.id === item.id);
        const action = item.review.action;
        const authority = drafts[item.id] ?? approvals.find(approval => approval.id === item.id)?.authority ?? {
          model: false, tools: false, dataWrite: false, externalSend: false,
          expiresAt: Date.now() + 3600000, maxRuns: 1, maxCostMicrousd: 1000000,
        };
        const updateAuthority = (next: LocalAppExecutionAuthority) => {
          setDrafts(previous => ({ ...previous, [item.id]: next }));
          if (approved) setApprovals([...approvals.filter(approval => approval.id !== item.id),
            ...(next.model ? [{ id: item.id, configurationDigest: item.configurationDigest, authority: next }] : [])]);
        };
        return <details key={item.id} className="mt-2 rounded-md border border-edge p-2 text-xs text-fg">
          <summary className="cursor-pointer">{item.title}{stale ? zh ? '（配置已改变，需重新确认）' : ' (changed; review again)' : ''}</summary>
          <div className="mt-2 space-y-2 break-words">
            <p>{zh ? '执行方式' : 'Action'}: {action.kind === 'agent' ? 'Agent' : action.kind === 'task_command' ? zh ? '任务命令' : 'Task command' : action.kind}</p>
            {action.instruction ? <p className="whitespace-pre-wrap">{action.instruction}</p> : null}
            {action.agentId ? <p>Agent: {action.agentId}</p> : null}
            {action.model ? <p>{zh ? '模型' : 'Model'}: {action.model}</p> : null}
            {action.workingDirectory ? <p>{zh ? '工作目录' : 'Working directory'}: {action.workingDirectory}</p> : null}
            {action.mcpSourceId ? <p>MCP: {action.mcpSourceId}</p> : null}
            {action.taskId ? <><p>{zh ? '任务' : 'Task'}: {action.taskId}</p><pre className="whitespace-pre-wrap">{JSON.stringify(action.command, null, 2)}</pre></> : null}
            <p>{zh ? '执行策略' : 'Safety'}: {item.review.safety?.mode ?? 'auto_apply'} / {item.review.conversationMode}</p>
            <p>{zh ? '超时与重试' : 'Timeout / retries'}: {item.review.reliability?.executionTimeoutSeconds ?? action.timeoutSeconds ?? (zh ? '宿主默认' : 'Host default')} / {item.review.reliability?.retryCount ?? 0}</p>
            <p>{zh ? '结果投递' : 'Delivery'}: {item.review.delivery.destinations.map(destination =>
              [destination.kind, destination.endpoint ?? destination.conversationId ?? destination.pathTemplate ?? destination.channelId, destination.targetId ?? destination.templateId].filter(Boolean).join(': ')).join(', ') || (zh ? '无' : 'None')}</p>
            {(['model', 'tools', 'dataWrite', 'externalSend'] as const).map(key => <label key={key} className="flex items-start gap-2"><input type="checkbox" checked={authority[key]}
              onChange={event => updateAuthority({ ...authority, [key]: event.target.checked })} />{({
                model: zh ? '允许模型处理（上下文会发送给模型供应商）' : 'Allow model processing (context is disclosed to the provider)',
                tools: zh ? '允许本地文件读取工具' : 'Allow local file read tools',
                dataWrite: zh ? '允许本地文件写入（工具写入还需允许工具）' : 'Allow local file writes (tool writes also require tools)',
                externalSend: zh ? '允许向以上已审核目标投递结果' : 'Allow delivery to the reviewed external destinations',
              })[key]}</label>)}
            <p className="text-fg-muted">{zh ? '不开放 Shell、浏览器、MCP 或嵌套委托。预算按已知模型价格预留最坏情况费用，不代表供应商账单封顶；价格未知时拒绝执行。有效期结束或撤权会中止后续调用。' : 'Shell, browser, MCP and nested delegation are unavailable. Known model prices reserve worst-case usage; this is not a provider billing guarantee. Unknown pricing is denied. Expiry or revocation stops further calls.'}</p>
            <label className="block">{zh ? '有效时长（分钟）' : 'Valid for (minutes)'}<input type="number" min="1" max="43200" value={Math.max(0, Math.ceil((authority.expiresAt - Date.now()) / 60000))}
              onChange={event => updateAuthority({ ...authority, expiresAt: Date.now() + Number(event.target.value) * 60000 })} className="ml-2 w-24 rounded border border-edge bg-surface-panel p-1" /></label>
            <label className="block">{zh ? '本次授权最多运行次数' : 'Maximum runs for this approval'}<input type="number" min="1" max="100" value={authority.maxRuns}
              onChange={event => updateAuthority({ ...authority, maxRuns: Number(event.target.value) })} className="ml-2 w-24 rounded border border-edge bg-surface-panel p-1" /></label>
            <label className="block">{zh ? '模型预留预算（美元）' : 'Model reservation budget (USD)'}<input type="number" min="0" max="100" step="0.001" value={authority.maxCostMicrousd / 1000000}
              onChange={event => updateAuthority({ ...authority, maxCostMicrousd: Math.round(Number(event.target.value) * 1000000) })} className="ml-2 w-24 rounded border border-edge bg-surface-panel p-1" /></label>
            <label className="flex items-start gap-2"><input type="checkbox" disabled={!item.runnable || !authority.model || authority.expiresAt <= Date.now() || authority.maxRuns < 1} checked={approved}
              onChange={event => setApprovals([...approvals.filter(approval => approval.id !== item.id),
                ...(event.target.checked ? [{ id: item.id, configurationDigest: item.configurationDigest, authority }] : [])])} />
              {item.runnable ? zh ? '允许此应用运行以上配置' : 'Allow this app to run this configuration' : zh ? '此自动化当前不可授权执行' : 'This automation cannot currently be approved'}</label>
          </div>
        </details>;
      })}
    {approvals.length ? <button type="button" className="mt-2 text-xs text-accent" onClick={() => setApprovals([])}>{zh ? '清除所有执行授权' : 'Clear all execution approvals'} ({approvals.length})</button> : null}
  </fieldset>;
}

function ConnectorResourceFields({ extensionId, value, onChange, zh }: {
  extensionId: string; value: LocalAppResourceScopes; onChange: (next: LocalAppResourceScopes) => void; zh: boolean;
}) {
  type Binding = Extract<LocalAppResourceScopes['connectors'], { mode: 'selected' }>['bindings'][number];
  const url = `/api/extensions/${encodeURIComponent(extensionId)}/resource-options?kind=connectors`;
  const { data, error, isLoading } = useSWR(url, path => fetchJson<{ items: Array<{ id: string; title: string; binding: Binding }> }>(apiUrl(path)));
  const bindings = value.connectors.mode === 'selected' ? value.connectors.bindings : [];
  return <fieldset className="rounded-lg border border-edge p-3"><legend className="text-sm font-medium text-fg">{zh ? '外部服务与账户' : 'External services and accounts'}</legend>
    <p className="mb-2 text-xs text-fg-muted">{zh ? '仅允许以下账户和操作。读取受连接器现有策略约束；写入每次另行审核。重新连接或操作契约变化后需重新选择，可能产生外部服务费用。' : 'Only these accounts and actions. Reads retain existing connector policy; writes require a separate review each time. Reconnection or contract changes require a new selection. External service fees may apply.'}</p>
    {isLoading ? <Skeleton className="h-20" /> : error ? <p role="alert" className="text-xs text-danger">{zh ? '无法加载连接器' : 'Could not load connectors'}</p> : (data?.items ?? []).map(item => {
      const checked = bindings.some(binding => JSON.stringify(binding) === JSON.stringify(item.binding));
      return <label key={item.id} className="my-2 flex items-start gap-2 text-xs text-fg"><input type="checkbox" checked={checked} onChange={event => {
        const next = bindings.filter(binding => !(binding.toolRef === item.binding.toolRef && binding.accountId === item.binding.accountId));
        if (event.target.checked) next.push(item.binding);
        onChange({ ...value, connectors: next.length ? { mode: 'selected', bindings: next } : { mode: 'none' } });
      }} />{item.title}</label>;
    })}
    {bindings.length ? <button type="button" className="mt-2 text-xs text-accent" onClick={() => onChange({ ...value, connectors: { mode: 'none' } })}>{zh ? '清除连接器授权' : 'Clear connector approvals'} ({bindings.length})</button> : null}
  </fieldset>;
}
