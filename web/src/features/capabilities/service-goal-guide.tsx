import { Link } from 'react-router-dom';
export function ServiceGoalGuide({ zh }: { zh: boolean }) {
  return <details className="mx-4 mb-3 text-xs text-fg-muted sm:mx-6 lg:mx-8">
    <summary className="w-fit cursor-pointer rounded focus-visible:outline-accent">{zh ? '按用途连接' : 'Connect by purpose'}</summary>
    <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-2"><li><Link className="text-accent-fg hover:underline" to="/capabilities/connectors">{zh ? '连接资料与账号' : 'Connect data and accounts'}</Link></li><li><Link className="text-accent-fg hover:underline" to="/capabilities/channels">{zh ? '收发消息' : 'Send and receive messages'}</Link></li><li><Link className="text-accent-fg hover:underline" to="/capabilities/extensions?tab=marketplace">{zh ? '添加插件' : 'Add plugins'}</Link></li></ul>
  </details>;
}
