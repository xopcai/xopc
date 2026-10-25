import { Link } from 'react-router-dom';

export function CapabilitySectionIntro({ section, zh }: { section: string; zh: boolean }) {
  if (section !== 'agents') return null;
  return <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-1 pt-3 text-xs leading-5 sm:px-6 lg:px-8">
    <Link className="rounded text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent" to="/personal">{zh ? '与个人助手对话' : 'Chat with your personal assistant'}</Link>
  </div>;
}
