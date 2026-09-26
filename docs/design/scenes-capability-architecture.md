# Scene capability architecture

Scenes are durable user delegations. A preset supplies useful defaults, but no runtime or API may route by preset key.

## Stable domain

Every activation follows the same lifecycle:

`template -> activation -> trigger intent -> scene run -> outcome -> presentation -> feedback`

The template declares context providers, triggers, an execution adapter, allowed outcome kinds, and effect handlers. Existing presets—mail follow-up, weekly planning, task follow-up, and source decision log—are data installed into this model.

## Extension points

- Context providers authorize and validate their own scope, then return bounded evidence.
- Source providers normalize references, check current authorization, and read versioned snapshots.
- Activation adapters own configuration that does not fit the core read-only form. They are selected by `template.execution.kind`.
- All adapters publish through `scene_runs`, `scene_outcomes`, and `scene_presentations`; they do not create a second result lifecycle.

Registries are immutable after composition. Unknown and duplicate capability IDs fail closed. Core code may distinguish execution capability kinds, but it must not compare template keys.

## API rules

- Creation, preflight, detail, configuration, and transitions use `/api/scenes/activations`.
- Source discovery uses `/api/scenes/source-providers`.
- Resource helpers use `/api/scenes/resources`.
- Scenario-specific route families are not retained.

The console renders by declared execution/context capabilities. Adding a preset with an existing capability combination requires template registration only; `source-decision-log` is the regression example.

## Migration rule

Schema migrations perform direct cutovers. Runtime constructors do not rewrite historical template keys or keep compatibility branches. The task-backed preset moved to the `task` execution adapter in migration 215.
