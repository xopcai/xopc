import type { ChannelsSettingsState } from '@/features/settings/channels-config-api';
import { cn } from '@/lib/cn';
import { nativeSelectMaxWidthClass, selectControlBaseClass, settingsInputFocusClass } from '@/lib/form-field-width';

export function channelsInputClassName(): string {
  return cn(
    'w-full rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg',
    'placeholder:text-fg-subtle',
    settingsInputFocusClass,
    'dark:border-edge',
  );
}

export function channelsSelectClassName(): string {
  return cn(selectControlBaseClass, nativeSelectMaxWidthClass);
}

export function parseIdList(raw: string): (string | number)[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^-?\d+$/.test(s) ? Number(s) : s));
}

export function joinAllowFrom(ids: (string | number)[]): string {
  return ids.map(String).join(', ');
}

export function isTelegramConfigured(tg: ChannelsSettingsState['telegram']): boolean {
  return Boolean(tg.botToken?.trim()) || Object.keys(tg.accounts ?? {}).length > 0;
}

export function isWeixinConfigured(wx: ChannelsSettingsState['weixin']): boolean {
  return Object.keys(wx.accounts ?? {}).length > 0 || wx.allowFrom.length > 0;
}

export function isFeishuConfigured(fs: ChannelsSettingsState['feishu']): boolean {
  return Boolean(fs.appId?.trim() && fs.appSecret?.trim()) || Object.keys(fs.accounts ?? {}).length > 0;
}
