import type { LucideIcon } from 'lucide-react';
import {
  Brain,
  Clock,
  Cloud,
  Cpu,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  Heart,
  Image as ImageIcon,
  Layers,
  MessageSquare,
  Mic,
  ScrollText,
  Moon,
  Palette,
  Plug,
  Search,
  Shield,
  SlidersHorizontal,
  Users,
  Wrench,
} from 'lucide-react';

import type { Tab } from '@/i18n/messages';

const TAB_ICONS: Record<Tab, LucideIcon> = {
  chat: MessageSquare,
  sessions: FolderOpen,
  cron: Clock,
  skills: Layers,
  channels: Plug,
  agents: Users,
  logs: FileText,
  settingsAppearance: Palette,
  settingsSystem: Shield,
  settingsAgentChat: SlidersHorizontal,
  settingsAgentWorkspace: Folder,
  settingsAgentBrowser: Globe,
  settingsAgentRuntime: Brain,
  settingsAgentTools: Wrench,
  settingsAgentSystemPrompt: ScrollText,
  settingsAgents: Users,
  settingsProviders: Cloud,
  settingsModels: Cpu,
  settingsImageModels: ImageIcon,
  settingsChannels: Plug,
  settingsVoice: Mic,
  settingsGateway: Globe,
  settingsHeartbeat: Heart,
  settingsSearch: Search,
  settingsDreams: Moon,
};

export function TabIcon({ tab, className }: { tab: Tab; className?: string }) {
  const Icon = TAB_ICONS[tab];
  return <Icon className={className} strokeWidth={1.75} aria-hidden />;
}
