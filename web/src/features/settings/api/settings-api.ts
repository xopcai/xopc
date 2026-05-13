import {
  createGatewayAgent,
  deleteGatewayAgent,
  fetchAgentProfileFileContent,
  fetchAgentProfileFiles,
  fetchGatewayAgents,
  fetchGatewayConfigBindings,
  fetchSkillsCatalog,
  patchGatewayBindings,
  saveAgentProfileFileContent,
  updateGatewayAgent,
} from '@/features/settings/agents-admin-api';
import {
  defaultChannelsState,
  fetchChannelsSettings,
  fetchWeixinGatewayQrLoginStart,
  fetchWeixinGatewayQrLoginStatus,
  patchChannelsSettings,
} from '@/features/settings/channels-config-api';
import { fetchAgentDefaults, patchAgentDefaults } from '@/features/settings/config-api';
import { fetchGatewaySettings, patchGatewaySettings } from '@/features/settings/gateway-config-api';
import {
  fetchHeartbeatMd,
  normalizeHeartbeatFromConfig,
  patchHeartbeatSettings,
  putHeartbeatMd,
  triggerHeartbeat,
} from '@/features/settings/heartbeat-config-api';
import { fetchWebSearchSettings, patchWebSearchSettings } from '@/features/settings/web-search-config-api';
import { fetchDreamingStatus, postDreamingAction } from '@/features/settings/dreaming-api';
import {
  fetchVoiceModels,
  fetchVoiceSettings,
  patchVoiceSettings,
} from '@/features/settings/voice-config-api';

/** Grouped gateway-console settings HTTP helpers (thin re-exports). */
export const settingsApi = {
  agents: {
    fetchGatewayAgents,
    createGatewayAgent,
    updateGatewayAgent,
    deleteGatewayAgent,
    fetchGatewayConfigBindings,
    patchGatewayBindings,
    fetchSkillsCatalog,
    fetchAgentProfileFiles,
    fetchAgentProfileFileContent,
    saveAgentProfileFileContent,
  },
  agentDefaults: {
    fetchAgentDefaults,
    patchAgentDefaults,
  },
  gateway: {
    fetchGatewaySettings,
    patchGatewaySettings,
  },
  channels: {
    defaultChannelsState,
    fetchChannelsSettings,
    patchChannelsSettings,
    fetchWeixinGatewayQrLoginStart,
    fetchWeixinGatewayQrLoginStatus,
  },
  voice: {
    fetchVoiceSettings,
    patchVoiceSettings,
    fetchVoiceModels,
  },
  heartbeat: {
    normalizeHeartbeatFromConfig,
    patchHeartbeatSettings,
    fetchHeartbeatMd,
    putHeartbeatMd,
    triggerHeartbeat,
  },
  webSearch: {
    fetchWebSearchSettings,
    patchWebSearchSettings,
  },
  dreaming: {
    fetchDreamingStatus,
    postDreamingAction,
  },
} as const;
