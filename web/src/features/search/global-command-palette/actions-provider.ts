import type { GlobalHit } from '@/features/search/global-command-palette/types';
import { messages } from '@/i18n/messages';
import type { StoredLanguage } from '@/lib/storage';
import type { NavigateFunction } from 'react-router-dom';

export function buildAutomationActionHits(
  language: StoredLanguage,
  navigate: NavigateFunction,
  closePalette: () => void,
): Array<Omit<GlobalHit, 'rank'>> {
  const m = messages(language);
  const a = m.commandPalette.actions;
  const groupLabel = m.commandPalette.groups.actions;

  return [
    {
      kind: 'action',
      id: 'action:cron:create',
      title: a.createCron,
      subtitle: a.createCronSubtitle,
      groupLabel,
      keywords: ['cron', 'schedule', 'job', 'timer'],
      run: () => {
        closePalette();
        navigate('/cron?action=create');
      },
    },
    {
      kind: 'action',
      id: 'action:cron:manage',
      title: a.manageCron,
      subtitle: a.manageCronSubtitle,
      groupLabel,
      keywords: ['cron', 'schedule', 'tasks'],
      run: () => {
        closePalette();
        navigate('/cron');
      },
    },
    {
      kind: 'action',
      id: 'action:skills:manage',
      title: a.manageSkills,
      subtitle: a.manageSkillsSubtitle,
      groupLabel,
      keywords: ['skills', 'skill', 'catalog'],
      run: () => {
        closePalette();
        navigate('/skills');
      },
    },
    {
      kind: 'action',
      id: 'action:skills:reload',
      title: a.reloadSkills,
      subtitle: a.reloadSkillsSubtitle,
      groupLabel,
      keywords: ['skills', 'reload', 'refresh'],
      run: () => {
        closePalette();
        void import('@/features/skills/skill-api').then(({ reloadSkills }) => reloadSkills());
      },
    },
  ];
}
