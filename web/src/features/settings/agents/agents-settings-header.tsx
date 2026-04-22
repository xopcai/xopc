import type { AgentsSettingsMessages } from '@/i18n/messages';

export function AgentsSettingsHeader(props: { a: AgentsSettingsMessages }) {
  const { a } = props;

  return (
    <header className="flex flex-col gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg">{a.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">{a.subtitle}</p>
      </div>
    </header>
  );
}
