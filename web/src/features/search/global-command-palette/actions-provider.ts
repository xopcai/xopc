import type { GlobalHit } from '@/features/search/global-command-palette/types';
import type { NavigateFunction } from 'react-router-dom';

export function buildAutomationActionHits(
  language: 'en' | 'zh',
  navigate: NavigateFunction,
  closePalette: () => void,
): Array<Omit<GlobalHit, 'rank'>> {
  const isZh = language === 'zh';

  return [
    {
      kind: 'action',
      id: 'action:cron:create',
      title: isZh ? '创建定时任务' : 'Create scheduled task',
      subtitle: isZh ? '新建 Cron 任务' : 'Open scheduled tasks (create)',
      groupLabel: 'Actions',
      keywords: ['cron', 'schedule', 'job', 'timer'],
      run: () => {
        closePalette();
        navigate('/cron?action=create');
      },
    },
    {
      kind: 'action',
      id: 'action:cron:manage',
      title: isZh ? '管理定时任务' : 'Manage scheduled tasks',
      subtitle: isZh ? '查看和编辑 Cron' : 'View and edit cron jobs',
      groupLabel: 'Actions',
      keywords: ['cron', 'schedule', 'tasks'],
      run: () => {
        closePalette();
        navigate('/cron');
      },
    },
    {
      kind: 'action',
      id: 'action:skills:manage',
      title: isZh ? '管理技能' : 'Manage skills',
      subtitle: isZh ? '启用或禁用技能' : 'View, enable, or disable skills',
      groupLabel: 'Actions',
      keywords: ['skills', 'skill', 'catalog'],
      run: () => {
        closePalette();
        navigate('/skills');
      },
    },
    {
      kind: 'action',
      id: 'action:skills:reload',
      title: isZh ? '重新加载技能' : 'Reload skills',
      subtitle: isZh ? '从磁盘重新加载' : 'Reload all skills from disk',
      groupLabel: 'Actions',
      keywords: ['skills', 'reload', 'refresh'],
      run: () => {
        closePalette();
        void import('@/features/skills/skill-api').then(({ reloadSkills }) => reloadSkills());
      },
    },
  ];
}
