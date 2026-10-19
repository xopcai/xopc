import type { ExtensionApiRow } from './types';

export function pluginDisplayName(extension: ExtensionApiRow, zh: boolean) {
  return extension.localizations?.[zh ? 'zh-CN' : 'en']?.displayName
    ?? (extension.setup?.authorizations?.length === 1 ? extension.setup.authorizations[0].title : extension.name);
}

export function pluginNeedsAuthorization(extension: ExtensionApiRow) {
  return extension.authorizationStatus === 'required'
    || !!extension.setup?.authorizations?.length && extension.authorizationStatus !== 'connected';
}

export function pluginCanStart(extension: ExtensionApiRow) {
  return extension.active && !pluginNeedsAuthorization(extension)
    && (extension.authorizationStatus === 'connected' || extension.authorizationStatus === 'not_required');
}
