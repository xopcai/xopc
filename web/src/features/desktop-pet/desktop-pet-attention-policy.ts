import type { DesktopPetBehaviorMode } from '@/types/electron';

import {
  hasStaleSignal,
  isLongRunning,
} from './desktop-pet-display';
import type { DesktopPetActivity } from './desktop-pet-session-state';

export type DesktopPetAttention = 'ambient' | 'notice' | 'action_required';

export function desktopPetAttention(
  item: DesktopPetActivity,
  mode: DesktopPetBehaviorMode,
  now: number,
): DesktopPetAttention {
  if (item.state === 'waiting' || item.state === 'error') {
    return 'action_required';
  }
  if (item.state === 'success') {
    return mode === 'focus' ? 'ambient' : 'notice';
  }
  if (hasStaleSignal(item, now)) return 'notice';
  if (mode === 'playful') return 'notice';
  if (mode === 'companion' && isLongRunning(item, now)) return 'notice';
  return 'ambient';
}

export function shouldShowDesktopPetActivity(
  item: DesktopPetActivity,
  mode: DesktopPetBehaviorMode,
  now: number,
  remindersPausedUntil?: number,
): boolean {
  const attention = desktopPetAttention(item, mode, now);
  if (attention === 'action_required') return true;
  if (remindersPausedUntil && now < remindersPausedUntil) return false;
  return attention === 'notice';
}
