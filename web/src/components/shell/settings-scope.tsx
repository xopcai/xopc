import { Cloud, Monitor, ShieldCheck } from 'lucide-react';

import { useDesktopGatewayConnection } from '@/features/gateway/use-desktop-gateway-connection';
import type { Tab } from '@/navigation';
import { useLocaleStore } from '@/stores/locale-store';

export function SettingsScope({ tab }: { tab?: Tab }) {
  const zh = useLocaleStore(state => state.language) === 'zh';
  const { data } = useDesktopGatewayConnection();
  if (!tab || tab === 'settingsOverview' || tab === 'settingsGateway') return null;
  const local = tab === 'settingsSystem';
  const client = ['settingsKeyboardShortcuts', 'settingsDesktopPet'].includes(tab);
  const mixed = ['settingsAppearance', 'settingsComputerUse', 'settingsDesktopApp'].includes(tab);
  const Icon = local ? ShieldCheck : client ? Monitor : Cloud;
  const label = local ? (zh ? '本机权限' : 'Local permissions') : client ? (zh ? '此客户端' : 'This client') : mixed ? (zh ? '客户端与服务设置' : 'Client and server settings') : (zh ? '当前 Gateway' : 'Current Gateway');
  const origin = data?.origin || (typeof window !== 'undefined' && !window.electronAPI ? window.location.origin : '');
  let host = '';
  try { host = origin ? new URL(origin).host : ''; } catch { /* Keep an unavailable address out of the scope label. */ }
  return <div className="mx-auto flex w-full max-w-[56rem] items-center gap-2 px-4 pt-5 text-xs text-fg-muted sm:px-5 xl:px-6" aria-label={zh ? '设置作用范围' : 'Settings scope'}>
    <Icon className="size-3.5 shrink-0" aria-hidden /><span>{label}</span>{!local && !client && !mixed && host ? <><span aria-hidden>·</span><span className="truncate">{host}</span></> : null}
  </div>;
}
