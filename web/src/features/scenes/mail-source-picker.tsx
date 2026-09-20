import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { PopoverSelect } from '@/components/ui/popover-select';
import { Skeleton } from '@/components/ui/skeleton';

import { sceneErrorText, sceneGet } from './api';

type MailSource = { id: string; accountId: string; subject: string; sender: string };

export function MailSourcePicker({ value, disabled, zh, onChange }: { value: string; disabled: boolean; zh: boolean; onChange: (source: MailSource) => void }) {
  const [afterId, setAfterId] = useState('');
  const [selected, setSelected] = useState<MailSource>();
  const sources = useSWR<{ sources: MailSource[]; nextCursor: string | null }>(`/sources/mail?limit=50&afterId=${encodeURIComponent(afterId)}`, sceneGet);
  if (sources.error) return <div role="alert" className="space-y-2 text-sm text-danger"><p>{sceneErrorText(sources.error, zh)}</p><Button onClick={() => void sources.mutate()}>{zh ? '重新加载' : 'Reload'}</Button></div>;
  if (!sources.data) return <Skeleton className="h-24 w-full" />;
  const entries = selected && !sources.data.sources.some((item) => item.id === selected.id) ? [selected, ...sources.data.sources] : sources.data.sources;
  const label = (source: MailSource) => `${source.subject || (zh ? '无主题邮件' : 'Untitled mail')} · ${source.sender || source.accountId}`;
  return <div className="space-y-3"><p className="text-sm text-fg-muted">{zh ? '选择已连接账号中的一封邮件，只授权跟进它所在的邮件线程。' : 'Choose a message from your connected accounts. Only its thread is authorized.'}</p>
    <PopoverSelect value={value} disabled={disabled} ariaLabel={zh ? '要跟进的邮件' : 'Mail to follow'} placeholder={zh ? '选择邮件' : 'Choose mail'} allowEmpty={false} options={entries.map((source) => ({ value: source.id, label: label(source) }))}
      onChange={(id) => { const source = entries.find((entry) => entry.id === id); if (source) { setSelected(source); onChange(source); } }} />
    {!sources.data.sources.length && <p className="text-sm text-fg-muted">{zh ? '暂无可选邮件，请先连接账号并同步邮件。' : 'No mail available. Connect an account and sync messages first.'} <Link className="text-accent underline" to="/connectors">{zh ? '管理连接' : 'Manage connections'}</Link></p>}
    <div className="flex gap-2">{afterId && <Button type="button" disabled={disabled} onClick={() => setAfterId('')}>{zh ? '返回第一页' : 'First page'}</Button>}{sources.data.nextCursor && <Button type="button" disabled={disabled} onClick={() => setAfterId(sources.data!.nextCursor!)}>{zh ? '更多邮件' : 'More mail'}</Button>}</div>
  </div>;
}
