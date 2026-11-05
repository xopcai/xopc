import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ChartNoAxesColumn,
  FileText,
  Download,
  History,
  Network,
  PanelsTopLeft,
  MonitorSmartphone,
  Radio,
  Keyboard,
  Layers,
  MousePointer2,
  Package,
  TerminalSquare,
  Palette,
  PawPrint,
  Share2,
  Shield,
  Smartphone,
  Search,
} from 'lucide-react';

import { Loopi } from '@/components/brand/loopi';
import type { Tab } from '@/i18n/messages';

const TAB_ICONS: Record<Exclude<Tab, 'settingsPersonal'>, LucideIcon> = {
  sessions: History,
  usage: ChartNoAxesColumn,
  tracing: Activity,
  logs: FileText,
  settingsImports: Download,
  settingsOverview: Activity,
  settingsModels: Layers,
  settingsSearch: Search,
  settingsAppearance: Palette,
  settingsKeyboardShortcuts: Keyboard,
  settingsSystem: Shield,
  settingsDesktopPet: PawPrint,
  settingsDesktopApp: Package,
  settingsAgentBrowser: PanelsTopLeft,
  settingsComputerUse: MousePointer2,
  settingsPhoneUse: Smartphone,
  settingsAgentDefaults: Layers,
  settingsGateway: Network,
  settingsRuntimes: TerminalSquare,
  settingsDevices: MonitorSmartphone,
  settingsTunnel: Radio,
  settingsShares: Share2,
};

export function TabIcon({ tab, className }: { tab: Tab; className?: string }) {
  if (tab === 'settingsPersonal') return <span className={className} aria-hidden><Loopi variant="avatar" className="size-full" /></span>;

  const Icon = TAB_ICONS[tab];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
