export const DESKTOP_PET_ACTIONS = [
  'idle',
  'typing',
  'toolbox',
  'search',
  'file',
  'terminal',
  'browser',
  'success',
  'error',
] as const;

export type DesktopPetPackageAction = (typeof DESKTOP_PET_ACTIONS)[number];
