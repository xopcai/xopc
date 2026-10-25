import { Link } from 'react-router-dom';
export function ServiceGoalGuide({ zh }: { zh: boolean }) {
  return <details className="mx-4 mb-3 rounded-lg border border-edge p-3 text-sm sm:mx-6 lg:mx-8">
    <summary className="cursor-pointer font-medium text-fg">{zh ? '同一个服务，该从哪里连接？' : 'Where should I connect a service?'}</summary>
    <p className="mt-2 text-fg-muted">{zh ? '例如飞书 / Lark：按要做的事选择入口。插件安装、资料账号授权和消息通道连通分别检查，互不代表已就绪。' : 'For services such as Feishu / Lark, choose by your goal. Plugin installation, data authorization and messaging connectivity are separate states.'}</p>
    <ul className="mt-2 space-y-2"><li><Link className="text-accent" to="/capabilities/connectors">{zh ? '读取或整理服务中的资料 → 账号连接' : 'Read or organize service data → Account connections'}</Link></li><li><Link className="text-accent" to="/capabilities/channels">{zh ? '从服务接收并回复消息 → 消息通道' : 'Receive and reply to messages → Messaging channels'}</Link></li><li><Link className="text-accent" to="/capabilities/extensions?tab=marketplace">{zh ? '安装服务提供的一整套能力 → 插件' : 'Install a package of service capabilities → Plugins'}</Link></li></ul>
  </details>;
}
