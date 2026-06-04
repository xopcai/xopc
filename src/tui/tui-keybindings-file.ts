import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  KeybindingsManager,
  type KeybindingsConfig,
  type KeyId,
} from '@earendil-works/pi-tui';

import { resolveStateDir } from '../config/paths.js';
import { XOPC_TUI_KEYBINDINGS } from './xopc-tui-keybindings.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toKeybindingsConfig(value: unknown): KeybindingsConfig {
  if (!isRecord(value)) return {};
  const config: KeybindingsConfig = {};
  for (const [key, binding] of Object.entries(value)) {
    if (typeof binding === 'string') {
      config[key] = binding as KeyId;
      continue;
    }
    if (Array.isArray(binding) && binding.every((entry) => typeof entry === 'string')) {
      config[key] = binding as KeyId[];
    }
  }
  return config;
}

function loadRawConfig(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function getTuiKeybindingsPath(): string {
  return join(resolveStateDir(), 'keybindings.json');
}

export function loadTuiKeybindingsConfig(path = getTuiKeybindingsPath()): KeybindingsConfig {
  return toKeybindingsConfig(loadRawConfig(path));
}

export class XopcKeybindingsManager extends KeybindingsManager {
  constructor(
    userBindings: KeybindingsConfig = {},
    private readonly configPath = getTuiKeybindingsPath(),
  ) {
    super(XOPC_TUI_KEYBINDINGS, userBindings);
  }

  reload(): void {
    this.setUserBindings(loadTuiKeybindingsConfig(this.configPath));
  }

  getConfigPath(): string {
    return this.configPath;
  }
}

export function createXopcTuiKeybindingsManager(): XopcKeybindingsManager {
  const configPath = getTuiKeybindingsPath();
  return new XopcKeybindingsManager(loadTuiKeybindingsConfig(configPath), configPath);
}
