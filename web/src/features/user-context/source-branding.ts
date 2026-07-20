import type { PersonalContextSource } from './user-context-api';

const PERSONAL_CONTEXT_ICON_FILES: Readonly<Record<string, string>> = {
  'composio-gmail': 'gmail',
  'composio-googledrive': 'google-drive',
  'composio-notion': 'notion',
  'composio-slack': 'slack',
  memory: 'memory',
};

export function personalContextSourceBranding(
  source: Pick<PersonalContextSource, 'id' | 'branding'>,
): PersonalContextSource['branding'] {
  if (source.branding?.logoUrl) return source.branding;
  const fileName = PERSONAL_CONTEXT_ICON_FILES[source.id];
  if (!fileName) return source.branding;
  return { ...source.branding, logoUrl: `/connector-icons/${fileName}.svg` };
}
