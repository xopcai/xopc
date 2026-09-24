import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  FileText,
  FolderOpen,
  Globe,
  Heart,
  Radio,
  Keyboard,
  Layers,
  Mic,
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
  logs: FileText,
  settingsImports: FolderOpen,
  settingsOverview: Activity,
  settingsModels: Layers,
  settingsVoice: Mic,
  settingsSearch: Search,
  settingsAppearance: Palette,
  settingsKeyboardShortcuts: Keyboard,
  settingsSystem: Shield,
  settingsDesktopPet: PawPrint,
  settingsDesktopApp: Package,
  settingsAgentBrowser: Globe,
  settingsComputerUse: MousePointer2,
  settingsAgentDefaults: Layers,
  settingsGateway: Globe,
  settingsRuntimes: TerminalSquare,
  settingsDevices: Smartphone,
  settingsHeartbeat: Heart,
  settingsTunnel: Radio,
  settingsShares: Share2,
};

export function TabIcon({ tab, className }: { tab: Tab; className?: string }) {
  const Icon = TAB_ICONS[tab];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
