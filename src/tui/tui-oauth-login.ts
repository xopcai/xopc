import { spawn } from 'node:child_process';

import {
  Container,
  SelectList,
  Spacer,
  Text,
  type Component,
  type KeybindingsManager,
  type SelectItem,
} from '@earendil-works/pi-tui';

import type { OAuthLoginCallbacks } from '../auth/index.js';
import { CredentialResolver } from '../auth/credentials.js';
import {
  getOAuthProvider,
  getSupportedOAuthProviders,
  type OAuthProviderConfig,
} from '../cli/utils/oauth-providers.js';
import { getProviderDisplayName } from '../providers/index.js';
import { getXopcCloudCatalogCoordinator } from '../providers/xopc-cloud-catalog-coordinator.js';
import { createLogger } from '../utils/logger.js';

import { ExtensionInputDialog } from './components/extension-dialog.js';
import { formatKeyIds } from './format-tui-hotkeys.js';
import { selectListTheme, theme } from './theme.js';

const log = createLogger('TuiOAuthLogin');

type TuiOAuthLoginDeps = {
  chatLog: { addSystem: (line: string) => void };
  tui: {
    requestRender: (force?: boolean) => void;
    setFocus: (component: Component) => void;
  };
  editor: Component;
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  keybindings?: KeybindingsManager;
};

type SelectDialogItem = SelectItem & {
  description?: string;
};

class TuiSelectDialog extends Container implements Component {
  private readonly selectList: SelectList;

  constructor(
    title: string,
    items: SelectDialogItem[],
    callbacks: { onSelect: (value: string) => void; onCancel: () => void },
    keybindings?: KeybindingsManager,
  ) {
    super();
    this.addChild(new Text(theme.bold(theme.accent(title)), 0, 0));
    this.addChild(new Spacer(1));
    this.selectList = new SelectList(
      items,
      Math.min(Math.max(items.length, 1), 10),
      selectListTheme,
      {
        minPrimaryColumnWidth: 16,
        maxPrimaryColumnWidth: 48,
      },
    );
    this.selectList.onSelect = (item) => callbacks.onSelect(item.value);
    this.selectList.onCancel = callbacks.onCancel;
    this.addChild(this.selectList);
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.dim(formatSelectHint(keybindings)), 0, 0));
  }

  handleInput(data: string): void {
    this.selectList.handleInput(data);
  }
}

function formatSelectHint(keybindings?: KeybindingsManager): string {
  const confirm = keybindings
    ? formatKeyIds(keybindings, 'tui.select.confirm', { capitalize: true })
    : 'Enter';
  const cancel = keybindings
    ? formatKeyIds(keybindings, 'tui.select.cancel', { capitalize: true })
    : 'Esc';
  return `↑/↓ + ${confirm} to choose, ${cancel} to cancel.`;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.on('error', (err) => {
    log.debug({ err, command }, 'Browser open command failed');
  });
  child.unref();
}

function getDeviceCodeBrowserUrl(providerId: string, verificationUri: string, userCode: string): string {
  if (providerId !== 'github-copilot') return verificationUri;
  try {
    const url = new URL(verificationUri);
    url.searchParams.set('user_code', userCode);
    return url.toString();
  } catch {
    return verificationUri;
  }
}

function runManagedDialog<T>(
  deps: TuiOAuthLoginDeps,
  activeCleanups: Set<() => void>,
  createDialog: (resolve: (value: T) => void, reject: (err: Error) => void) => Component,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      activeCleanups.delete(cleanup);
      deps.closeOverlay();
      deps.tui.requestRender(true);
      resolve(value);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      activeCleanups.delete(cleanup);
      deps.closeOverlay();
      deps.tui.requestRender(true);
      reject(err);
    };
    const cleanup = () => fail(new Error('Login cancelled'));
    activeCleanups.add(cleanup);
    deps.openOverlay(createDialog(finish, fail));
    deps.tui.requestRender(true);
  });
}

async function promptForProvider(deps: TuiOAuthLoginDeps, activeCleanups: Set<() => void>): Promise<string | undefined> {
  const providers = getSupportedOAuthProviders();
  if (providers.length === 0) {
    deps.chatLog.addSystem('No OAuth providers are available.');
    deps.tui.requestRender();
    return undefined;
  }

  return runManagedDialog(
    deps,
    activeCleanups,
    (resolve, reject) =>
      new TuiSelectDialog(
        'Choose OAuth provider',
        providers.map((provider) => ({
          value: provider,
          label: provider,
          description: getProviderDisplayName(provider),
        })),
        {
          onSelect: resolve,
          onCancel: () => reject(new Error('Login cancelled')),
        },
        deps.keybindings,
      ),
  );
}

function buildTuiOAuthCallbacks(params: {
  config: OAuthProviderConfig;
  deps: TuiOAuthLoginDeps;
  activeCleanups: Set<() => void>;
}): OAuthLoginCallbacks {
  const { config, deps, activeCleanups } = params;

  const inputDialog = (
    title: string,
    placeholder: string | undefined,
    allowEmpty: boolean | undefined,
  ): Promise<string> =>
    runManagedDialog<string>(
      deps,
      activeCleanups,
      (resolve, reject) =>
        new ExtensionInputDialog(
          title,
          placeholder,
          {
            onSubmit: (value) => {
              if (!allowEmpty && value.trim().length === 0) {
                deps.chatLog.addSystem('Input is required.');
                deps.tui.requestRender();
                return;
              }
              resolve(value);
            },
            onCancel: () => reject(new Error('Login cancelled')),
          },
          deps.keybindings,
        ),
    );

  return {
    onAuth: (info) => {
      const lines = [config.urlPrompt.trim(), info.url];
      if (info.instructions) lines.push('', info.instructions);
      if (config.provider.usesCallbackServer) {
        lines.push('', 'Waiting for localhost callback. If it does not complete, paste the final redirect URL when prompted.');
      }
      deps.chatLog.addSystem(lines.join('\n'));
      openBrowser(info.url);
      deps.tui.requestRender();
    },
    onDeviceCode: (info) => {
      const browserUrl = getDeviceCodeBrowserUrl(config.provider.id, info.verificationUri, info.userCode);
      const lines = [`Open ${browserUrl} and enter code ${info.userCode}`];
      if (config.provider.id === 'github-copilot') {
        lines.push('GitHub may leave the browser on a /login/device/authorize 404 page after approval; return here and wait for completion.');
      }
      deps.chatLog.addSystem(lines.join('\n'));
      openBrowser(browserUrl);
      deps.tui.requestRender();
    },
    onPrompt: (prompt) => inputDialog(prompt.message, prompt.placeholder, prompt.allowEmpty),
    onManualCodeInput: config.provider.usesCallbackServer
      ? () => inputDialog('Paste the authorization code (or full redirect URL):', undefined, false)
      : undefined,
    onProgress: (message) => {
      deps.chatLog.addSystem(message);
      deps.tui.requestRender();
    },
    onSelect: (prompt) => {
      if (prompt.options.length === 0) return Promise.resolve(undefined);
      return runManagedDialog(
        deps,
        activeCleanups,
        (resolve, reject) =>
          new TuiSelectDialog(
            prompt.message,
            prompt.options.map((option) => ({
              value: option.id,
              label: option.label,
            })),
            {
              onSelect: resolve,
              onCancel: () => reject(new Error('Login cancelled')),
            },
            deps.keybindings,
          ),
      );
    },
  };
}

export async function runTuiOAuthLogin(provider: string | undefined, deps: TuiOAuthLoginDeps): Promise<void> {
  const activeCleanups = new Set<() => void>();
  try {
    const selectedProvider = provider?.trim() || await promptForProvider(deps, activeCleanups);
    if (!selectedProvider) return;

    const config = getOAuthProvider(selectedProvider);
    if (!config) {
      throw new Error(`OAuth not supported for provider: ${selectedProvider}`);
    }

    deps.chatLog.addSystem(`Starting OAuth login for ${selectedProvider}...`);
    deps.tui.requestRender();

    const credentials = await config.provider.login(
      buildTuiOAuthCallbacks({ config, deps, activeCleanups }),
    );

    const resolver = new CredentialResolver();
    await resolver.saveOAuthCredentials(selectedProvider, credentials);

    if (selectedProvider === 'xopc-cloud') {
      const catalog = await getXopcCloudCatalogCoordinator().refresh('oauth');
      if (catalog.error) {
        deps.chatLog.addSystem(`Authorization succeeded, but model catalog sync failed: ${catalog.error.message}`);
      }
    }

    deps.chatLog.addSystem(`OAuth login completed for ${selectedProvider}.`);
  } finally {
    for (const cleanup of [...activeCleanups]) cleanup();
    deps.tui.setFocus(deps.editor);
    deps.tui.requestRender(true);
  }
}
