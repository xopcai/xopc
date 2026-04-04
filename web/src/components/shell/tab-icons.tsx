import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  Clock,
  Cloud,
  Cpu,
  FileEdit,
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
} from 'lucide-react';

import type { Tab } from '@/i18n/messages';

const TAB_ICONS: Record<Tab, LucideIcon> = {
  chat: MessageSquare,
  sessions: FolderOpen,
  cron: Clock,
  skills: Layers,
  editor: FileEdit,
  channels: Plug,
  logs: FileText,
  settingsAppearance: Palette,
  settingsAgent: Bot,
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
