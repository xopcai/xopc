import { SkillsPageView } from '@/features/skills/skills-page-view';
import { useSkillsPage } from '@/features/skills/use-skills-page';

export function SkillsPage() {
  const vm = useSkillsPage();
  return <SkillsPageView vm={vm} />;
}
