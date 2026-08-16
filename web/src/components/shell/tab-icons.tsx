import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  FileText,
  FolderOpen,
  Globe,
  Heart,
  Zap,
  Radio,
  Keyboard,
  Layers,
  MessageSquare,
  Moon,
  Package,
  Palette,
  PawPrint,
  Plug,
  Share2,
  Shield,
  Target,
  Users,
} from 'lucide-react';

import type { Tab } from '@/i18n/messages';

const TAB_ICONS: Record<Tab, LucideIcon> = {
  chat: MessageSquare,
  sessions: FolderOpen,
  automations: Zap,
  skills: Layers,
  connectors: Plug,
  channels: Plug,
  agents: Users,
  logs: FileText,
  settingsOverview: Activity,
  settingsCapabilities: Layers,
  settingsAppearance: Palette,
  settingsKeyboardShortcuts: Keyboard,
  settingsSystem: Shield,
  settingsDesktopPet: PawPrint,
  settingsDesktopApp: Package,
  settingsAgentBrowser: Globe,
  settingsCapabilityPresets: Layers,
  settingsChannels: Plug,
  settingsGateway: Globe,
  settingsHeartbeat: Heart,
  settingsTunnel: Radio,
  settingsShares: Share2,
  settingsDreams: Moon,
  settingsGoals: Target,
};

export function TabIcon({ tab, className }: { tab: Tab; className?: string }) {
  const Icon = TAB_ICONS[tab];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
