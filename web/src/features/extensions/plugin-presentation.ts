import type { ExtensionApiRow } from './types';

export function pluginDisplayName(extension: ExtensionApiRow, zh: boolean) {
  return extension.localizations?.[zh ? 'zh-CN' : 'en']?.displayName
    ?? (extension.setup?.authorizations?.length === 1 ? extension.setup.authorizations[0].title : extension.name);
}
