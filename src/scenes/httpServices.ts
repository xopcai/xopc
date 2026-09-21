import type { BrowserSubscriptionService } from '../notifications/browserSubscriptions.js';
import type { ScenePrincipal } from './contracts.js';
import type { SceneInboxService } from './inbox.js';
import type { SceneRepository } from './repository.js';
import type { SceneApplicationService } from './service.js';
import type { SceneMailContextProvider } from './mailContext.js';
import type { ScenePreferenceService } from './preferences.js';
import type { SceneMetrics } from './metrics.js';
import type { TaskFollowUpService } from './taskFollowUp/service.js';

/** An explicitly installed scene domain; never resolves to the old runtime. */
export interface SceneHttpServices {
  followUps?: TaskFollowUpService;
  repository: SceneRepository;
  application: SceneApplicationService;
  inbox: SceneInboxService;
  mail: SceneMailContextProvider;
  mailDiscovery?: {
    listAccounts(principal: ScenePrincipal): Array<{ id: string; label: string }>;
    searchSources(principal: ScenePrincipal, value: unknown, signal: AbortSignal): Promise<Array<{ id: string; accountId: string; subject: string; sender: string }>>;
  };
  metrics: SceneMetrics;
  preferences: ScenePreferenceService;
  browser: BrowserSubscriptionService;
}

export interface SceneAccess {
  principal: ScenePrincipal;
  services: SceneHttpServices;
}
