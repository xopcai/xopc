import { BrowserSubscriptionService } from '../../notifications/browserSubscriptions.js';
import { ScenePreferenceService } from '../../scenes/preferences.js';
import type { DatabaseSync } from 'node:sqlite';

import type { ProductNotification } from '@xopcai/gateway-contract';

import type { Config } from '../../config/schema.js';
import { isProviderConfiguredSync, resolveModel } from '../../providers/index.js';
import { SceneAgentExecutor } from '../../scenes/agentExecutor.js';
import type { SceneActivation, ScenePermission, ScenePrincipal } from '../../scenes/contracts.js';
import { SceneExecutionService, type SceneReadOnlyExecutor } from '../../scenes/execution.js';
import type { SceneHttpServices } from '../../scenes/httpServices.js';
import { SceneInboxService } from '../../scenes/inbox.js';
import type { SceneMailContextProvider } from '../../scenes/mailContext.js';
import { SceneMailObservationService } from '../../scenes/mailObservations.js';
import { maintainSceneStorage } from '../../scenes/maintenance.js';
import { SceneMetrics } from '../../scenes/metrics.js';
import { resolveSceneModelRef } from '../../scenes/model.js';
import { SceneRepository } from '../../scenes/repository.js';
import { SceneCapabilityRegistry } from '../../scenes/registry.js';
import { SceneResultNotifications } from '../../scenes/resultNotifications.js';
import { SceneRuntime } from '../../scenes/runtime.js';
import { SceneApplicationService } from '../../scenes/service.js';
import { familyPlanTemplate, mailFollowUpTemplate } from '../../scenes/templates.js';
import { SceneUserNotesProvider } from '../../scenes/userNotes.js';
import { assertSceneStorageReady } from '../../storage/sqlite/scenes-schema.js';
import { createLogger } from '../../utils/logger.js';
import { createSceneBrowserDispatcher } from './browserNotifications.js';
import { GatewaySceneMailContext } from './mailContext.js';
import { SlackThreadSource } from './slackThreadSource.js';
import { SceneTaskExecutionService } from '../../scenes/taskFollowUp/service.js';
import { decisionLogTemplate, SceneSourceRegistry, taskFollowUpTemplate } from '../../scenes/taskFollowUp/contracts.js';

const log = createLogger('Gateway:Scenes');

/** Composition root for the initialized database. Never creates tables or starts an old worker. */
export class GatewaySceneHost {
  readonly http: SceneHttpServices;
  private readonly runtime: SceneRuntime;
  private readonly notifications: SceneResultNotifications;
  private readonly browserDispatcher: ReturnType<typeof createSceneBrowserDispatcher>;
  private timer?: ReturnType<typeof setInterval>;
  private active?: Promise<void>;
  private stopped = false;
  private nextMaintenanceAt = 0;
  private readonly clock: () => number;

  constructor(private readonly db: DatabaseSync, input: {
    principal: ScenePrincipal;
    config: () => Config;
    publish: (type: 'notification.created', notification: ProductNotification) => void;
    executor?: SceneReadOnlyExecutor;
    mail?: SceneMailContextProvider;
    clock?: () => number;
    intervalMs?: number;
  }) {
    assertSceneStorageReady(db);
    if (!input.principal.ownerId.trim() || !input.principal.workspaceId.trim()) throw new Error('Scene host principal is required');
    const clock = input.clock ?? Date.now;
    this.clock = clock;
    const repository = new SceneRepository(db);
    repository.installTemplate(mailFollowUpTemplate);
    repository.installTemplate(familyPlanTemplate);
    repository.installTemplate(taskFollowUpTemplate);
    repository.installTemplate(decisionLogTemplate);
    const mail = input.mail ?? new GatewaySceneMailContext(db, clock);
    const providers = new SceneCapabilityRegistry([mail, new SceneUserNotesProvider(db, clock)]);
    const authorize = (activation: SceneActivation): ScenePermission => {
      if (activation.ownerId !== input.principal.ownerId || activation.workspaceId !== input.principal.workspaceId) {
        return { accountIds: [], contextProviders: [], effectHandlers: [] };
      }
      const grants = providers.list().flatMap(provider => {
        const accountIds = provider.authorization?.(activation) ?? null;
        return accountIds === null ? [] : [{ id: provider.id, accountIds }];
      });
      return { accountIds: [...new Set(grants.flatMap(grant => grant.accountIds))],
        contextProviders: grants.map(grant => grant.id), effectHandlers: [] };
    };
    const grant = async (activation: SceneActivation) => authorize(activation);
    const executor = input.executor ?? new SceneAgentExecutor(() => resolveModel(resolveSceneModelRef(input.config())));
    const sourceProviders = new SceneSourceRegistry([new SlackThreadSource(db)]);
    const taskExecution = new SceneTaskExecutionService(db, { config: input.config, sources: sourceProviders });
    const activationAdapters = new SceneCapabilityRegistry([taskExecution]);
    this.http = { activationAdapters, sourceProviders, repository, mail, mailDiscovery: mail instanceof GatewaySceneMailContext ? mail : undefined, application: new SceneApplicationService(repository, providers, grant, clock, () => {
        if (input.executor) return [];
        try {
          const model = resolveModel(resolveSceneModelRef(input.config()));
          return isProviderConfiguredSync(model.provider) ? [] : ['model_credentials'];
        } catch { return ['model_configuration']; }
      }),
      inbox: new SceneInboxService(db, clock), browser: new BrowserSubscriptionService(db, clock), preferences: new ScenePreferenceService(db),
      metrics: new SceneMetrics(db, clock, () => input.executor ? null : resolveSceneModelRef(input.config())) };
    this.runtime = new SceneRuntime(repository, new SceneExecutionService(repository, providers, executor, grant, clock),
      new SceneMailObservationService(repository, mail, grant, clock, 60_000), clock, input.intervalMs ?? 5000);
    this.notifications = new SceneResultNotifications(db, authorize, (event) => input.publish('notification.created', event), clock);
    this.browserDispatcher = createSceneBrowserDispatcher(db, authorize, clock);
    this.intervalMs = input.intervalMs ?? 5000;
  }

  private readonly intervalMs: number;

  start(): void {
    if (this.stopped) throw new Error('Create a new scene host after shutdown');
    if (this.timer) return;
    assertSceneStorageReady(this.db);
    this.runtime.start();
    const poll = () => {
      for (const adapter of this.http.activationAdapters.list()) {
        void adapter.tick().catch(err => log.error({ err, adapter: adapter.id }, 'Scene adapter check failed'));
      }
      try {
        if (this.clock() >= this.nextMaintenanceAt) { maintainSceneStorage(this.db, this.clock()); this.nextMaintenanceAt = this.clock() + 3600000; }
        this.notifications.drain(); void this.browserDispatcher.drainOne().catch(err => log.error({ err }, 'Scene browser reminder failed')); } catch (err) { log.error({ err }, 'Scene result publication failed'); }
    };
    this.timer = setInterval(poll, this.intervalMs);
    this.timer.unref();
    poll();
  }

  tick(): Promise<void> {
    if (this.stopped) return Promise.reject(new Error('Scene host stopped'));
    if (this.active) return this.active;
    const work = Promise.all([this.runtime.tick(), ...this.http.activationAdapters.list().map(adapter => adapter.tick())]).then(() => {
      if (!this.stopped) this.notifications.drain();
    });
    this.active = work.finally(() => { this.active = undefined; });
    return this.active;
  }

  /** Must finish before the Gateway closes SQLite or its realtime broker. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await Promise.all(this.http.activationAdapters.list().map(adapter => adapter.stop()));
    await this.runtime.stop();
    await this.browserDispatcher.stop();
    await this.active?.catch(() => undefined);
  }
}
