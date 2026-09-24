import type { ReactNode } from 'react';

import { SkillsPageView } from '@/features/skills/skills-page-view';
import { useSkillsPage } from '@/features/skills/use-skills-page';

export function SkillsPage({ embedded = false, onHeaderEndChange }: { embedded?: boolean; onHeaderEndChange?: (node: ReactNode | null) => void }) {
  const vm = useSkillsPage();
  return <SkillsPageView vm={vm} embedded={embedded} onHeaderEndChange={onHeaderEndChange} />;
}
