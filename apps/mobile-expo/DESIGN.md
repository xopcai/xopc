# XOPC Mobile Design System

Version 3.0 — Quiet Momentum

Status: target design direction. This document is the source of truth for mobile product, interaction, visual design, and the staged implementation work. It supersedes the former “Calm Intelligence” guidance where the two conflict.

## 1. Product intent

XOPC is a private workspace in a person’s pocket: a place to capture a thought, recover context, direct an agent, and see what needs attention. It must feel composed and personal rather than like a remote admin console or a generic chat clone.

The intended feeling is **quiet momentum**:

- Quiet enough that notes, conversations, and decisions remain the focus.
- Warm enough to feel alive and owned, not monochrome or sterile.
- Precise enough to make gateway, sync, automation, and AI state trustworthy.
- Fast enough that capture and asking an agent feel immediate.

“Premium” does not mean more decoration. It means better hierarchy, intentional materials, exact spacing, tactile feedback, excellent empty states, and fewer competing visual treatments.

### 1.1 Design principles

The system takes Apple’s current HIG principles of hierarchy, harmony, consistency, simplicity, and craft as operating criteria, while retaining XOPC’s own identity. See [Apple HIG](https://developer.apple.com/design/human-interface-guidelines/), [Designing for iOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-ios), [Materials](https://developer.apple.com/design/human-interface-guidelines/materials), and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).

1. **Content owns the canvas.** Chrome frames work; it never becomes the work.
2. **One dominant action.** Each screen exposes one obvious next step. Secondary actions are contextual, not permanently visible.
3. **Hierarchy, not density.** Use title scale, grouping, alignment, and whitespace before adding containers, color, or icons.
4. **Material communicates location.** Floating navigation, input, and transient controls may use a restrained material; document and reading surfaces stay solid and stable.
5. **Energy follows meaning.** Accent color, animation, and haptics appear for capture, direct action, progress, success, and attention — never merely to fill a surface.
6. **Native expectations win.** Back, swipe, pull to refresh, menus, sheets, Dynamic Type, and safe areas work as iOS users expect.
7. **Progressive disclosure protects focus.** A user sees the current task first, then options when needed.
8. **Every state has a shape.** Loading, offline, selected, saving, queued, failed, and completed states are clear without relying only on color.

### 1.2 Non-goals

- Do not imitate Apple Notes or ChatGPT pixel-for-pixel.
- Do not use a gradient page background, glass-card grids, neon AI effects, illustration-led empty states, or decorative status colors.
- Do not make every control a pill, every object a card, or every list item elevated.
- Do not add a permanent bottom tab bar merely to resemble a consumer app. XOPC’s home workspace and focused overlays are deliberate; navigation must earn persistent chrome.
- Do not use AI sparkle imagery or a second brand accent as a substitute for useful product feedback.

## 2. Product model and information architecture

The current application has a single workspace landing surface and task routes for Inbox, Notes, Sessions, Chat, Files, Agents, Automations, Sharing, and Settings. This model is sound, but the home currently presents too many equally weighted sections and every collection uses a similar card treatment.

The target model has four modes. A person should always know which mode they are in.

| Mode | Purpose | Primary surface | Primary action | Entry / exit |
|---|---|---|---|---|
| **Workspace** | Resume the most useful work | Home | Ask AI or capture | Root; return with a direct home action |
| **Capture** | Save without interrupting the moment | Inbox composer / capture sheet | Save | Bottom capture control; dismiss returns to context |
| **Library** | Find and organize durable material | Inbox, Notes, Sessions, Files | Open or filter | Home shortcuts and search; back returns to prior context |
| **Focus** | Read, edit, converse, or run a task | Note, Chat, Automation detail | Contextual to the task | Push or workspace overlay; back preserves context |

### 2.1 Workspace home

The home is a **briefing**, not a dashboard or app launcher.

Order its content by actionability:

1. A quiet greeting/context line and a compact connection indicator only when it changes what a person can do.
2. **Continue**: one to three most relevant items. It is the visual anchor, not a full recent-activity feed.
3. **Needs attention**: show only items requiring an action. Hide the section entirely when empty.
4. **Ask an agent**: a horizontally scrolling roster with recognisable avatars and names; selecting one begins a focused conversation.
5. **Library**: one compact grouped navigation list, not five independent feature buttons.

Home rules:

- Keep the first actionable content within one viewport below the header on a regular iPhone.
- Show a gateway banner only for unavailable, starting, or degraded conditions. A healthy connection is a quiet dot/status in the header or context line, never a persistent card.
- “Continue” uses one featured surface plus plain rows when more than one item is needed; it must not become a grid of cards.
- A section title uses a small, quiet trailing action only when it leads to a useful complete collection.
- The create note action and Ask AI must not compete. The current centered circular button becomes part of a unified bottom action dock described below.

### 2.2 Capture and Inbox

Inbox is a temporal landing zone, not an unstructured second Notes list.

- The bottom composer is always the strongest capture affordance. It opens as a single line, grows only while typing, and gives direct attachment, voice, and send feedback.
- A compact count/summary can appear above the list only when it helps triage (for example, “6 unreviewed”). It must not duplicate each row’s state.
- AI organize is a contextual toolbar action. The sheet previews the outcome in plain language and supports undo; it never presents speculative AI as fact.
- Archive is the primary completion action in row swipe. Delete is deliberately farther away and always reversible through undo where possible.

### 2.3 Notes and Library

Notes is a reading-first library. It should borrow Apple Notes’ scanability, not its exact visual treatment.

- Use a large page title at rest, collapsing to a compact title while scrolling.
- Search is an inline, native-feeling field below the title, not a title-pill replacement. It appears on request and keeps focus stable.
- Tags and kind filters are horizontally scrollable text-first controls. One selected filter may use a soft accent fill; unselected filters stay quiet.
- A standard note row carries title, one preview line, and one trailing metadata line. Tags appear only when they materially aid retrieval; show at most two. Avoid a chip cloud in every row.
- Pin and task state use a small leading/trailing symbol, not a second visual container.
- The empty state offers “Create note” or “Capture something” with an example prompt, not a large illustration.

### 2.4 Sessions and Chat

Chat is a **focus mode**, closer to a calm writing surface than a messaging feed.

- The header contains back, the session name, and at most one visible high-value action. Agent, model, and gateway context live in a compact contextual menu/sheet rather than a cluster of permanent controls.
- Conversation content uses a single readable column. User input has a quiet tinted surface; assistant output is primarily unboxed text with separation by spacing and a subtle provenance label when required.
- Tool activity, thinking, goals, and artifacts are progressively disclosed. Default to a one-line live status and let people expand details; never make the transcript a stack of status cards.
- The composer is a raised bottom material with a solid editable interior. It is visibly connected to the conversation through a soft shadow and top border, not a large opaque panel.
- Suggested follow-ups appear after a completed answer, as 1–3 text actions, and disappear once the person types. They must not push the composer off screen.
- Streaming uses a restrained breathing status or subtle line reveal, not animated dots that compete with content.

### 2.5 Settings and operational screens

Settings should feel like an iOS settings list: grouped, legible, and calm.

- Use system-like grouped sections on a page base; section labels are small and spaced, not framed.
- Rows have a 52–56pt minimum visual height, one leading symbol treatment, primary label, optional short value, and a familiar trailing affordance.
- Connection status is a concise summary row. Detailed logs, route choice, tunnel diagnostics, and QR pairing belong one level deeper.
- Automation, agent, gateway, and sharing screens use the same list and detail grammar. Operational data earns denser layout only after a person chooses to inspect it.

## 3. Navigation and containment

### 3.1 Header hierarchy

Replace the universal “three circular controls plus a central pill” header with two native header modes.

| Header | Use | Structure |
|---|---|---|
| **Large title** | Library roots, settings, home at rest | Safe-area top, optional leading brand/context, title aligned to the content grid, 0–2 trailing icon actions |
| **Compact title** | Scroll-collapsed roots and focus/detail screens | Standard 44pt control area, back where appropriate, centered or leading title based on platform convention, 0–1 trailing action |

Rules:

- Header controls are 44 × 44pt hit targets; their visible glyphs remain 20–22pt.
- The content grid starts at 20pt on iPhone (16pt only for dense lists or very narrow widths). Header and body share the same leading alignment.
- Do not give every header control a filled circular background. Use a bare glyph by default; apply a material circle only when it floats over scrolling or visual content.
- The XOPC mark appears on the workspace root and onboarding, not in every pushed screen.
- Search is a field in content context, never a decorative replacement for screen identity.

### 3.2 Presentations

| Containment | Use | Behavior |
|---|---|---|
| Push | Read, edit, inspect, or a task with history | Forward movement; standard back gesture; preserve draft state |
| Workspace overlay | Ask AI from Home | Home remains perceptibly behind the task; drag/down or explicit close returns to the same scroll position |
| Bottom sheet | Agent/model picker, capture source, filters, short choices | Clear grabber, title, grouped options, swipe-to-dismiss where safe |
| Dialog | Confirm an irreversible or blocking decision | One concise consequence, safe action, destructive action only when needed |
| Full-screen modal | Pair gateway, long form, scanner, complex configuration | Clear cancel/done affordance; never hide unsaved changes silently |

### 3.3 Bottom action dock

The app may use a floating lower control area, but only one system may own that space per screen.

- **Home:** a small raised dock contains `Capture` and `Ask AI`. Capture is the primary direct action; Ask AI is a text-labeled secondary action. On compact widths, use a primary circular Capture button with an adjacent unobtrusive Ask control, never two matching circular FABs.
- **Inbox:** the capture composer owns the dock.
- **Chat:** the message composer owns the dock.
- **Lists:** use a trailing `+` or compose action in the header/content; do not overlay an unrelated central FAB.
- **Selection mode:** the batch action bar replaces the normal dock. It has a visible selected count and safe-area-aware background.

## 4. Visual foundation

### 4.1 Color philosophy

The color system is neutral-led with a distinctive, softened indigo primary. Blue should direct attention, not paint the interface. A warm paper base in light mode and a blue-black base in dark mode add character without turning either mode into a theme effect.

Target balance: 82–88% neutral surface/text, 8–12% accent-supporting tints, 2–5% semantic signal. Actual screens should not use all colors merely because tokens exist.

The implementation remains semantic: components consume `useTheme()` / `src/theme/tokens.ts`; no component hardcodes hex values. The token table below is the approved v3 target for a later token migration.

| Role | Light | Dark | Use |
|---|---:|---:|---|
| `surface.base` | `#F7F7F5` | `#101113` | Page canvas; warm light paper / quiet graphite |
| `surface.grouped` | `#EFEFED` | `#17181B` | Grouped list background, secondary regions |
| `surface.panel` | `#FFFFFF` | `#1B1C20` | Reading panel, sheet, elevated object |
| `surface.elevated` | `#FFFFFF` | `#24262C` | Dock, floating control, popover |
| `surface.input` | `#EEF0F4` | `#23252B` | Search, composer interior, editable field |
| `surface.pressed` | `#E8E9E8` | `#2B2D33` | Press feedback |
| `surface.selected` | `#E8EDFF` | `#263250` | Selected row or active filter |
| `text.primary` | `#17181C` | `#F5F5F7` | Essential reading and titles |
| `text.secondary` | `#63656E` | `#A8AAB4` | Supporting copy, standard glyphs |
| `text.tertiary` | `#8E9099` | `#777982` | Nonessential metadata only |
| `border.subtle` | `#E7E7E5` | `#292A2F` | Internal divider |
| `border.default` | `#DCDDDF` | `#36373E` | Input, raised surface, selected boundary |
| `accent.primary` | `#4B63D9` | `#91A4FF` | Main action, selected state, links |
| `accent.pressed` | `#3D52B8` | `#B5C2FF` | Pressed primary action |
| `accent.soft` | `#EEF1FF` | `#202944` | AI hint, quiet selected context |
| `semantic.success` | `#27845A` | `#56C58D` | Complete, healthy, available |
| `semantic.warning` | `#B66A15` | `#F0AD4E` | Needs review, uncertain, degraded |
| `semantic.error` | `#C83C45` | `#FF7A82` | Failure and destructive action |
| `semantic.info` | `#4B63D9` | `#91A4FF` | Informational state, not decoration |
| `overlay.scrim` | `rgba(19, 20, 24, 0.28)` | `rgba(0, 0, 0, 0.52)` | Modal containment |

Rules:

- There is one brand direction: indigo. Do not introduce a general-purpose purple, teal, or gradient “AI” accent.
- Status colors never classify notes, agents, or chat messages. Use iconography or neutral grouping for categories.
- A subtle warm surface difference in light mode is intentional; do not flatten it to white.
- Dark mode is not inverse light mode. Preserve luminance steps, reduce border contrast, and avoid pure black panels.
- Material is a depth tool, not a color effect. Respect reduced transparency / increase contrast settings; always supply a solid fallback.

### 4.2 Typography

Use the platform system typeface: SF Pro on iOS, Roboto on Android, and the system monospace face for code. The application uses Dynamic Type / font scale, never viewport-derived type scaling.

| Token | Size / line height | Weight | Use |
|---|---:|---:|---|
| `display` | 34 / 41 | 700 | Home moment, empty-state title; rare |
| `largeTitle` | 28 / 34 | 700 | Library roots, settings, page identity |
| `title` | 22 / 28 | 700 | Detail title, sheet title |
| `heading` | 17 / 22 | 600 | Section title, important card title |
| `body` | 16 / 23 | 400 | Reading, message, note preview |
| `ui` | 15 / 20 | 500 | Rows, controls, composer |
| `label` | 13 / 18 | 500 | Section label, compact supporting text |
| `caption` | 12 / 16 | 400 | Noncritical timestamp or metadata |
| `micro` | 11 / 14 | 600 | Exceptional badge only |

Rules:

- Prefer an increase in type weight or placement before a change in color.
- `micro` is not a substitute for concise language. Never put essential information at 11pt.
- Use `largeTitle` only at an actual top-level destination. Collapse it as the content scrolls; do not stack it with another framed header title.
- Long text, code, filenames, and URLs wrap or truncate deliberately; controls must never overlap them.
- Use sentence case and concise verbs. User-facing text must use the i18n catalog.

### 4.3 Spacing, layout, and shape

Use an 4pt base grid with deliberately larger content breaks. Small gaps create rhythm; large gaps create hierarchy.

| Token | Value | Use |
|---|---:|---|
| `xxs` | 2 | Optical correction only |
| `xs` | 4 | Glyph / text adjacency |
| `sm` | 8 | Compact internal relationship |
| `md` | 12 | Row padding, control group |
| `lg` | 16 | Dense list horizontal inset |
| `xl` | 20 | Default iPhone content inset and card interior |
| `xxl` | 28 | Section separation |
| `xxxl` | 40 | Major screen / empty-state separation |
| `xxxxl` | 56 | Rare editorial break |

| Token | Value | Use |
|---|---:|---|
| `radius.sm` | 8 | Small tag, compact control |
| `radius.md` | 12 | Input, row icon background |
| `radius.lg` | 16 | Card, popover, normal sheet element |
| `radius.xl` | 22 | Composer, dock, large sheet |
| `radius.full` | 9999 | Avatar, circular icon button, limited pills |

Rules:

- Default screen inset is 20pt. A plain high-density grouped list may use 16pt; a text reading surface may use 20–24pt.
- Do not create “empty space” by wrapping each row in an extra card. First use section spacing and dividers.
- Use radius to communicate containment and touchability, not a blanket visual style.
- A full-width card needs a reason: featured continuation, summary, temporary panel, or primary composer. Regular collection rows belong on the page or inside a grouped list.
- Avoid nested cards. A card’s interior uses spacing and hairline dividers to create substructure.
- A target must have at least a 44 × 44pt interactive hit area; 48pt is preferred for primary bottom controls.

### 4.4 Depth and material

Depth establishes a spatial relationship. It should be perceptible rather than ornamental.

| Level | Treatment | Allowed use |
|---|---|---|
| Base | Solid surface, no shadow | Page, reading canvas, standard rows |
| Grouped | Tone difference or hairline divider | Settings / library groups |
| Raised | Solid or adaptive material, 1px border, shadow 1 | Composer, dock, featured card |
| Overlay | Material/solid fallback, shadow 2, scrim | Sheet, dialog, menu |

Suggested light-mode shadows, implemented centrally rather than per component:

```ts
raised: {
  shadowColor: '#17181C',
  shadowOpacity: 0.08,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 5 },
  elevation: 3,
},
overlay: {
  shadowColor: '#17181C',
  shadowOpacity: 0.16,
  shadowRadius: 28,
  shadowOffset: { width: 0, height: 12 },
  elevation: 8,
},
```

- In dark mode, reduce shadow reliance and separate layers through surface luminance and borders.
- No more than one raised surface may overlap another in the normal viewport.
- Blur is allowed only for a floating dock, composer shell, compact scrolling header, or modal; it cannot reduce text contrast or hide a meaningful state.

### 4.5 Icons and brand expression

- Use one outlined icon family with rounded terminals. Keep standard actions at 20–22pt and metadata glyphs at 14–16pt.
- Use familiar system metaphors. Icons are never the only visible explanation of a non-obvious destructive or operational action.
- Brand expression comes from the XOPC mark, careful indigo use, agent avatars, and motion — not from decorative icon backgrounds.
- A color-filled icon tile is reserved for a high-value route in a grouped settings/list context or a meaningful status. It is not the default leading treatment for every row.

## 5. Component grammar

### 5.1 Lists and rows

Choose the lightest structure that communicates the data.

| Pattern | Use | Treatment |
|---|---|---|
| Plain list | Notes, sessions, files, search results | White/solid page or grouped base; row divider; title + one preview/meta line |
| Grouped list | Settings, library shortcuts, compact choices | Shared panel; 1px internal dividers; only outer corners rounded |
| Featured card | Continue item, task summary, goal mission | One content-rich object with elevated surface; no adjacent duplicate cards |
| Timeline / transcript | Chat, activity | Vertical rhythm and date/context separators; messages are not all boxed |
| Action grid | Only 2–4 genuinely equal visual destinations | Large enough tap target, one label; never used as a substitute for information architecture |

Standard row contract:

- Full row opens the primary object; trailing action never steals the row tap.
- Primary title: one line. Preview: at most two lines when the object needs it. Metadata: one coherent line.
- Leading avatar/icon is optional and purposeful. Trailing metadata aligns consistently.
- Long press enters selection. Swipe exposes reversible quick actions. Multi-select disables swipe.
- Press feedback changes surface and may translate 1pt; it must be immediate and stable.

### 5.2 Controls

| Control | Appearance | Use |
|---|---|---|
| Primary button | Indigo fill, white label, 48pt high, `radius.xl` | One main commit action |
| Secondary button | Elevated/outlined neutral surface | Alternative or non-destructive task action |
| Tertiary button | Text or bare icon | In-context secondary action |
| Icon button | Bare by default; material circle only over content | Navigation / familiar frequent action |
| Chip / filter | Text-first; selected state uses `accent.soft` | Filter or temporary selection, not general navigation |
| Toggle | Native platform control | Boolean preference only |

- A screen or sheet has one primary button at most.
- Do not make a text action pill-shaped when an inline label or familiar glyph communicates it better.
- Loading state preserves the control’s width and intent; disable repeated commits, but preserve cancel where safe.
- Destructive actions use the error role and are separated from safe choices.

### 5.3 Inputs, search, and composer

- Inputs have clear visible labels when context is not self-evident; placeholders never carry required meaning.
- Search appears at the point of search, receives focus predictably, and can be cleared in one tap.
- Composer text remains 16pt minimum and grows up to a defined max before scrolling internally.
- Attachment and voice affordances have a visible pressed/recording state; voice recording has time, cancel, and send feedback.
- Input, keyboard, and safe-area motion move as one system. Never stack two keyboard avoidance mechanisms.

### 5.4 Sheets, dialogs, and menus

- Bottom sheets have a fixed visual rhythm: 6pt grabber, title/description if needed, grouped content, safe-area-aware actions.
- Use an action sheet for a short choice; use a full screen for long editing or configuration.
- Dialog copy states the consequence and names the affected object. The safe action is visually quieter than the destructive action.
- A menu is for contextual commands, not a replacement for information architecture.

### 5.5 States and feedback

| State | Required response |
|---|---|
| Pressed | Immediate surface/scale change; no network wait |
| Loading list | Skeleton that preserves row geometry |
| Saving / streaming | Local status near the content; preserve draft and task context |
| Success | Inline completion or short toast; haptic only for a meaningful change |
| Error | Plain-language recovery action; preserve user input |
| Offline | Persistent but compact availability indication; explain what remains local |
| Selection | Count in header, visible checks, batch bar replacing normal dock |
| Empty | One explanation, one next action, no decorative illustration by default |

Toasts confirm reversible, global, or transient outcomes. Field validation stays inline. Banners are reserved for a condition that changes the entire screen’s usefulness.

## 6. Motion, haptics, and direct manipulation

Motion must explain a relationship: where content came from, what changed, or what remains active. It is not a source of personality by itself.

| Token | Duration | Curve / use |
|---|---:|---|
| `press` | 80ms | ease-out; surface and 0.98–0.99 scale |
| `quick` | 140ms | ease-out; icon, selection, small reveal |
| `standard` | 220ms | system-like ease / spring; sheet, compact header, dock |
| `focus` | 320ms | gentle spring; home-to-Ask-AI transition |
| `ambient` | 600ms max | only low-amplitude streaming/progress feedback |

- Respect `useReducedMotion`; remove transform, blur, and nonessential repeating motion when enabled.
- The Home → Ask AI overlay retains a hint of the home surface behind it, then returns to the same home context. It must feel like entering focus, not launching a separate app.
- List rows do not bounce on scroll. Swipe action reveal follows the finger directly and includes a label, icon, semantic color, and an undo/confirmation path.
- Use haptics for entering selection, committing a capture, sending a message, completing a meaningful action, and warning before a destructive state. Do not haptic ordinary navigation or every tap.
- Route transitions should use platform-native behavior wherever Expo Router provides it; custom motion is only for the workspace overlay and small state continuity.

## 7. Accessibility and adaptive design

Accessibility is a product requirement and a measure of craft.

- Support Dynamic Type and Android font scaling through every content and control state. Verify at the largest supported text setting.
- Maintain at least 44 × 44pt hit targets, visible focus order, accessible names/roles/states, and a logical VoiceOver reading order.
- Do not encode status only through color: pair color with icon, label, position, or text.
- Primary text and essential controls meet WCAG AA contrast. Tertiary color is never used for an essential instruction or action.
- Respect reduced motion, reduce transparency, increased contrast, system appearance, screen reader, hardware keyboard, and landscape/wide layouts.
- Keep primary reach actions in the middle/lower reachable area when task context permits, while respecting safe areas and keyboard.
- Every async state is announced visually and, where appropriate, to assistive technologies.
- Test light/dark mode, small iPhone, large iPhone, iPad/wide web, slow network, offline state, keyboard, and long localized strings.

## 8. Implementation rules

### 8.1 Source of truth

- Theme colors, spacing, radii, typography, and elevations live in `src/theme/tokens.ts` and are exposed through `useTheme()`.
- `src/theme/paper-theme.ts` maps those semantic values into React Native Paper. It must not introduce a competing MD3 visual system.
- Motion comes from `src/motion/`; all custom animated components use the reduced-motion helper.
- Reuse `FloatingHeader` only after it is upgraded into the two header modes above. Do not clone a local header to bypass the design system.
- Continue using the established `SwipeableRow`, selection, batch action, toast, bottom sheet, keyboard, and safe-area primitives. Improve the primitives centrally rather than inventing feature-local variants.
- User-facing content remains in the i18n catalog.

### 8.2 Token migration requirements

The present token file contains the v2 palette and an 8pt-only spacing scale. The v3 values above require a deliberate, app-wide migration; do not change a few raw values and call the result a redesign.

1. Add semantic roles (`grouped`, `elevated`, `pressed`, and central elevation recipes) without removing compatibility aliases in the same change.
2. Update Paper mapping and shared primitives first.
3. Migrate home, headers, composer/dock, lists, and sheets in the order below.
4. Remove hardcoded component values (including card-specific shadows, `fontSize`, and radius) as each primitive is migrated.
5. Verify both schemes and every state with screenshots on iOS and Android before removing old aliases.

### 8.3 Current audit findings

These observations come from the current implementation and directly motivate the target system:

| Area | Current issue | Target correction |
|---|---|---|
| Header | `FloatingHeader` renders a filled circle + central filled pill + filled circle for almost every destination | Introduce large/compact native header modes; material only when floating over content |
| Home | Continue, attention, agents, and library are all similarly weighted sections, plus a centered note FAB | Make home an action-ranked briefing; use a single bottom dock and hide empty attention |
| Collections | Note, inbox, and session objects are nearly all bordered, rounded cards with shadows | Make plain/grouped rows the default; preserve featured cards only for intentional summaries |
| Note rows | Title, chips, tag chips, status chip, task chip, pin chip, and timestamp compete in one compact card | Show title, preview, one metadata line, and only high-value tags/states |
| Chat | The feature has rich state, which risks a visual stack of controls and blocks | Make transcript reading-first and progressively disclose operational/AI detail |
| Tokens | Documentation and code palettes have diverged, and individual components still own visual constants | Use the v3 semantic table and central recipes before broad screen migration |

## 9. Delivery sequence and acceptance criteria

This design phase intentionally does not change runtime UI. Implement in small, reviewable passes with visual QA after each pass.

### Phase 0 — baseline and decisions

- Capture iOS and Android screenshots of Home, Inbox, Notes, Session list, Chat, Settings, offline gateway, selection mode, and one long-text case in both themes.
- Confirm typography/font-scaling constraints in the Expo SDK 56 environment.
- Inventory component-local hardcoded visual values and duplicate header/card styles.
- Lock the v3 token table and approve any platform-specific material fallback before code work.

### Phase 1 — foundation and primitives

- Migrate theme tokens, Paper mapping, elevations, motion, and accessibility defaults.
- Replace `FloatingHeader` with large and compact modes.
- Create shared plain row, grouped list, featured card, and bottom dock/composer shells.
- Verify focus, safe-area, keyboard, dark mode, reduced motion, and 44pt targets.

### Phase 2 — product-defining paths

1. Workspace home and Ask AI transition.
2. Inbox capture and list.
3. Notes list and note detail/editor.
4. Chat transcript, composer, and progressive AI/tool states.

These are the screens that establish the product’s perceived quality. Do not dilute the pass by restyling settings first.

### Phase 3 — system completion

- Migrate Sessions, Files, Settings, Gateways, Agents, Automations, Sharing, onboarding/pairing, dialogs, sheets, toasts, and all empty/error/offline states.
- Standardize selection, swipe, undo, search, and list loading behavior across every collection.
- Remove obsolete v2 styles and compatibility aliases once no screen uses them.

### Definition of done

A redesigned screen is complete only when all of the following are true:

1. It has one clear primary action and no decorative competing accent.
2. It uses shared semantic tokens and primitives; no local color/radius/shadow/type scale is invented.
3. Regular data uses rows or grouped lists; cards are intentional and not nested.
4. Light and dark designs preserve the same hierarchy and state meaning.
5. Default, pressed, loading, empty, error, offline, disabled, selected, and long-content states are designed.
6. Dynamic Type, 44pt targets, screen reader labels, reduced motion, keyboard, safe area, and gesture behavior are verified.
7. The result has been visually compared to the approved baseline on iOS and Android, at compact and large phone widths.
8. The screen feels more legible and more alive through hierarchy and feedback, not through added decoration.

The final experience should feel inevitable: open XOPC, immediately see what matters, capture or ask with one confident action, and return to work without managing the interface.
