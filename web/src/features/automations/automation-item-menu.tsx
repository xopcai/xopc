import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Copy, MoreHorizontal, Pause, Pencil, Play, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { automationApi, type Automation } from './automation-api';
import { isCompletedOneTimeTask } from './automation-display';

export function AutomationItemMenu({ automation, language, busy, onEdit, onAction }: {
  automation: Automation; language: 'zh' | 'en'; busy: boolean; onEdit: (automation: Automation) => void;
  onAction: (key: string, action: () => Promise<unknown>, title?: string) => Promise<boolean>;
}) {
  const zh = language === 'zh';
  const item = 'flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-fg outline-none data-[highlighted]:bg-surface-hover data-[disabled]:opacity-50';
  const management = automation.management;
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button variant="ghost" className="size-8 p-0" aria-label={zh ? `${automation.name}的更多操作` : `More actions for ${automation.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={4} className="z-70 min-w-44 rounded-xl border border-edge bg-surface-overlay p-1 shadow-popover">
    {(!management || management.editable.includes('enabled')) && !isCompletedOneTimeTask(automation) ? <DropdownMenu.Item className={item} disabled={busy} onSelect={() => void onAction(`automation:${automation.id}:toggle`, () => automation.enabled ? automationApi.pause(automation.id) : automationApi.resume(automation.id))}>{automation.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}{automation.enabled ? (zh ? '暂停' : 'Pause') : (zh ? '恢复' : 'Resume')}</DropdownMenu.Item> : null}
    {!management || management.runnable ? <DropdownMenu.Item className={item} disabled={busy} onSelect={() => void onAction(`automation:${automation.id}:run`, () => automationApi.runNow(automation.id))}><Play className="size-4" />{zh ? '立即运行' : 'Run now'}</DropdownMenu.Item> : null}
    {!management || management.editable.includes('trigger') ? <DropdownMenu.Item className={item} disabled={busy} onSelect={() => onEdit(automation)}><Pencil className="size-4" />{zh ? '编辑' : 'Edit'}</DropdownMenu.Item> : null}
    <DropdownMenu.Item className={item} onSelect={() => void onAction(`automation:${automation.id}:copy-link`, () => navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#/automations?automation=${encodeURIComponent(automation.id)}`), zh ? '任务链接已复制' : 'Task link copied')}><Copy className="size-4" />{zh ? '复制任务链接' : 'Copy task link'}</DropdownMenu.Item>
    {!management || management.deletable ? <><DropdownMenu.Separator className="my-1 h-px bg-edge-subtle" /><DropdownMenu.Item className={`${item} text-danger`} disabled={busy} onSelect={() => { if (window.confirm(zh ? '删除这个定时任务？已保存的对话仍可查看。' : 'Delete this scheduled task? Saved conversations will remain available.')) void onAction(`automation:${automation.id}:delete`, () => automationApi.remove(automation.id)); }}><Trash2 className="size-4" />{zh ? '删除' : 'Delete'}</DropdownMenu.Item></> : null}
  </DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}
