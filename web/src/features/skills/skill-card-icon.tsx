import { cn } from '@/lib/cn';

/** Pastel tile + saturated letter (light / dark pairs), stable per skill name hash. */
const SKILL_INITIAL_PALETTE: { light: string; dark: string }[] = [
  { light: 'bg-sky-100 text-sky-800', dark: 'dark:bg-sky-950/55 dark:text-sky-200' },
  { light: 'bg-violet-100 text-violet-800', dark: 'dark:bg-violet-950/55 dark:text-violet-200' },
  { light: 'bg-emerald-100 text-emerald-800', dark: 'dark:bg-emerald-950/55 dark:text-emerald-200' },
  { light: 'bg-orange-100 text-orange-800', dark: 'dark:bg-orange-950/55 dark:text-orange-200' },
  { light: 'bg-rose-100 text-rose-800', dark: 'dark:bg-rose-950/55 dark:text-rose-200' },
  { light: 'bg-amber-100 text-amber-900', dark: 'dark:bg-amber-950/55 dark:text-amber-200' },
  { light: 'bg-cyan-100 text-cyan-800', dark: 'dark:bg-cyan-950/55 dark:text-cyan-200' },
  { light: 'bg-indigo-100 text-indigo-800', dark: 'dark:bg-indigo-950/55 dark:text-indigo-200' },
  { light: 'bg-fuchsia-100 text-fuchsia-800', dark: 'dark:bg-fuchsia-950/55 dark:text-fuchsia-200' },
  { light: 'bg-teal-100 text-teal-800', dark: 'dark:bg-teal-950/55 dark:text-teal-200' },
];

function hashSkillNameKey(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** First letter or digit (Unicode letters included); skips leading punctuation in slugs. */
function skillInitialLetter(name: string): string {
  const t = name.trim();
  if (!t) return '?';
  const m = t.match(/[\p{L}\p{N}]/u);
  if (m) {
    const ch = m[0];
    return ch.toLocaleUpperCase('en-US');
  }
  return t[0];
}

export function SkillCardIcon({ name, className }: { name: string; className?: string }) {
  const initial = skillInitialLetter(name);
  const pair = SKILL_INITIAL_PALETTE[hashSkillNameKey(name) % SKILL_INITIAL_PALETTE.length];
  return (
    <div
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-xl font-semibold tracking-tight shadow-surface',
        'text-[1.05rem] ring-1 ring-inset ring-black/[0.06] dark:ring-white/[0.1]',
        'transition-[transform,box-shadow] duration-200 ease-out group-hover:ring-black/[0.1] dark:group-hover:ring-white/[0.14]',
        'group-hover:-translate-y-px',
        pair.light,
        pair.dark,
        className,
      )}
      aria-hidden
    >
      {initial}
    </div>
  );
}
