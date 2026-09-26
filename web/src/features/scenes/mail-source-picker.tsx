import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';

import { sceneErrorText, sceneGet, sceneWrite } from './api';

type MailSource = { id: string; accountId: string; subject: string; sender: string };

export function MailSourcePicker({ value, disabled, zh, onChange }: { value: string; disabled: boolean; zh: boolean; onChange: (source: MailSource) => void }) {
  const accounts = useSWR<{ accounts: Array<{ id: string; label: string }> }>('/sources/mail/accounts', sceneGet);
  const [account, setAccount] = useState('');
  const [query, setQuery] = useState('');
  const [sources, setSources] = useState<MailSource[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<unknown>();
  const accountId = account || accounts.data?.accounts[0]?.id || '';
  async function search() {
    setBusy(true); setError(undefined); setSources([]); setSearched(true);
    onChange({ id: '', accountId: '', subject: '', sender: '' });
    try {
      const response = await sceneWrite<{ sources: MailSource[] }>('/sources/mail/search', 'POST', { accountId, query });
      setSources(response.sources);
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  }
  if (accounts.error) return <div role="alert" className="space-y-2 text-sm text-danger"><p>{sceneErrorText(accounts.error, zh)}</p><Button onClick={() => void accounts.mutate()}>{zh ? '重新加载' : 'Reload'}</Button></div>;
  if (!accounts.data) return <Skeleton className="h-24 w-full" />;
  const label = (source: MailSource) => `${source.subject || (zh ? '无主题邮件' : 'Untitled mail')} · ${source.sender || source.accountId}`;
  return <div className="space-y-3">
    <p className="text-sm text-fg-muted">{zh ? '搜索会读取所选 Gmail 账号的匹配邮件；开启后只持续跟进选定线程，不发送邮件，也不需要开启后台学习。' : 'Search reads matching mail in your selected Gmail account. The monitor follows only the selected thread, never sends mail, and requires no background learning.'}</p>
    <PopoverSelect value={accountId} disabled={disabled || busy} ariaLabel={zh ? '邮箱账号' : 'Mail account'} placeholder={zh ? '选择账号' : 'Choose account'} allowEmpty={false}
      options={accounts.data.accounts.map(item => ({ value: item.id, label: item.label }))} onChange={id => { setAccount(id); setSources([]); onChange({ id: '', accountId: '', subject: '', sender: '' }); }} />
    <label className="grid gap-2 text-sm">{zh ? '主题、发件人或 Gmail 搜索条件' : 'Subject, sender, or Gmail query'}<input value={query} maxLength={500} disabled={disabled || busy} onChange={e => setQuery(e.target.value)} className="rounded-md border border-edge bg-surface-panel px-3 py-2" placeholder={zh ? '例如 from:alice@example.com' : 'e.g. from:alice@example.com'} /></label>
    <Button type="button" disabled={disabled || busy || !accountId || !query.trim()} onClick={() => void search()}>{busy ? (zh ? '正在搜索…' : 'Searching…') : (zh ? '搜索邮件' : 'Search mail')}</Button>
    <PopoverSelect value={value} disabled={disabled || busy} ariaLabel={zh ? '要跟进的邮件' : 'Mail to follow'} placeholder={zh ? '选择邮件线程' : 'Choose a thread'} allowEmpty={false} options={sources.map(source => ({ value: source.id, label: label(source) }))}
      onChange={id => { const source = sources.find(entry => entry.id === id); if (source) onChange(source); }} />
    {!accounts.data.accounts.length && <p className="text-sm text-fg-muted">{zh ? '请连接 Gmail，并允许读取及后台检查；要求每次确认或仅限指定 Agent 的账号暂不支持。' : 'Connect Gmail and allow background reads. Accounts requiring confirmation for every read or restricted to specific agents are not supported yet.'} <Link className="text-accent underline" to="/capabilities/connectors">{zh ? '管理连接' : 'Manage connections'}</Link></p>}
    {searched && !busy && !error && !sources.length && <p role="status" className="text-sm text-fg-muted">{zh ? '没有找到匹配线程，请调整搜索条件。' : 'No matching threads. Try a different query.'}</p>}
    {error != null && <p role="alert" className="text-danger">{sceneErrorText(error, zh)}</p>}
  </div>;
}
