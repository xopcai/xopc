import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export interface BrowserSettingsState {
  browserEnabled: boolean;
  browserHeadless: boolean;
  browserAllowPrivateUrls: boolean;
  browserCommandTimeout: number | undefined;
  browserBackend: 'local' | 'cdp' | 'cloud' | 'extension' | 'cloakbrowser';
  browserCloudProvider: 'local' | 'browserbase' | 'browser-use';
  browserCloudApiKey: string;
  browserCloudProjectId: string;
  browserCloudRegion: string;
  browserCdpUrl: string;
  browserExtensionPort: number | undefined;
  browserExtensionHost: string;
  browserExtensionConnectionTimeout: number | undefined;
  browserCloakKeepOpen: boolean;
  browserCloakTemporaryProfile: boolean;
  browserCloakCacheDir: string;
  browserCloakBinaryPath: string;
  browserCloakTimezone: string;
  browserCloakLocale: string;
  browserCloakWebrtcIp: string;
  browserCloakFingerprintPlatform: string;
  browserCloakExtraArgs: string;
  browserHumanize: boolean;
  browserHumanPreset: 'default' | 'careful';
  browserDialogPolicy: 'must_respond' | 'auto_dismiss' | 'auto_accept';
  browserDialogTimeout: number | undefined;
}

const DEFAULT_BROWSER_SETTINGS: BrowserSettingsState = {
  browserEnabled: true,
  browserHeadless: false,
  browserAllowPrivateUrls: false,
  browserCommandTimeout: undefined,
  browserBackend: 'extension',
  browserCloudProvider: 'local',
  browserCloudApiKey: '',
  browserCloudProjectId: '',
  browserCloudRegion: '',
  browserCdpUrl: '',
  browserExtensionPort: undefined,
  browserExtensionHost: '127.0.0.1',
  browserExtensionConnectionTimeout: undefined,
  browserCloakKeepOpen: true,
  browserCloakTemporaryProfile: false,
  browserCloakCacheDir: '',
  browserCloakBinaryPath: '',
  browserCloakTimezone: '',
  browserCloakLocale: '',
  browserCloakWebrtcIp: '',
  browserCloakFingerprintPlatform: '',
  browserCloakExtraArgs: '',
  browserHumanize: true,
  browserHumanPreset: 'careful',
  browserDialogPolicy: 'auto_dismiss',
  browserDialogTimeout: undefined,
};

function truthyFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

export function parseBrowserSettings(cfg: unknown): BrowserSettingsState {
  const root = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg as Record<string, unknown> : {};
  const raw = root.browser;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_BROWSER_SETTINGS };
  }

  const browser = raw as Record<string, unknown>;
  const cloud = browser.cloud && typeof browser.cloud === 'object' && !Array.isArray(browser.cloud)
    ? browser.cloud as Record<string, unknown>
    : {};
  const extension = browser.extension && typeof browser.extension === 'object' && !Array.isArray(browser.extension)
    ? browser.extension as Record<string, unknown>
    : {};
  const cloak = browser.cloakbrowser && typeof browser.cloakbrowser === 'object' && !Array.isArray(browser.cloakbrowser)
    ? browser.cloakbrowser as Record<string, unknown>
    : {};

  const backend = browser.backend;
  const cloudProvider = browser.cloudProvider;
  const dialogPolicy = browser.dialogPolicy;

  return {
    browserEnabled: truthyFlag(browser.enabled),
    browserHeadless: truthyFlag(browser.headless),
    browserAllowPrivateUrls: truthyFlag(browser.allowPrivateUrls),
    browserCommandTimeout: typeof browser.commandTimeout === 'number' && browser.commandTimeout >= 5
      ? Math.floor(browser.commandTimeout)
      : undefined,
    browserBackend: backend === 'local' || backend === 'cdp' || backend === 'cloud' || backend === 'extension' || backend === 'cloakbrowser'
      ? backend
      : 'extension',
    browserCloudProvider: cloudProvider === 'browserbase' || cloudProvider === 'browser-use'
      ? cloudProvider
      : 'local',
    browserCloudApiKey: typeof cloud.apiKey === 'string' ? cloud.apiKey : '',
    browserCloudProjectId: typeof cloud.projectId === 'string' ? cloud.projectId : '',
    browserCloudRegion: typeof cloud.region === 'string' ? cloud.region : '',
    browserCdpUrl: typeof browser.cdpUrl === 'string' ? browser.cdpUrl : '',
    browserExtensionPort: typeof extension.port === 'number' && extension.port >= 1024 && extension.port <= 65535
      ? Math.floor(extension.port)
      : undefined,
    browserExtensionHost: typeof extension.host === 'string' && extension.host ? extension.host : '127.0.0.1',
    browserExtensionConnectionTimeout:
      typeof extension.connectionTimeout === 'number' && extension.connectionTimeout >= 1000
        ? Math.floor(extension.connectionTimeout)
        : undefined,
    browserCloakKeepOpen: cloak.keepOpen !== false,
    browserCloakTemporaryProfile: cloak.temporaryProfile === true,
    browserCloakCacheDir: typeof cloak.cacheDir === 'string' ? cloak.cacheDir : '',
    browserCloakBinaryPath: typeof cloak.binaryPath === 'string' ? cloak.binaryPath : '',
    browserCloakTimezone: typeof cloak.timezone === 'string' ? cloak.timezone : '',
    browserCloakLocale: typeof cloak.locale === 'string' ? cloak.locale : '',
    browserCloakWebrtcIp: typeof cloak.webrtcIp === 'string' ? cloak.webrtcIp : '',
    browserCloakFingerprintPlatform: typeof cloak.fingerprintPlatform === 'string' ? cloak.fingerprintPlatform : '',
    browserCloakExtraArgs: Array.isArray(cloak.extraArgs)
      ? cloak.extraArgs.filter((arg): arg is string => typeof arg === 'string' && arg.trim().length > 0).join('\n')
      : '',
    browserHumanize: browser.humanize !== false,
    browserHumanPreset: browser.humanPreset === 'default' ? 'default' : 'careful',
    browserDialogPolicy: dialogPolicy === 'must_respond' || dialogPolicy === 'auto_accept'
      ? dialogPolicy
      : 'auto_dismiss',
    browserDialogTimeout: typeof browser.dialogTimeoutSeconds === 'number' && browser.dialogTimeoutSeconds >= 1
      ? Math.floor(browser.dialogTimeoutSeconds)
      : undefined,
  };
}

export function buildBrowserConfig(state: BrowserSettingsState): Record<string, unknown> {
  return {
    enabled: state.browserEnabled,
    headless: state.browserHeadless,
    allowPrivateUrls: state.browserAllowPrivateUrls,
    ...(state.browserCommandTimeout !== undefined ? { commandTimeout: state.browserCommandTimeout } : {}),
    backend: state.browserBackend,
    ...(state.browserCloudProvider !== 'local' ? { cloudProvider: state.browserCloudProvider } : {}),
    ...(state.browserBackend === 'cloud'
      ? {
          cloud: {
            ...(state.browserCloudApiKey.trim() ? { apiKey: state.browserCloudApiKey.trim() } : {}),
            ...(state.browserCloudProjectId.trim() ? { projectId: state.browserCloudProjectId.trim() } : {}),
            ...(state.browserCloudRegion.trim() ? { region: state.browserCloudRegion.trim() } : {}),
          },
        }
      : {}),
    ...(state.browserCdpUrl.trim() ? { cdpUrl: state.browserCdpUrl.trim() } : {}),
    ...(state.browserBackend === 'extension'
      ? {
          extension: {
            ...(state.browserExtensionPort !== undefined ? { port: state.browserExtensionPort } : {}),
            ...(state.browserExtensionHost.trim() ? { host: state.browserExtensionHost.trim() } : {}),
            ...(state.browserExtensionConnectionTimeout !== undefined
              ? { connectionTimeout: state.browserExtensionConnectionTimeout }
              : {}),
          },
        }
      : {}),
    ...(state.browserBackend === 'cloakbrowser'
      ? {
          cloakbrowser: {
            keepOpen: state.browserCloakKeepOpen,
            temporaryProfile: state.browserCloakTemporaryProfile,
            ...(state.browserCloakCacheDir.trim() ? { cacheDir: state.browserCloakCacheDir.trim() } : {}),
            ...(state.browserCloakBinaryPath.trim() ? { binaryPath: state.browserCloakBinaryPath.trim() } : {}),
            ...(state.browserCloakTimezone.trim() ? { timezone: state.browserCloakTimezone.trim() } : {}),
            ...(state.browserCloakLocale.trim() ? { locale: state.browserCloakLocale.trim() } : {}),
            ...(state.browserCloakWebrtcIp.trim() ? { webrtcIp: state.browserCloakWebrtcIp.trim() } : {}),
            ...(state.browserCloakFingerprintPlatform.trim()
              ? { fingerprintPlatform: state.browserCloakFingerprintPlatform.trim() }
              : {}),
            ...(() => {
              const extraArgs = state.browserCloakExtraArgs.split('\n').map((line) => line.trim()).filter(Boolean);
              return extraArgs.length > 0 ? { extraArgs } : {};
            })(),
          },
          humanize: state.browserHumanize,
          humanPreset: state.browserHumanPreset,
        }
      : {}),
    ...(state.browserDialogPolicy !== 'auto_dismiss' ? { dialogPolicy: state.browserDialogPolicy } : {}),
    ...(state.browserDialogTimeout !== undefined ? { dialogTimeoutSeconds: state.browserDialogTimeout } : {}),
  };
}

export async function patchBrowserSettings(state: BrowserSettingsState): Promise<void> {
  await fetchJson(apiUrl('/api/config'), {
    method: 'PATCH',
    body: JSON.stringify({ browser: buildBrowserConfig(state) }),
  });
  void revalidateGatewayConfig();
}
