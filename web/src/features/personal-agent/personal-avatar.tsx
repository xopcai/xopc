import { Loopi, type LoopiMood } from '@/components/brand/loopi';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';

import './personal-avatar.css';

export type PersonalAppearance = 'loopi' | 'loopi-curious' | 'loopi-care' | 'custom';

const MOODS: Record<Exclude<PersonalAppearance, 'custom'>, LoopiMood> = {
  loopi: 'idle',
  'loopi-curious': 'curious',
  'loopi-care': 'care',
};

export type PersonalAvatarActivity = 'idle' | 'working' | 'waiting' | 'delivered';
const ACTIVITY_MOODS: Partial<Record<PersonalAvatarActivity, LoopiMood>> = {
  working: 'work',
  waiting: 'decision',
  delivered: 'done',
};

export function PersonalAvatar({ appearance, agentId, activity = 'idle', lively = false, className = '' }: {
  appearance: PersonalAppearance;
  agentId?: string;
  activity?: PersonalAvatarActivity;
  lively?: boolean;
  className?: string;
}) {
  if (appearance === 'custom' && agentId) {
    if (!lively) return <AgentAvatarDisplay agentId={agentId} avatar="xopc:custom" className={className} />;
    return <span data-activity={activity} data-lively="true" className={`personal-avatar-motion inline-flex items-center justify-center ${className}`}>
      <AgentAvatarDisplay agentId={agentId} avatar="xopc:custom" className="size-full" />
    </span>;
  }

  const mood = ACTIVITY_MOODS[activity] ?? (appearance === 'custom' ? 'idle' : MOODS[appearance]);
  return <span data-activity={activity} data-lively={lively ? 'true' : undefined} className={`personal-avatar-motion inline-flex items-center justify-center ${className}`} aria-hidden="true">
    <Loopi variant="avatar" mood={mood} ambient={lively} className="size-full" />
  </span>;
}
