# Unified PC user understanding

## Product contract

macOS, Windows, and Linux use one source model:

`catalog -> explicit selection -> grant -> collect -> normalize -> synthesize -> review -> activate -> incremental refresh -> revoke`

The operating system changes only the adapter. Grants, collection runs, normalized items, derived understanding, Focus review, and governance are shared.

| Platform | Local sources in onboarding |
| --- | --- |
| macOS | Apple Notes, Calendar, Reminders, approved work folders |
| Windows | Recent Documents metadata, approved work folders |
| Linux | freedesktop XBEL recent-document metadata, approved work folders |
| All | GitHub, calendar, cloud documents, mail, and messages through read-only connectors |

No local source is selected by default. macOS asks for Automation permission only after selection. Windows and Linux recent-document adapters read metadata only. Imported local source content is bounded in memory and is not inserted into the knowledge-item store; the database keeps the grant, run/checkpoint, paraphrased evidence, candidate understanding, and user decision.

## User-facing prompts

### Direct profile

1. “What should xopc call you?”
2. “Your role”
3. “What are you mainly trying to achieve?”
4. Optional timezone, locale, pronouns, and accessibility preferences.

These are explicit facts. They are available immediately and are shown in About You.

### Source permission

> Only selected read-only sources are collected. Content is analyzed by your configured model; xopc stores grants, evidence summaries, and derived understanding—not the imported source content.

Each adapter also shows its OS-native permission dialog when one is required.

### Cross-source synthesis

The model instruction is source-agnostic and requires JSON containing `profileCandidates` and `workThreads`. Its core rules are:

- synthesize across source types; repeated independent signals are stronger than one item;
- use only supplied evidence references;
- treat `other`, `shared`, and `unknown` ownership conservatively;
- do not infer sensitive identity, health, finance, politics, relationships, credentials, or private contact details;
- never turn secret or regulated items into structured understanding;
- paraphrase evidence instead of quoting imported content;
- prefer recurring themes and durable preferences over one-off or stale items;
- reconcile connected sources with approved work-folder understanding and expose uncertainty.

The executable prompt is in `src/work-discovery/analyzer.ts`.

### Review

Candidate understanding offers “Remember” or “Ignore”. Candidate Focus offers “Activate”, “Pause”, “Complete”, or “Wrong”. Nothing inferred becomes active until the user confirms it.

## What happens after understanding

- Active profile, collaboration rules, relevant confirmed understanding, and active Focus are injected into the fenced user-context block for each applicable turn.
- A confirmed Focus guides task framing and prioritization; it does not authorize external actions.
- Continuous work-folder and connector grants use fingerprints or connector cursors for incremental refresh.
- Background consolidation checks expiry, contradictions, and corroboration, but does not auto-activate candidates.
- About You lists active grants, access mode, retention policy, processing policy, and last collection time.
- Revoking a connector pauses learning. “Revoke & remove derived” also deletes understanding whose remaining evidence depends only on that source.

## Removed legacy surface

- Electron `personalContext.scan`
- `/api/work-discovery/personal-context/*`
- `/api/work-discovery/sources/directories/*`
- `work_discovery_sources`
- `work_discovery_source_refreshes`

There are no compatibility aliases for these surfaces. Existing source grants are not migrated; users authorize sources again under the unified grant model.
