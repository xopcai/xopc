import type { MessageBundle } from '@/i18n/messages';

import { initialForm, type FormState } from './automation-form';

export interface AutomationTemplate {
  name: string;
  description: string;
  source: string;
  requiresProject?: boolean;
  form: FormState;
}

export function automationScenarios(labels: MessageBundle['automations']): AutomationTemplate[] {
  return (['reminder', 'brief', 'review', 'followUp'] as const).map((id) => {
    const scene = labels.scenarios[id];
    return {
      ...scene,
      requiresProject: id === 'followUp',
      form: {
        ...initialForm,
        name: scene.name,
        instruction: id === 'reminder' ? '' : scene.instruction,
        triggerMode: id === 'reminder' ? 'once' : id === 'review' ? 'weekly' : 'daily',
        time: id === 'brief' ? '08:30' : id === 'review' ? '17:00' : '09:00',
        weekday: '5',
        notificationPolicy: 'all',
      },
    };
  });
}
