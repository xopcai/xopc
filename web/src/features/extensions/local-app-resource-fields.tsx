import type { LocalAppResourceScope, LocalAppResourceScopes } from '@xopcai/gateway-contract';
import { useState } from 'react';
import useSWR from 'swr';

import { Select, SelectOption, SelectOptionList } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

function ResourcePicker({ extensionId, kind, values, onChange, zh }: {
  extensionId: string; kind: 'notes' | 'tasks' | 'projects' | 'files'; values: string[]; onChange: (ids: string[]) => void; zh: boolean;
}) {
  const [search, setSearch] = useState('');
  const url = `/api/extensions/${encodeURIComponent(extensionId)}/resource-options?kind=${kind}&search=${encodeURIComponent(search)}`;
  const { data, error, isLoading } = useSWR(url, path => fetchJson<{ items: Array<{ id: string; title: string }> }>(apiUrl(path)));
  const label = kind === 'notes' ? zh ? '笔记' : 'Notes' : kind === 'tasks' ? zh ? '任务' : 'Tasks'
    : kind === 'files' ? zh ? '文件' : 'Files' : zh ? '项目' : 'Projects';
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
  const sections: Array<{ key: 'notesRead' | 'notesWrite' | 'tasksRead' | 'tasksWrite' | 'projectsRead' | 'projectsWrite'; label: string; kind: 'notes' | 'tasks' | 'projects'; visible: boolean }> = [
    { key: 'notesRead', label: zh ? '读取笔记的范围' : 'Notes this app may read', kind: 'notes', visible: permissions.some(p => /capability:xopc.notes.(get|list)$/.test(p)) },
    { key: 'notesWrite', label: zh ? '修改与创建笔记的范围' : 'Notes this app may change or create', kind: 'notes', visible: permissions.some(p => /capability:xopc.notes.(create|update|append)$/.test(p)) },
    { key: 'tasksRead', label: zh ? '读取任务的范围' : 'Tasks this app may read', kind: 'tasks', visible: permissions.some(p => /capability:xopc.tasks.(get|list)$/.test(p)) },
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

    {permissions.includes('capability:xopc.agent.delegate') ? <fieldset className="rounded-lg border border-edge p-3">
      <legend className="text-sm font-medium text-fg">{zh ? '受限 Agent 委托' : 'Restricted Agent delegation'}</legend>
      <label className="flex items-start gap-2 text-sm text-fg"><input type="checkbox" checked={value.agentDelegate}
        onChange={event => onChange({ ...value, agentDelegate: event.target.checked })} />
        {zh ? '允许发送应用指令、上下文和授权引用到已配置的模型' : 'Allow sending app instructions, context and approved references to the configured model'}</label>
      <p className="mt-2 text-xs text-fg-muted">{zh ? '可能产生模型费用。每应用每小时最多 20 次，每次最多 30 秒、1024 输出 token。无聊天历史、记忆、文件、工具或自动写入权限。预览不运行真实委托。' : 'May incur model costs. Up to 20 calls per app per hour, 30 seconds and 1024 output tokens per call. No chat history, memory, files, tools or automatic writes. Unavailable in previews.'}</p>
    </fieldset> : null}
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
