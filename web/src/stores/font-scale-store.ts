import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type FontScalePreference = 'compact' | 'default' | 'large';

const VALID: readonly FontScalePreference[] = ['compact', 'default', 'large'];

function applyDomFontScale(pref: FontScalePreference) {
  document.documentElement.dataset.fontScale = pref;
}

/** Sync DOM from localStorage before React paint (zustand persist hydrates async). */
export function bootstrapFontScale() {
  try {
    const raw = localStorage.getItem('xopcbot-web-font-scale');
    let pref: FontScalePreference = 'default';
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { preference?: FontScalePreference } };
      const p = parsed.state?.preference;
      if (p && (VALID as readonly string[]).includes(p)) pref = p;
    }
    applyDomFontScale(pref);
  } catch {
    applyDomFontScale('default');
  }
}

type FontScaleState = {
  preference: FontScalePreference;
  setPreference: (p: FontScalePreference) => void;
};

export const useFontScaleStore = create(
  persist<FontScaleState>(
    (set) => ({
      preference: 'default',

      setPreference: (preference) => {
        applyDomFontScale(preference);
        set({ preference });
      },
    }),
    {
      name: 'xopcbot-web-font-scale',
    },
  ),
);

export function syncFontScaleAfterHydration() {
  applyDomFontScale(useFontScaleStore.getState().preference);
}
