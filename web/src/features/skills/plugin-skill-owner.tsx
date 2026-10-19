import { Link, useLocation } from 'react-router-dom';

import { pluginDetailPath } from '@/features/capabilities/capability-links';
import type { SkillCatalogEntry } from './skill.types';
import { useLocaleStore } from '@/stores/locale-store';

export function pluginSkillUnavailable(skill: SkillCatalogEntry) {
  return Boolean(skill.plugin && (!skill.plugin.active || skill.plugin.authorizationStatus === 'required'));
}

export function PluginSkillOwner({ skill, detail = false }: { skill: SkillCatalogEntry; detail?: boolean }) {
  const location = useLocation();
  const zh = useLocaleStore(state => state.language).startsWith('zh');
  const id = skill.plugin?.id ?? (skill.origin.startsWith('plugin:') ? skill.origin.slice(7) : null);
  if (!id) return null;
  const needsAuth = skill.plugin?.authorizationStatus === 'required';
  return <div className={detail ? 'mb-4 rounded-xl border border-edge p-3 text-sm' : 'mt-3 border-t border-edge-subtle pt-3 text-xs'}>
    {detail ? <p className="mb-2 text-fg-muted">{zh ? '此技能随插件安装，由插件统一更新和卸载。可在 Agent 设置中调整使用范围。' : 'Installed with its plugin. Update or uninstall the plugin to manage this skill. Adjust availability in Agent settings.'}</p> : null}
    <Link to={pluginDetailPath(id, 'skills', needsAuth, location.pathname + location.search)} className="inline-flex min-h-8 items-center gap-2 rounded-md text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
      {zh ? '来自插件：' : 'From plugin: '}{skill.plugin?.title ?? skill.plugin?.name ?? id}
      <span className="text-fg-muted">· {needsAuth ? (zh ? '需要授权' : 'Authorization required') : skill.plugin?.active === false ? (zh ? '插件未就绪' : 'Plugin not ready') : (zh ? '管理插件' : 'Manage plugin')}</span>
    </Link>
  </div>;
}
