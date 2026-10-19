import { Link } from 'react-router-dom';

export function CapabilitySectionIntro({ section, zh }: { section: string; zh: boolean }) {
  const content = section === 'skills' ? {
    text: zh ? '查看 Agent 可使用的技能。插件附带的技能由所属插件统一更新和卸载。' : 'Browse skills available to agents. Skills included in a plugin are updated and removed with that plugin.',
    href: '/capabilities/extensions?tab=user', label: zh ? '管理插件' : 'Manage plugins',
  } : section === 'connectors' ? {
    text: zh ? '管理账号连接与授权。插件提供的账号统一在插件详情中连接。' : 'Manage accounts and authorization. Connect plugin accounts from their plugin details.',
    href: '/capabilities/extensions?tab=marketplace', label: zh ? '发现更多插件' : 'Discover plugins',
  } : section === 'extensions' ? {
    text: zh ? '安装和管理整套能力，包括技能、工具与账号连接。默认供所有 Agent 使用。' : 'Install and manage skills, tools and account connections together. Available to all agents by default.',
    href: '/capabilities/connectors?tab=connected', label: zh ? '查看账号连接' : 'View connections',
  } : null;
  if (!content) return null;
  return <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 pt-3 text-xs leading-5 sm:px-6 lg:px-8">
    <p className="text-fg-muted">{content.text}</p>
    <Link className="rounded text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" to={content.href}>{content.label}</Link>
  </div>;
}
