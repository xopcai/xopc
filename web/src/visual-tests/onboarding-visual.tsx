import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

import { OnboardingCard } from '@/features/onboarding/onboarding-card';
import { WorkDiscoveryPage } from '@/features/work-discovery/work-discovery-page';
import { useLocaleStore } from '@/stores/locale-store';
import type { ColorScheme } from '@/stores/theme-store';

import '@fontsource-variable/figtree';
import '@/styles/globals.css';

type VisualStage = 'setup' | 'work';
type VisualMode = 'light' | 'dark';

const params = new URLSearchParams(window.location.search);
const stage: VisualStage = params.get('stage') === 'work' ? 'work' : 'setup';
const mode: VisualMode = params.get('mode') === 'dark' ? 'dark' : 'light';
const requestedTheme = params.get('theme');
const theme: ColorScheme = requestedTheme === 'emerald' || requestedTheme === 'clay' || requestedTheme === 'dawn' || requestedTheme === 'porcelain'
  ? requestedTheme
  : 'default';

document.documentElement.classList.toggle('dark', mode === 'dark');
document.documentElement.dataset.theme = mode;
document.documentElement.dataset.colorScheme = theme;
document.documentElement.style.colorScheme = mode;
useLocaleStore.setState({ language: 'en' });

const json = (value: unknown) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

window.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/user-model')) {
    return json({
      profile: { callName: 'Alex', role: '', pronouns: '', timezone: '', locale: 'en-US' },
      assertions: [],
      goals: [],
      priorities: [],
      rules: [],
      knowledge: [],
      maintenance: { lastRun: null },
      counts: {
        activeAssertions: 0,
        reviewAssertions: 0,
        activeGoals: 0,
        activePriorities: 0,
        activeKnowledge: 0,
      },
    });
  }
  if (url.includes('/api/onboarding/work-discovery')) {
    return json({ enabled: true, state: { status: 'not_started' } });
  }
  throw new Error(`Unexpected visual fixture request: ${url}`);
};

function VisualFixture() {
  return (
    <div className="h-dvh w-dvw overflow-hidden" data-visual-stage={stage}>
      {stage === 'setup' ? (
        <OnboardingCard onComplete={() => {}} onDismiss={() => {}} />
      ) : (
        <WorkDiscoveryPage embedded onRequestClose={() => {}} onNavigateAway={() => {}} />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={['/onboarding/workspace?new=1']}>
    <VisualFixture />
  </MemoryRouter>,
);
