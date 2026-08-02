export const DESKTOP_PET_SCHEMA_VERSION = 2 as const;

export const DESKTOP_PET_ACTIONS = [
  'idle',
  'sleep',
  'wake',
  'greet',
  'prepare',
  'research',
  'read',
  'create',
  'execute',
  'wait',
  'success',
  'concern',
  'pet',
  'pickedUp',
  'released',
] as const;

export type DesktopPetPackageAction = (typeof DESKTOP_PET_ACTIONS)[number];
