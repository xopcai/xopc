import { Link } from 'react-router-dom';
import { useLocaleStore } from '@/stores/locale-store';

/** Deep links always explain the limitation and have a history-independent exit. */
export function ResourceUnavailable({ kind, missing = true, backTo, retry }: {
  kind: 'project' | 'app' | 'plugin' | 'plugin-page' | 'plugin-settings' | 'desktop'; missing?: boolean; backTo: string; retry?: () => void;
}) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const names = zh ? { project: '项目', app: '应用', plugin: '插件', 'plugin-page': '插件页面', 'plugin-settings': '插件设置', desktop: '桌面功能' }
    : { project: 'Project', app: 'App', plugin: 'Plugin', 'plugin-page': 'Plugin page', 'plugin-settings': 'Plugin settings', desktop: 'Desktop feature' };
  const title = kind === 'desktop' ? (zh ? '此功能需要 xopc 桌面版' : 'This feature requires xopc desktop')
    : kind === 'plugin-page' || kind === 'plugin-settings' ? (zh ? `此插件未提供${kind === 'plugin-page' ? '独立页面' : '设置页面'}` : `This plugin does not provide a ${kind === 'plugin-page' ? 'standalone page' : 'settings page'}`)
    : missing ? (zh ? `找不到${names[kind]}` : `${names[kind]} not found`) : (zh ? `暂时无法加载${names[kind]}` : `Unable to load ${names[kind].toLowerCase()}`);
  return <section className="mx-auto my-8 w-full max-w-xl space-y-3 rounded-xl border border-edge bg-surface-panel p-6" role="status">
    <h2 className="text-base font-semibold text-fg">{title}</h2>
    <p className="text-sm leading-6 text-fg-muted">{kind === 'desktop' ? (zh ? '当前浏览器或桌面连接不支持此功能。请在桌面版中打开；其他 Web 功能仍可使用。' : 'This browser or desktop bridge cannot provide this feature. Open it in the desktop app. Other web features remain available.') : (zh ? '请返回列表确认可用内容；若是连接异常，可稍后重试。' : 'Return to the list to check available items, or retry after a connection issue.')}</p>
    <div className="flex gap-4 text-sm"><Link className="text-accent hover:underline" to={backTo}>{backTo === '/' ? (zh ? '返回工作台' : 'Back to work') : backTo.startsWith('/settings/') ? (zh ? '返回设置' : 'Back to settings') : (zh ? '返回列表' : 'Back to list')}</Link>{retry ? <button className="text-accent hover:underline" onClick={retry}>{zh ? '重试' : 'Retry'}</button> : null}</div>
  </section>;
}
