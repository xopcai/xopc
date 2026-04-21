import type { LucideIcon } from 'lucide-react';
import {
  Clock,
  Cloud,
  Cpu,
  FileText,
  FolderOpen,
  Globe,
  Heart,
  Layers,
  MessageSquare,
  Mic,
  Palette,
  Plug,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react';

import type { Tab } from '@/i18n/messages';

const TAB_ICONS: Record<Tab, LucideIcon> = {
  chat: MessageSquare,
  sessions: FolderOpen,
  cron: Clock,
  skills: Layers,
  channels: Plug,
  logs: FileText,
  settingsAppearance: Palette,
  settingsAgentDefaults: SlidersHorizontal,
  settingsAgents: Users,
  settingsProviders: Cloud,
  settingsModels: Cpu,
  settingsChannels: Plug,
  settingsVoice: Mic,
  settingsGateway: Globe,
  settingsHeartbeat: Heart,
  settingsSearch: Search,
};

export function TabIcon({ tab, className }: { tab: Tab; className?: string }) {
  const Icon = TAB_ICONS[tab];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
