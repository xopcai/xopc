import { Loopi, type LoopiMood } from '@/components/brand/loopi';
import { AgentAvatarDisplay } from '@/features/settings/agents/agent-avatar-display';

import './personal-avatar.css';

export type PersonalAppearance = 'loopi' | 'loopi-curious' | 'loopi-care' | 'custom';

const MOODS: Record<Exclude<PersonalAppearance, 'custom'>, LoopiMood> = {
  loopi: 'idle',
  'loopi-curious': 'curious',
  'loopi-care': 'care',
};

export function PersonalAvatar({ appearance, agentId, className = '' }: {
  appearance: PersonalAppearance;
  agentId?: string;
  className?: string;
}) {
  if (appearance === 'custom' && agentId) {
    return <AgentAvatarDisplay agentId={agentId} avatar="xopc:custom" className={className} />;
  }

  const mood = appearance === 'custom' ? 'idle' : MOODS[appearance];
  return <span className={`personal-avatar-motion inline-flex items-center justify-center ${className}`} aria-hidden="true">
    <Loopi variant="avatar" mood={mood} className="size-full" />
  </span>;
}
