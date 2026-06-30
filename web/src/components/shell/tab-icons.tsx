import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Clock,
  Cloud,
  Cpu,
  FileText,
  FolderOpen,
  Globe,
  Heart,
  Radio,
  Image as ImageIcon,
  Keyboard,
  KeyRound,
  Layers,
  MessageSquare,
  Mic,
  Moon,
  Package,
  Palette,
  Plug,
  Search,
  Share2,
  Shield,
  Target,
  Users,
} from 'lucide-react';

import type { Tab } from '@/i18n/messages';

const TAB_ICONS: Record<Tab, LucideIcon> = {
  chat: MessageSquare,
  sessions: FolderOpen,
  cron: Clock,
  skills: Layers,
  connectors: Plug,
  goals: Target,
  channels: Plug,
  agents: Users,
  logs: FileText,
  settingsOverview: Activity,
  settingsCredentials: KeyRound,
  settingsAppearance: Palette,
  settingsKeyboardShortcuts: Keyboard,
  settingsSystem: Shield,
  settingsAppManagement: Package,
  settingsAgentBrowser: Globe,
  settingsCapabilityPresets: Layers,
  settingsAgents: Users,
  settingsProviders: Cloud,
  settingsModels: Cpu,
  settingsImageModels: ImageIcon,
  settingsChannels: Plug,
  settingsVoice: Mic,
  settingsGateway: Globe,
  settingsHeartbeat: Heart,
  settingsTunnel: Radio,
  settingsSearch: Search,
  settingsShares: Share2,
  settingsDreams: Moon,
  settingsGoals: Target,
};

export function TabIcon({ tab, className }: { tab: Tab; className?: string }) {
  const Icon = TAB_ICONS[tab];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
