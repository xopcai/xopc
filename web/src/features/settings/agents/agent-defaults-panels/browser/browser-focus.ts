/** Query `?focus=` targets on `/settings/agent-browser` (scroll-into-view). */
export type BrowserSettingsFocusId =
  | 'connection'
  | 'extension'
  | 'local'
  | 'cloak'
  | 'cdp'
  | 'cloud'
  | 'runtime'
  | 'security';

export function browserFocusElementId(focus: BrowserSettingsFocusId): string {
  return `browser-focus-${focus}`;
}

export function parseBrowserSettingsFocus(raw: string | null): BrowserSettingsFocusId | null {
  switch (raw) {
    case 'connection':
    case 'extension':
    case 'local':
    case 'cloak':
    case 'cdp':
    case 'cloud':
    case 'runtime':
    case 'security':
      return raw;
    default:
      return null;
  }
}
