export interface PhoneSetupView {
  id: string; conversationId: string; agentId: string; revision: number;
  state: 'configuring' | 'verifying' | 'completed' | 'needs_attention' | 'cancelled';
  source?: 'local' | 'aliyun' | 'harmonyos'; error?: string; stale: boolean; settingsPath: string; interactionPath?: string;
  readiness: {
    enabled: boolean; toolAllowed: boolean;
    model: { ref?: string; chatRef?: string; source?: 'system' | 'global' | 'agent'; supported: boolean; configured: boolean };
    dependencies: Array<{ kind: 'adb' | 'scrcpy' | 'hdc' | 'hoscrcpy' | 'java'; state: string; version?: string; canInstall: boolean; distribution?: string; downloadUrl?: string }>;
    devices: Array<{ id: string; name: string; source: 'local' | 'aliyun' | 'harmonyos'; enabled: boolean; settingsAllowed: boolean }>;
    localDiscovery: Array<{ serial?: string; name: string; state: string; emulator: boolean }>;
    diagnostic?: string;
  };
  checks: { configured: boolean; read: boolean; operated: boolean; verified: boolean; released: boolean };
  attempt?: { id: string; deviceId: string; modelRef: string; sessionId?: string; goal: string;
    completion: { appPackage: string; textAny: string[]; requireChange: boolean }; maxActions: number; expiresAt: number; released: boolean };
  guidanceRefs: Array<{ sceneId: 'phone'; path: string; resourceVersion: string }>;
}
