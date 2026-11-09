import type { Automation } from './automation-api';

export function isSystemManagedAutomation(automation: Automation): boolean {
  return automation.management !== undefined && automation.management.owner !== 'observation';
}
