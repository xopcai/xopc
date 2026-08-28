# Agent Capabilities

Agent capabilities are lazy product-level ability packs that sit between skills and tools.

- **Skill**: conversational instructions and task workflow, selected explicitly with `/skill:name` or a UI entry point.
- **Capability**: product ability declaration, including tools, lifecycle, permissions, and a small active prompt hint.
- **Tool**: atomic executor registered with the agent only when allowed and useful.

This keeps large or sensitive authoring tools out of unrelated conversations while still allowing multi-turn tasks such as custom pet creation.

## Built-in Capabilities

| Capability | Purpose | Default TTL |
| --- | --- | --- |
| `desktop-pet-authoring` | Create, repair, and update desktop pet packages. | `until-complete` |
| `automation-authoring` | Create or update reminders, monitors, and recurring automations. | `until-complete` |
| `workflow-authoring` | Design, validate, and run workflows. | `until-complete` |
| `extension-authoring` | Scaffold, inspect, and package plugins or extensions. | `until-complete` |
| `skill-authoring` | Create, edit, inspect, and maintain skills. | `until-complete` |
| `visual-asset-authoring` | Generate and inspect images, icons, sprites, and visual assets. | `session` |
| `browser-research` | Perform deeper web research with search, extraction, and browser tools. | `turn` |
| `data-analysis` | Analyze local structured data and produce derived artifacts. | `session` |

## Activation

Skills declare capabilities in frontmatter:

```yaml
metadata:
  xopc:
    activates_capabilities:
      - desktop-pet-authoring
```

When the user selects the skill, xopc resolves the capability declaration, injects any missing tools for that turn, and appends a compact active-capability prompt block. `turn` capabilities are not persisted; `session` and `until-complete` capabilities stay active for follow-up clarification turns.

## API

The gateway exposes the capability catalog for UI selectors:

```http
GET /api/chat/capabilities
```

The response payload is the list of capability definitions from `src/agent/capabilities`, enriched with `availableTools` and `unavailableTools` for the current session when `sessionKey` is provided:

```http
GET /api/chat/capabilities?sessionKey=agent:main:webchat:default:direct:...
```

UI surfaces should show or enable a capability based on `availableTools`, not the raw declared `tools` list.
