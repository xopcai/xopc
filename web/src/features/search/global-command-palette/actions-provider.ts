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
      id: 'action:automation:create',
      title: 'Create automation',
      subtitle: 'Open automations to create a trigger and action',
      groupLabel,
      keywords: ['automation', 'schedule', 'trigger', 'action', 'timer'],
      run: () => {
        closePalette();
        navigate('/automations?action=create');
      },
    },
    {
      kind: 'action',
      id: 'action:automation:manage',
      title: 'Manage automations',
      subtitle: 'View automations and run history',
      groupLabel,
      keywords: ['automation', 'schedule', 'tasks', 'runs'],
      run: () => {
        closePalette();
        navigate('/automations');
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
        void import('@/features/skills/skill-reload-api').then(({ reloadSkills }) => reloadSkills());
      },
    },
  ];
}
