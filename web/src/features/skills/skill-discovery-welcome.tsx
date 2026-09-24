import { Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { SkillsCopy } from '@/features/skills/skill-catalog-structured-preview';

export function SkillDiscoveryWelcome({ sk, onPick, disabled }: {
  sk: SkillsCopy;
  onPick: (text: string) => void;
  disabled: boolean;
}) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-start gap-4 py-8 sm:py-12">
      <span className="inline-flex items-center gap-2 text-sm text-accent-fg">
        <Sparkles className="size-4" aria-hidden />{sk.findCapability}
      </span>
      <h1 className="text-xl font-semibold text-fg">{sk.findWelcome}</h1>
      <p className="text-sm leading-relaxed text-fg-muted">{sk.findDescription}</p>
      <div className="flex flex-wrap gap-2">
        {sk.findExamples.map((text) => (
          <Button key={text} disabled={disabled} onClick={() => onPick(text)}>{text}</Button>
        ))}
      </div>
      <Link to="/capabilities/skills" className="text-sm text-accent-fg hover:underline">{sk.findBack}</Link>
    </section>
  );
}
