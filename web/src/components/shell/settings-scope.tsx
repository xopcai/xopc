import { Monitor, ShieldCheck } from 'lucide-react';

import type { Tab } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

export function SettingsScope({ tab }: { tab?: Tab }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  if (!tab || tab === 'settingsOverview' || tab === 'settingsGateway') return null;
  const local = tab === 'settingsSystem';
  const client = ['settingsKeyboardShortcuts', 'settingsDesktopPet'].includes(tab);
  const mixed = ['settingsAppearance', 'settingsComputerUse', 'settingsDesktopApp'].includes(tab);
  if (!local && !client && !mixed) return null;
  const Icon = local ? ShieldCheck : Monitor;
  const label = local ? (zh ? '本机权限' : 'Local permissions') : client ? (zh ? '此客户端' : 'This client') : (zh ? '客户端与服务设置' : 'Client and server settings');
  return <div className="mx-auto flex w-full max-w-[56rem] items-center gap-2 px-4 pt-5 text-xs text-fg-muted sm:px-5 xl:px-6" aria-label={zh ? '设置作用范围' : 'Settings scope'}>
    <Icon className="size-3.5 shrink-0" aria-hidden /><span>{label}</span>
  </div>;
}
