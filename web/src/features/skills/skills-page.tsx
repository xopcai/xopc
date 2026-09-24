import type { CapabilityHeaderActionChange } from '@/features/capabilities/capability-header-actions';
import { SkillsPageView } from '@/features/skills/skills-page-view';
import { useSkillsPage } from '@/features/skills/use-skills-page';

export function SkillsPage({ embedded = false, onHeaderActionChange }: { embedded?: boolean; onHeaderActionChange?: CapabilityHeaderActionChange }) {
  const vm = useSkillsPage();
  return <SkillsPageView vm={vm} embedded={embedded} onHeaderActionChange={onHeaderActionChange} />;
}
