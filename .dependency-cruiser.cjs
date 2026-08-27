/**
 * dependency-cruiser config — architecture invariants for xopc.
 *
 * Run with `pnpm run depcheck` (or `npx depcruise --config -- src`).
 *
 * The rules below pin the boundaries that the 5-phase refactor produced. The
 * cardinal sin is reaching "up" from a lower-level subsystem into
 * `src/agent/service.ts` — that's how `AgentService` became a 1700-line god
 * class in the first place. Each rule documents WHY it exists so future PRs
 * can decide whether the violation is intentional (loosen the rule) or a
 * regression (fix the import).
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies create import-order land mines. Use dependency injection ' +
        'or extract types to a leaf module. The one allowed exception (image-generation ' +
        'provider contract ↔ types barrel) is explicitly excluded via `pathNot` below.',
      from: {
        path: '^src/',
        // Public API for 5 extension packages — `types.ts` re-exports the
        // provider contract for backward compatibility while `provider-registry.ts`
        // depends on the capability types in `types.ts`. Breaking this cycle would
        // be a coordinated public-API change across the dashscope/fal/google/
        // minimax/openai extensions. Tracked as accepted tech debt.
        pathNot: '^src/agent/image/generation/(provider-registry|types)\\.ts$',
      },
      to: { circular: true },
    },

    {
      name: 'no-embedded-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/embedded/* must NOT depend on AgentService. Embedded runtime should be ' +
        'driven by injected collaborators (SessionStateBag, EmbeddedRunRegistry, ' +
        'SessionHydrator) — not reach back into the god service. If you need state from ' +
        'AgentService, accept it as a constructor dep.',
      from: { path: '^src/agent/embedded/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-tools-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/tools/* must NOT depend on AgentService. Tools receive their ' +
        'dependencies through AgentToolsFactory + dep callbacks. Reaching back into ' +
        'AgentService would mean any tool can see every collaborator on it.',
      from: { path: '^src/agent/tools/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-orchestration-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/orchestration/* (AgentOrchestrator, event handler, retry/timeout/fallback) ' +
        'must NOT depend on AgentService. AgentOrchestrator is constructed BY AgentService; ' +
        'reverse coupling means each is responsible for the other.',
      from: { path: '^src/agent/orchestration/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-messaging-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/messaging/* (MessageRouter, CommandHandler, StreamManager, ' +
        'OutboundCoordinator) must NOT depend on AgentService. These are wired by ' +
        'AgentService; they take their deps via constructor configs.',
      from: { path: '^src/agent/messaging/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-session-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/session/* (SessionStateBag, SessionConfigService, SessionHydrator, ' +
        'SessionInspector, SessionContextManager, lifecycle, tracker) must NOT depend on ' +
        'AgentService. These services are pure collaborators owned by AgentService.',
      from: { path: '^src/agent/session/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-memory-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/memory/* (BuiltinMemoryStore, MemoryManager, MemoryPrefetchCoordinator, ' +
        'dreaming/) must NOT depend on AgentService — reaching up to the orchestrator ' +
        'breaks the per-workspace runtime isolation.',
      from: { path: '^src/agent/memory/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-mcp-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/mcp/* (bundle-mcp runtime/transports) must NOT depend on AgentService. ' +
        'MCP servers are integration-layer plumbing wired in by tools / agent-manager.',
      from: { path: '^src/agent/mcp/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-skills-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/skills/* must NOT depend on AgentService. Skills are loaded by ' +
        'AgentManager via SkillManager; the skill subsystem itself owns no agent-service knowledge.',
      from: { path: '^src/agent/skills/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-sandbox-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/sandbox/* is policy-only (exec validation, path validation). It must NOT ' +
        'reach back to AgentService.',
      from: { path: '^src/agent/sandbox/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-workspace-runtime-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/workspace-runtime/* is a leaf — per-workspace SkillManager / ' +
        'SystemPromptBuilder / MemoryManager registry. It must not import AgentService.',
      from: { path: '^src/agent/workspace-runtime/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    {
      name: 'no-background-review-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/background-review/* is invoked by AgentManager.scheduleBackgroundReviewAfterUserTurn. ' +
        'It must not import AgentService directly.',
      from: { path: '^src/agent/background-review/' },
      to: { path: '^src/agent/service\\.ts$' },
    },

    // ── Reverse direction: lower-level subsystems cannot reach into AgentManager ──
    //
    // AgentManager is the high-level "session → Agent instance" coordinator owned
    // by AgentService. Lower-level subsystems may need a narrow slice of its
    // surface (e.g. removeAgent, getResolvedWorkspaceForSession, memory hooks);
    // they should depend on `AgentInstanceGateway` instead so the full agent-manager
    // module graph stays inverted.
    {
      name: 'no-embedded-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/embedded/* must depend on AgentInstanceGateway, not the AgentManager class. ' +
        'Reaching into agent-manager.ts drags the full tools-factory + skills + memory ' +
        'graph into the embedded runtime.',
      from: { path: '^src/agent/embedded/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-session-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/session/* (SessionStateBag, SessionConfigService, SessionHydrator, ' +
        'SessionInspector, lifecycle, tracker) must depend on AgentInstanceGateway, ' +
        'not the AgentManager class. The session domain owns its own state — it should ' +
        'not see toolsFactory / workspace runtimes / skills.',
      from: { path: '^src/agent/session/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-service-helpers-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/service/* (direct-turn helpers, webchat TTS, build-direct-message-content, ' +
        'process-direct-*) must depend on AgentInstanceGateway, not the AgentManager class.',
      from: { path: '^src/agent/service/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-tools-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/tools/* must not import AgentManager directly. Tools receive their ' +
        'per-session context through factories + callbacks; the AgentManager class itself ' +
        'should never be in a tool module.',
      from: { path: '^src/agent/tools/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-memory-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/memory/* must not depend on AgentManager. AgentManager INJECTS the memory ' +
        'manager + prefetch coordinator — the reverse direction means an import cycle.',
      from: { path: '^src/agent/memory/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-mcp-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/mcp/* must not depend on AgentManager. MCP bundle + transports are leaf ' +
        'integration modules.',
      from: { path: '^src/agent/mcp/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-skills-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/skills/* must not depend on AgentManager. SkillManager / skill-manage-tool / ' +
        'marketplace are loaded BY AgentManager — reverse import means a cycle.',
      from: { path: '^src/agent/skills/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-workspace-runtime-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/workspace-runtime/* is a leaf cache owned by AgentManager — must not loop back.',
      from: { path: '^src/agent/workspace-runtime/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-background-review-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/background-review/* is invoked by AgentManager; reverse import means a cycle.',
      from: { path: '^src/agent/background-review/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-sandbox-to-agent-manager',
      severity: 'error',
      comment: 'src/agent/sandbox/* is policy-only — must not reach into AgentManager.',
      from: { path: '^src/agent/sandbox/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },

    // ── lifecycle/ is a low-level utility layer (LifecycleManager, ProgressFeedbackManager,
    //    HookHandler, TypingController, timeout-wrapper). Many higher-level subsystems
    //    import from it; the reverse direction would create cycles.
    {
      name: 'no-lifecycle-to-agent-service',
      severity: 'error',
      comment:
        'src/agent/lifecycle/* must not depend on AgentService. Lifecycle modules are ' +
        'building blocks (progress, hooks, timeout) used by higher layers — reverse ' +
        'imports form cycles.',
      from: { path: '^src/agent/lifecycle/' },
      to: { path: '^src/agent/service\\.ts$' },
    },
    {
      name: 'no-lifecycle-to-agent-manager',
      severity: 'error',
      comment:
        'src/agent/lifecycle/* must not depend on AgentManager. Same rationale as ' +
        'the no-lifecycle-to-agent-service rule.',
      from: { path: '^src/agent/lifecycle/' },
      to: { path: '^src/agent/agent-manager\\.ts$' },
    },
    {
      name: 'no-lifecycle-to-higher-layers',
      severity: 'error',
      comment:
        'src/agent/lifecycle/* must not import from higher-level agent subsystems ' +
        '(inbound, orchestration, messaging, tools, session/*, embedded, ' +
        'memory, mcp, skills). Lifecycle is the foundation those layers build on.',
      from: { path: '^src/agent/lifecycle/' },
      to: {
        path: [
          '^src/agent/inbound/',
          '^src/agent/orchestration/',
          '^src/agent/messaging/',
          '^src/agent/tools/',
          '^src/agent/session/',
          '^src/agent/embedded/',
          '^src/agent/memory/',
          '^src/agent/mcp/',
          '^src/agent/skills/',
          '^src/agent/background-review/',
          '^src/agent/workspace-runtime/',
          '^src/agent/feedback/',
        ],
      },
    },
  ],

  options: {
    doNotFollow: {
      path: ['node_modules', 'dist', 'out', '\\.test\\.ts$', '__tests__'],
    },
    includeOnly: '^src/',
    exclude: {
      // Tests can import freely (mocks etc.); they are not architecture.
      path: '(__tests__|\\.test\\.ts$)',
    },
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      // Match the project's ESM `.js` import suffixes resolving to `.ts` sources.
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    },
  },
};
