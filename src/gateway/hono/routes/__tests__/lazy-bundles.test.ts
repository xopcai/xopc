import { describe, expect, it } from 'vitest';

import {
  AUTHENTICATED_LAZY_ROUTE_BUNDLES,
  findAuthenticatedLazyRouteBundle,
} from '../lazy-bundles.js';

describe('lazy route bundles', () => {
  it('maps CLI authorization, accounts and policy routes', () => {
    for (const path of ['/api/connectors/executions/id/artifact', '/api/connectors/feishu-workspace/executions', '/api/connectors/feishu-workspace/accounts', '/api/connectors/feishu-workspace/authorizations', '/api/connectors/feishu-workspace/policy', '/api/connectors/authorizations/id', '/api/connectors/authorizations/id/cancel', '/api/connectors/authorizations/id/artifact', '/api/connectors/accounts/id']) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('connectors');
    }
    expect(findAuthenticatedLazyRouteBundle('/api/connectors-other')).toBeUndefined();
  });
  it('routes manual understanding updates ahead of general user-model routes', () => {
    for (const path of ['/api/user-model/refresh', '/api/user-model/refresh/batch-1', '/api/user-model/refresh/sources/run-1/collection']) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('user-model-refresh');
    }
    for (const path of ['/api/user-model/assertions', '/api/user-model/refresh-other']) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('user-model');
    }
  });

  it('maps memory editing and deletion without intercepting neighboring paths', () => {
    for (const path of ['/api/user-model/assertions/id', '/api/knowledge-memory/id', '/api/knowledge-memory/id/review']) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('user-model');
    }
    for (const path of ['/api/user-model-other', '/api/knowledge-memory-other']) {
      expect(findAuthenticatedLazyRouteBundle(path)).toBeUndefined();
    }
  });

  it('maps scene resource families without capturing similarly named routes', () => {
    for (const path of ['/api/scenes/templates', '/api/scenes/templates/mail/versions/1.0.0', '/api/scenes/preflight', '/api/scenes/sources/mail',
      '/api/scenes/activations', '/api/scenes/activations/id', '/api/scenes/activations/id/checks', '/api/scenes/activations/id/runs',
      '/api/scenes/activations/id/notes', '/api/scenes/activations/id/work-items', '/api/scenes/activations/id/schedules',
      '/api/scenes/activations/id/schedules/weekly', '/api/scenes/work-items/id', '/api/scenes/outcomes', '/api/scenes/presentations/id',
      '/api/scenes/presentations/id/feedback', '/api/scenes/metrics', '/api/scenes/activations/id/imported-context', '/api/scenes/digests/id']) expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('scenes');
    for (const path of ['/api/scenes-other', '/api/scene', '/api/inbox/other']) expect(findAuthenticatedLazyRouteBundle(path)?.id).not.toBe('scenes');
  });
  it('maps connector account management without swallowing nearby paths', () => {
    for (const path of ['/api/connectors/composio/accounts/account-1', '/api/connectors/composio/setup-status', '/api/connectors/composio/authorizations/attempt-1', '/api/connectors/composio/backends/backend-1']) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('connectors');
    }
    expect(findAuthenticatedLazyRouteBundle('/api/connectors-other')).toBeUndefined();
  });
  it('maps the compatibility preflight without intercepting endpoint core routes', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/endpoint-tools/compatibility')?.id).toBe('endpoint-compatibility');
    for (const path of ['/api/endpoint-tools/principals', '/api/endpoint-tools/compatibility-other']) {
      expect(findAuthenticatedLazyRouteBundle(path)).toBeUndefined();
    }
  });
  it('maps every import route family without swallowing nearby paths', () => {
    for (const path of ['/api/imports/sources', '/api/imports/sources/codex/scan', '/api/imports/sources/claude-code/scan', '/api/imports/inventories/id', '/api/imports/inventories/id/items/item/preview', '/api/imports/runs', '/api/imports/runs/id']) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('imports');
    }
    for (const path of ['/api/imports-other', '/api/import', '/api/migrations']) expect(findAuthenticatedLazyRouteBundle(path)?.id).not.toBe('imports');
  });
  it('maps project understanding without swallowing other project resources', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/projects/example/understanding')?.id).toBe('project-understanding');
    for (const path of ['/api/projects/example', '/api/projects/example/sessions', '/api/projects/example/understanding-other']) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).not.toBe('project-understanding');
    }
  });
  it('maps meeting capture and nested upload resources without swallowing notes or voice', () => {
    for (const path of ['/api/discussions', '/api/discussion-capture/settings', '/api/discussions/metrics', '/api/discussions/by-note/id', '/api/discussions/id/recording/chunks/0', '/api/discussions/id/capture/seal', '/api/discussions/id/recording/job', '/api/discussions/id/audio', '/api/discussions/id/export', '/api/discussions/id/actions/action/convert', '/api/discussions/id/transcript', '/api/discussions/id/organize', '/api/discussions/id/summary']) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('discussions');
    }
    for (const path of ['/api/discussions-other', '/api/notes/id', '/api/voice']) expect(findAuthenticatedLazyRouteBundle(path)?.id).not.toBe('discussions');
  });
  it('maps browser sessions without swallowing browser control routes', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/browser-session')?.id).toBe('browser-session');
    expect(findAuthenticatedLazyRouteBundle('/api/browser-sessions')).toBeUndefined();
    expect(findAuthenticatedLazyRouteBundle('/api/browser/tab-bindings')?.id).not.toBe('browser-session');
  });
  it('maps proactive controls and card families without swallowing neighboring inbox routes', () => {
    for (const path of ['/api/proactive/metrics', '/api/proactive/presence', '/api/proactive/digests/id', '/api/proactive/follow-ups', '/api/proactive/follow-ups/sources', '/api/proactive/follow-ups/id', '/api/proactive/overview', '/api/proactive/delegations', '/api/proactive/subscriptions/id/check', '/api/proactive/web-push/probes', '/api/proactive/web-push/probes/id/opened', '/api/proactive/web-push/subscriptions/id/test', '/api/proactive/preferences', '/api/inbox/judgments', '/api/inbox/judgments/changes', '/api/inbox/judgments/card/actions', '/api/internal/proactive/health']) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('proactive');
    }
    expect(findAuthenticatedLazyRouteBundle('/api/inbox/other')).toBeUndefined();
    expect(findAuthenticatedLazyRouteBundle('/api/proactive-other')).toBeUndefined();
  });
  it('keeps chat-critical routes off the lazy registry', () => {
    const paths = [
      '/api/status',
      '/api/realtime/tickets',
      '/api/sessions/example/inputs',
      '/api/sessions/example/turns/turn-1/replace',
      '/api/send',
    ];
    for (const path of paths) {
      expect(findAuthenticatedLazyRouteBundle(path)).toBeUndefined();
    }
  });

  it('maps admin routes to lazy bundles', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/config')?.id).toBe('config');
    expect(findAuthenticatedLazyRouteBundle('/api/logs')?.id).toBe('logs');
    expect(findAuthenticatedLazyRouteBundle('/api/support/report')?.id).toBe('support');
    expect(findAuthenticatedLazyRouteBundle('/api/extensions')?.id).toBe('auth-registry-extensions');
    expect(findAuthenticatedLazyRouteBundle('/api/automations/abc')?.id).toBe('automations');
    expect(findAuthenticatedLazyRouteBundle('/api/capabilities/connectors')?.id).toBe('capabilities');
  });

  it('maps knowledge review routes without swallowing neighboring paths', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/knowledge-memory/item-1/review')?.id).toBe('user-model');
    expect(findAuthenticatedLazyRouteBundle('/api/knowledge-memory-other/item-1/review')).toBeUndefined();
  });

  it('uses distinct bundles for voice models vs voice settings', () => {
    for (const path of ['/api/voice/catalog', '/api/voice/catalog/refresh', '/api/voice/selection']) expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('voice');
    expect(findAuthenticatedLazyRouteBundle('/api/voice/models')?.id).toBe('agents');
    expect(findAuthenticatedLazyRouteBundle('/api/voice/providers')?.id).toBe('voice');
    expect(findAuthenticatedLazyRouteBundle('/api/voice/realtime/sessions/cancel')?.id).toBe('voice');
  });

  it('routes browser install SSE streams to browser-install, not the broader browser bundle', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/browser/playwright/install/stream')?.id).toBe(
      'browser-install',
    );
    expect(findAuthenticatedLazyRouteBundle('/api/browser/playwright/install/cancel')?.id).toBe(
      'browser-install',
    );
    // Non-stream browser settings (doctor / launch / CDP / remote) live in the
    // `browser` bundle — separate from `config` so the giant config patcher
    // does not load when the UI is only inspecting the extension status.
    expect(findAuthenticatedLazyRouteBundle('/api/browser/playwright/doctor')?.id).toBe('browser');
    expect(findAuthenticatedLazyRouteBundle('/api/browser/status')?.id).toBe('browser');
    expect(findAuthenticatedLazyRouteBundle('/api/browser/test')?.id).toBe('browser');
    expect(findAuthenticatedLazyRouteBundle('/api/browser/extension/install')?.id).toBe('browser');
    expect(findAuthenticatedLazyRouteBundle('/api/browser/extension/archive')?.id).toBe('browser');
    expect(findAuthenticatedLazyRouteBundle('/api/browser/tab-bindings/session-1')?.id).toBe('browser');
    expect(findAuthenticatedLazyRouteBundle('/api/browserish/tab-bindings/session-1')).toBeUndefined();
  });

  it('routes image generation APIs to models, not agents', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/image-generation/catalog')?.id).toBe('image-generation');
    expect(findAuthenticatedLazyRouteBundle('/api/image-generation/default')?.id).toBe('image-generation');
    expect(findAuthenticatedLazyRouteBundle('/api/image-generation/default/setup')?.id).toBe('image-generation');
    expect(findAuthenticatedLazyRouteBundle('/api/agents/main/image-generation')?.id).toBe('image-generation');
    expect(findAuthenticatedLazyRouteBundle('/api/agents')?.id).toBe('agents');
  });

  it('routes gateway auth secret reveal to config, not extension-gateway', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/gateway/reveal-auth-secret/token')?.id).toBe('config');
    expect(findAuthenticatedLazyRouteBundle('/api/gateway/reveal-auth-secret')?.id).toBe('config');
    expect(findAuthenticatedLazyRouteBundle('/api/gateway/some-method')?.id).toBe('extension-gateway');
  });

  it('routes search api key reveal to config', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/tools/web/reveal-search-api-key')?.id).toBe('config');
  });

  it('routes session workspace trust to the commands and skills bundle', () => {
    expect(findAuthenticatedLazyRouteBundle('/api/chat/workspace-trust')?.id).toBe('commands-skills');
  });

  it('routes session share APIs to the shares bundle', () => {
    const paths = [
      '/api/sessions/agent%3Amain%3Achat/share-preview',
      '/api/sessions/agent%3Amain%3Achat/shares',
      '/api/sessions/agent%3Amain%3Achat/shares/share-1/refresh',
      '/api/sessions/agent%3Amain%3Achat/hosted-shares',
      '/api/sessions/agent%3Amain%3Achat/hosted-shares/share-1/refresh',
    ];
    for (const path of paths) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('shares');
    }
    expect(findAuthenticatedLazyRouteBundle('/api/sessions/example/inputs')).toBeUndefined();
    expect(findAuthenticatedLazyRouteBundle('/api/sessions/example/shares-extra')).toBeUndefined();
  });

  it('routes hosted publication APIs to the shares bundle', () => {
    const paths = [
      '/api/hosted-publications',
      '/api/hosted-publications/capabilities',
      '/api/hosted-publications/static-sites',
      '/api/notes/note-1/hosted-publications',
      '/api/notes/note-1/hosted-publications/publication-1/refresh',
    ];
    for (const path of paths) {
      expect(findAuthenticatedLazyRouteBundle(path)?.id).toBe('shares');
    }
    expect(findAuthenticatedLazyRouteBundle('/api/notes/note-1')?.id).toBe('notes');
  });

  it('routes models-json config endpoints to the models bundle', () => {
    // /api/models-json is `/api/models` + `-json`, not `/api/models/...`,
    // so the prefix matcher needs an explicit entry. Without it the
    // models settings panel sees a 404 on every load.
    expect(findAuthenticatedLazyRouteBundle('/api/models-json')?.id).toBe('models');
    expect(findAuthenticatedLazyRouteBundle('/api/models-json/validate')?.id).toBe('models');
    expect(findAuthenticatedLazyRouteBundle('/api/models-json/reload')?.id).toBe('models');
    expect(findAuthenticatedLazyRouteBundle('/api/models-json/test-api-key')?.id).toBe('models');
    expect(findAuthenticatedLazyRouteBundle('/api/capabilities/readiness')?.id).toBe('models');
  });

  it('has unique bundle ids', () => {
    const ids = AUTHENTICATED_LAZY_ROUTE_BUNDLES.map((bundle) => bundle.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
