import type { SceneInboxService } from './inbox.js';
import type { SceneRepository } from './repository.js';
import type { SceneApplicationService } from './service.js';
import type { SceneMailContextProvider } from './mailContext.js';

/** An explicitly installed scene domain; never resolves to the old runtime. */
export interface SceneHttpServices {
  repository: SceneRepository;
  application: SceneApplicationService;
  inbox: SceneInboxService;
  mail: SceneMailContextProvider;
}
