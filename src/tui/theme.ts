export {
  applyThemeById,
  getActiveThemeId,
  getBashExcludeBorderColor,
  getBashModeBorderColor,
  getCustomThemesDir,
  getDefaultEditorBorderColor,
  getThemeExports,
  getThinkingBorderColor,
  initTuiTheme,
  listAvailableThemeIds,
  resolveThemePalette,
  type ThemeExports,
  type ThemePalette,
} from './theme-manager.js';

import { getThemeExports } from './theme-manager.js';

export function getLightMode(): boolean {
  return getThemeExports().lightMode;
}

/** Mutable theme accessors — updated when `applyThemeById` runs. */
export const theme = new Proxy({} as ReturnType<typeof getThemeExports>['theme'], {
  get(_target, prop) {
    const value = getThemeExports().theme[prop as keyof ReturnType<typeof getThemeExports>['theme']];
    return typeof value === 'function' ? value.bind(getThemeExports().theme) : value;
  },
});

export const palette = new Proxy({} as ReturnType<typeof getThemeExports>['palette'], {
  get(_target, prop) {
    return getThemeExports().palette[prop as keyof ReturnType<typeof getThemeExports>['palette']];
  },
});

/** @deprecated Use `getLightMode()` — kept for existing imports. */
export const lightMode = getLightMode();

export const markdownTheme = new Proxy({} as ReturnType<typeof getThemeExports>['markdownTheme'], {
  get(_target, prop) {
    const exports = getThemeExports().markdownTheme;
    const value = exports[prop as keyof typeof exports];
    return typeof value === 'function' ? value.bind(exports) : value;
  },
});

export const selectListTheme = new Proxy({} as ReturnType<typeof getThemeExports>['selectListTheme'], {
  get(_target, prop) {
    const exports = getThemeExports().selectListTheme;
    const value = exports[prop as keyof typeof exports];
    return typeof value === 'function' ? value.bind(exports) : value;
  },
});

export const searchableSelectListTheme = new Proxy(
  {} as ReturnType<typeof getThemeExports>['searchableSelectListTheme'],
  {
    get(_target, prop) {
      const exports = getThemeExports().searchableSelectListTheme;
      const value = exports[prop as keyof typeof exports];
      return typeof value === 'function' ? value.bind(exports) : value;
    },
  },
);

export const editorTheme = new Proxy({} as ReturnType<typeof getThemeExports>['editorTheme'], {
  get(_target, prop) {
    const exports = getThemeExports().editorTheme;
    const value = exports[prop as keyof typeof exports];
    return typeof value === 'function' ? value.bind(exports) : value;
  },
});
