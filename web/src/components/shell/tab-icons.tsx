import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ChartNoAxesColumn,
  FileText,
  FolderOpen,
  Globe,
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

import type { Tab } from '@/i18n/messages';

const TAB_ICONS: Record<Tab, LucideIcon> = {
  sessions: FolderOpen,
  usage: ChartNoAxesColumn,
  tracing: Activity,
  logs: FileText,
  settingsImports: FolderOpen,
  settingsOverview: Activity,
  settingsModels: Layers,
  settingsSearch: Search,
  settingsAppearance: Palette,
  settingsKeyboardShortcuts: Keyboard,
  settingsPersonal: Radio,
  settingsSystem: Shield,
  settingsDesktopPet: PawPrint,
  settingsDesktopApp: Package,
  settingsAgentBrowser: Globe,
  settingsComputerUse: MousePointer2,
  settingsPhoneUse: Smartphone,
  settingsAgentDefaults: Layers,
  settingsGateway: Globe,
  settingsRuntimes: TerminalSquare,
  settingsDevices: Smartphone,
  settingsTunnel: Radio,
  settingsShares: Share2,
};

export function TabIcon({ tab, className }: { tab: Tab; className?: string }) {
  const Icon = TAB_ICONS[tab];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
