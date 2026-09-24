import { Loader2, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { SkillsCopy } from '@/features/skills/skill-catalog-structured-preview';

export function FindSkillsButton({ sk, findingSkills, onFindSkills, secondary = false, compactOnMobile = false }: {
  sk: SkillsCopy;
  findingSkills: boolean;
  onFindSkills: () => Promise<void>;
  secondary?: boolean;
  compactOnMobile?: boolean;
}) {
  const Icon = findingSkills ? Loader2 : Sparkles;
  return (
    <Button variant={secondary ? 'secondary' : 'primary'} className="shrink-0"
      title={sk.findHint} disabled={findingSkills} aria-busy={findingSkills}
      onClick={() => void onFindSkills()}>
      <Icon className={findingSkills ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
      <span className={compactOnMobile ? 'hidden sm:inline' : undefined}>{sk.findCta}</span>
    </Button>
  );
}
