/** Only an explicit internal route should change the main window's location. */
export function resolveDesktopPetMainWindowPath(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') ? value : undefined;
}
