# Mobile Design Language

Version 2.0 - Calm Intelligence for Mobile

This document defines the visual and interaction standards for the mobile application. It is intentionally product-domain neutral: the rules describe structure, behavior, tone, and implementation quality, not business features.

The system is aligned with the broader XOPC design direction: quiet surfaces, precise hierarchy, restrained color, and intelligence expressed through useful state rather than decoration.

---

## 01. Design Philosophy

The mobile interface should feel calm, fast, and capable in the hand. It should reduce cognitive load, keep decisions visible, and make repeated use feel stable over long sessions.

Core principles:

- **Content leads.** Navigation, chrome, and controls support the task without competing for attention.
- **Signals are rare.** Color, motion, haptics, and elevation are reserved for meaning.
- **One hand matters.** Primary actions should sit in reachable zones and remain usable with a thumb.
- **State is explicit.** Loading, success, error, selection, sync, and disabled states must be visible and understandable.
- **Patterns repeat.** Similar objects should behave the same way across screens.
- **Intelligence is embedded.** Assisted behavior should feel operational, not performative.

Avoid:

- Decorative gradients as application backgrounds.
- Large empty marketing-style hero sections inside the app shell.
- Playful, toy-like, gamified, neon, cyberpunk, or magical visual language.
- Competing accent colors.
- Hidden gestures without visible affordances or onboarding.
- Feature-specific interaction inventions when a shared primitive exists.

---

## 02. Mobile Experience Standard

The application should feel like a top-tier native mobile tool:

- Immediate touch response.
- Clear visual feedback after every action.
- Predictable navigation and gesture behavior.
- Stable layout during loading, keyboard changes, and list updates.
- Accessible contrast, hit targets, typography, and reduced-motion behavior.
- Clean light and dark themes with equivalent hierarchy.
- No visible overlap, clipping, jumpy resizing, or crowded text.

Every screen should answer:

1. Where am I?
2. What is the current state?
3. What can I do next?
4. What changed after I acted?

---

## 03. Visual Personality

The interface should feel:

- Calm
- Precise
- Trustworthy
- Systematic
- Modern
- Light in chrome, strong in structure

It should not feel:

- Loud
- Decorative
- Casual to the point of imprecision
- Like a single-purpose messaging product
- Like a generic Material skin
- Like a desktop layout compressed onto a phone

Reference quality: a native productivity surface with the restraint of Apple system apps, the density discipline of high-end professional tools, and the clarity expected from a modern assistant interface.

---

## 04. Color System

Use semantic tokens from `src/theme/tokens.ts`. Components must consume colors through `useTheme()` or mapped theme APIs. Do not hardcode colors in application components except for token-derived transparency values.

Target color balance:

- 90-95% neutral surfaces and text.
- 5-10% signal color.
- Semantic colors only for status, risk, or destructive meaning.

### 4.1 Surface Roles

| Token | Light | Dark | Use |
|---|---:|---:|---|
| `surface.base` | `#FFFFFF` | `#0A0A0A` | App background and grouped screen base |
| `surface.panel` | `#FAFAFA` | `#121212` | Cards, sheets, menus, elevated content |
| `surface.input` | `#FAFAFA` | `#1A1A1A` | Inputs, composers, editable containers |
| `surface.hover` | `#F4F6FF` | `#1A1A1A` | Pressed and hover feedback |
| `surface.active` | `#EEF2FF` | `#202020` | Active selection and strong focus surfaces |

Surface rules:

- Prefer layered surfaces plus borders over heavy shadows.
- In light mode, do not place important white content on a pure white background without a border or spacing boundary.
- In dark mode, separate surfaces with tone and border, not bright outlines.
- Avoid transparent blur as a default container treatment. Use it only when it improves spatial continuity and remains legible.

### 4.2 Text Roles

| Token | Light | Dark | Use |
|---|---:|---:|---|
| `text.primary` | `#111111` | `#F5F5F5` | Titles, body text, primary controls |
| `text.secondary` | `#666666` | `#A1A1A1` | Secondary labels, inactive icons |
| `text.tertiary` | `#999999` | `#666666` | Metadata, placeholders, quiet helper text |
| `text.disabled` | `#B7B7B7` | `#4F4F4F` | Disabled content |
| `text.inverse` | `#FFFFFF` | `#000000` | Text on filled accent controls |

Text rules:

- Use weight and size before using color.
- Do not use low-contrast tertiary text for essential information.
- Placeholders are not labels. Inputs need visible context when ambiguity is possible.

### 4.3 Border Roles

| Token | Light | Dark | Use |
|---|---:|---:|---|
| `border.subtle` | `#F1F1F1` | `#1A1A1A` | Internal dividers and low-emphasis separation |
| `border.default` | `#ECECEC` | `#222222` | Cards, panels, inputs, floating elements |
| `border.strong` | `#D8DCE8` | `#333333` | Focused containers and important boundaries |

Border rules:

- Use `StyleSheet.hairlineWidth` for dividers.
- Use a 1px equivalent for cards, inputs, floating bars, sheets, and menus.
- Do not use thick borders as decoration.

### 4.4 Accent and Semantic Roles

| Token | Light | Dark | Use |
|---|---:|---:|---|
| `accent.primary` | `#3A6BFF` | `#3A6BFF` | Primary direction, selected state, main action |
| `accent.primaryHover` | `#2F55D6` | `#6F91FF` | Hover, pressed, or elevated accent state |
| `accent.selectionBg` | `rgba(58,107,255,0.10)` | `rgba(58,107,255,0.18)` | Selection backgrounds |
| `accent.soft` | `#EEF2FF` | `#151A2B` | Quiet accent panels and focused surfaces |

| Semantic | Light | Dark | Use |
|---|---:|---:|---|
| `success` | `#2CCB7F` | `#2CCB7F` | Completed, healthy, available |
| `warning` | `#FFB84D` | `#FFB84D` | Attention, uncertainty, review needed |
| `error` | `#FF5D5D` | `#FF5D5D` | Error and destructive context |
| `errorBold` | `#E5484D` | `#FF6B6B` | Strong destructive emphasis |
| `info` | `#3A6BFF` | `#6F91FF` | Informational state |

Accent rules:

- Blue is the primary direction and focus signal.
- Secondary intelligence accents may appear only where a distinct assisted state is required. They must not become a second general brand color.
- Destructive actions must use semantic error, not accent blue.
- Success, warning, error, and info colors must not be used as decorative category colors.

---

## 05. Typography

Use the platform system font stack:

- iOS: SF Pro Text / SF Pro Display.
- Android: Roboto.
- Code or fixed-width content: platform monospace.

Use tokenized type from `tokens.typography`.

| Token | Size | Line Height | Weight | Use |
|---|---:|---:|---:|---|
| `display` | 30 | 36 | 600 | Empty states and rare major moments |
| `title` | 20 | 28 | 600 | Screen titles and modal titles |
| `heading` | 17 | 24 | 600 | Section and card headings |
| `body` | 15 | 22 | 400 | Main reading text |
| `ui` | 14 | 20 | 500 | Buttons, controls, inputs, row labels |
| `label` | 13 | 18 | 400 | Secondary labels |
| `caption` | 12 | 17 | 400 | Metadata and timestamps |
| `micro` | 11 | 14 | 500 | Badges and compact annotations |

Typography rules:

- Do not scale font size from viewport width.
- Keep letter spacing at `0` unless a native component requires a platform default.
- Use `600` for emphasis. Reserve `700+` for rare numeric or status emphasis.
- Body copy should use comfortable line height. Control labels should stay compact.
- Multi-line text must wrap cleanly and never overlap adjacent controls.
- Titles should be short. If a title needs explanation, use supporting text below it.

---

## 06. Spacing and Layout

Use the 8pt spacing scale from `tokens.spacing`.

| Token | Value | Use |
|---|---:|---|
| `xxs` | 2 | Optical adjustment only |
| `xs` | 4 | Tight icon/text gaps |
| `sm` | 8 | Compact internal gaps |
| `md` | 12 | Row padding and control groups |
| `lg` | 16 | Default screen horizontal padding |
| `xl` | 24 | Section separation |
| `xxl` | 32 | Large vertical breaks |
| `xxxl` | 48 | Empty-state and focus spacing |

Mobile layout rules:

- Default horizontal screen padding is `16`.
- Lists and scroll content must reserve bottom space for floating controls and safe area.
- Primary controls should sit in reachable lower zones when context allows.
- Do not place persistent primary input at the top of a phone screen unless the screen is specifically search-first.
- Avoid desktop-style side-by-side layouts on compact widths.
- Use stable dimensions for toolbars, icon buttons, rows, checkboxes, counters, and fixed-format tiles so state changes do not shift layout.
- On tablets and wide web, increase content width intentionally. Do not simply stretch phone rows edge to edge.

Recommended mobile shell:

```text
Status bar
Safe-area top
Header / navigation area
Scrollable or fixed content
Floating action / composer / batch area
Safe-area bottom
```

---

## 07. Shape and Radius

Use `tokens.radii`.

| Token | Value | Use |
|---|---:|---|
| `sm` | 6 | Small badges and compact tags |
| `md` | 10 | Chips and compact row elements |
| `lg` | 14 | Cards and dialogs |
| `xl` | 18 | Panels, sheets, larger cards |
| `xxl` | 22 | Buttons, inputs, composers |
| `full` | 9999 | Pills, avatars, circular controls |

Shape rules:

- Use radius to improve touch friendliness, not as decoration.
- Icon-only circular controls should be visually round and have a minimum 44x44 hit target.
- Cards should usually use `lg` or `xl`; avoid oversized card radius in dense lists.
- Inputs and bottom controls may use `xxl` or `full` when the interaction benefits from a pill shape.
- Do not nest cards inside cards. Use sections, dividers, spacing, or panels instead.

---

## 08. Elevation and Depth

Depth should be quiet. Most hierarchy comes from surface tone, spacing, and borders.

| Level | Treatment | Use |
|---|---|---|
| Flat | No shadow, surface only | Page base and static groups |
| Raised | 1px border, subtle shadow | Floating buttons, bottom bars, sticky controls |
| Overlay | Stronger shadow, scrim if modal | Menus, sheets, dialogs |

Default raised shadow:

```ts
{
  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
}
```

Depth rules:

- `shadowOpacity` should normally stay at or below `0.10`.
- Modal overlays may use up to `0.15` when necessary.
- Dark mode should rely more on borders and surface contrast than shadow.
- Avoid stacked shadows from nested elevated components.

---

## 09. Navigation

Navigation must feel native, boring, and reliable.

Header rules:

- Use a consistent header height and alignment within a navigation stack.
- The back action appears in the expected platform location.
- Screen titles should be concise and stable.
- Header backgrounds should match the screen base unless scroll elevation is needed.
- Header actions must be visible, minimum 44x44 hit target, and limited to high-value actions.

Route and transition rules:

- Forward navigation moves to detail or task focus.
- Back returns to the previous context without losing unsaved input silently.
- Modal presentation is reserved for short, interruptive, or contained tasks.
- Destructive confirmation should not be presented as a full screen unless the consequence is complex.

---

## 10. Interaction Model

Touch behavior must be consistent across the app.

### 10.1 Touch Targets

- Minimum hit target: `44x44`.
- Visual controls may be smaller only when transparent padding expands the hit area.
- Rows should make the full row tappable when the row has one primary action.
- Disabled controls remain visible but lower contrast and do not trigger haptics.

### 10.2 Press Feedback

- Use `Pressable` for custom touch surfaces.
- Pressed state should appear immediately through surface, opacity, scale, or highlight.
- Avoid heavy opacity changes that make text hard to read.
- Do not delay primary action feedback until a network request finishes.

### 10.3 Gestures

Use gestures only when they are conventional or visibly taught.

| Gesture | Meaning |
|---|---|
| Tap | Open, activate, or choose |
| Long press | Enter selection mode for list rows |
| Horizontal swipe | Fast reversible row action |
| Pull to refresh | Reload current collection |
| Drag handle | Reorder or resize only when visible |

Gesture rules:

- Do not assign different long-press meanings to equivalent row objects.
- Use a 300ms long-press delay for list selection.
- Put advanced row actions behind visible controls or detail surfaces, not hidden long-press menus.
- Do not allow swipe actions while a list is in multi-select mode.
- Destructive swipe actions need clear color, icon, label, and undo or confirmation depending on severity.
- Gesture thresholds should be forgiving and consistent.

### 10.4 Selection

Selection mode is a distinct app state.

- Entry: long press or explicit select action.
- Header: show selected count and a cancel/close action.
- Rows: show visible selection controls.
- Tap while selecting: toggle selection.
- Bottom area: show batch actions instead of the normal persistent composer/action bar.
- Exit: cancel, back, or completion of the batch action.

### 10.5 Haptics

Haptics should confirm physical state changes, not decorate every tap.

- Light impact: enter selection, successful quick action, toggle important state.
- Warning or notification haptic: destructive confirmation or failed action.
- No haptic: passive navigation, disabled taps, repeated list scrolling.

Always respect platform availability and user settings.

---

## 11. Components and Primitives

This section defines generic component standards. It intentionally avoids feature-specific components.

### 11.1 Rows and List Items

Rows are the core mobile information unit.

- Height should be content-driven but visually stable.
- Primary text uses `body` or `ui`; metadata uses `caption` or `label`.
- Leading icons, avatars, or checkboxes should align optically with the text block.
- Trailing controls must not crowd the primary label.
- Multi-line summaries should clamp where needed to preserve scan speed.
- Swipe actions should use consistent circular buttons, icon plus accessible label, and semantic color.

### 11.2 Cards and Panels

Cards group related content. Panels frame a temporary or elevated surface.

- Use cards for repeated objects, previews, or contained summaries.
- Use full-width sections for page structure.
- Do not place a card inside another card.
- Do not use decorative card grids when a simple list communicates better.
- Cards need a clear tap target if interactive.

### 11.3 Buttons

Button hierarchy:

| Type | Treatment | Use |
|---|---|---|
| Primary | Filled accent | Main action on a screen or modal |
| Secondary | Surface plus border | Alternative action |
| Tertiary | Text or icon only | Low-emphasis action |
| Destructive | Error color | Delete, remove, reset, or irreversible action |

Button rules:

- Primary buttons should be rare, obvious, and not duplicated.
- Icon-only buttons require accessible labels.
- Text must fit at all supported widths and font scales.
- Do not use a text pill where a familiar icon button would be clearer.

### 11.4 Inputs and Composers

Inputs must feel reachable and stable.

- Use `surface.input`, `border.default`, and appropriate radius.
- Composer-style inputs near the bottom must account for safe area and keyboard.
- Placeholder text should be quiet and non-essential.
- Send/submit controls must show disabled, loading, and error states.
- Text entry should not be covered by keyboard transitions.

### 11.5 Sheets, Dialogs, and Menus

Use the lightest container that fits the decision.

- Menu: quick contextual choice.
- Bottom sheet: mobile task with several related options.
- Dialog: short confirmation or blocking decision.
- Full screen: complex task, long input, or multi-step flow.

Rules:

- Destructive actions should be separated from safe actions.
- Sheets and dialogs need clear dismissal behavior.
- Scrims should use `overlay.scrim`.
- Content must remain usable with larger font sizes.

### 11.6 Toasts and Inline Feedback

Feedback should be near the action, brief, and reversible when possible.

- Toasts use `surface.panel`, `border.default`, rounded shape, and subtle elevation.
- Toast text uses `ui` or `body`.
- Toast actions use accent or semantic color according to meaning.
- Use inline errors for field-level validation.
- Use toast for global transient result.
- Use persistent banners only for state that affects the whole screen.

---

## 12. Motion

Motion communicates continuity, progress, and spatial relationship. It must never slow down the task.

| Speed | Duration | Use |
|---|---:|---|
| Instant | 0-80ms | Press feedback and state toggles |
| Fast | 120-180ms | Small reveals, row actions, opacity changes |
| Standard | 220-320ms | Sheets, route transitions, keyboard-adjacent UI |
| Slow | 400-600ms | Rare onboarding or major state transitions |

Motion rules:

- Prefer fade, slide, reveal, and scale within small ranges.
- Avoid bounce, elastic, cartoon motion, confetti, and looping decoration.
- Animations must be interruptible.
- Respect reduced-motion settings.
- Skeletons or reserved space are preferred over layout popping.

---

## 13. Icons

Icon language should be linear, simple, and consistent.

- Use the project icon library through existing component APIs.
- Default stroke style: outline, rounded caps, visually balanced.
- Common control icon size: 20-24.
- Metadata icon size: 14-18.
- Empty-state icon size: 40-56.
- Icon color defaults to `text.secondary`; active icons may use `text.primary` or `accent.primary`.

Rules:

- Use familiar system metaphors before inventing custom symbols.
- Do not use icons as decoration when they add no meaning.
- Icon-only actions need accessible labels and tooltips where applicable on web.
- Destructive icons need semantic color only in destructive contexts.

---

## 14. Accessibility

Accessibility is part of the design standard, not a later pass.

Requirements:

- Minimum touch target is `44x44`.
- Text must support platform font scaling without overlap.
- Do not encode meaning by color alone.
- Interactive controls need accessible names.
- Loading state must be announced or visibly represented.
- Error messages must identify the problem and recovery action.
- Focus order must follow visual order.
- Reduced motion must be respected.
- Light and dark modes must maintain contrast for primary tasks.

Contrast guidance:

- Primary text on base or panel surfaces should meet WCAG AA for normal text.
- Secondary text may be lower contrast only when non-essential.
- Disabled controls may be low contrast but must remain recognizable.

---

## 15. Safe Area and Keyboard

Mobile layout must respect hardware and system UI.

Safe area rules:

- Use safe-area insets for top and bottom persistent UI.
- Floating bottom controls should sit above the home indicator with at least 12px visual breathing room when possible.
- Scroll content must include enough bottom padding to avoid being hidden behind floating controls.
- Do not rely on absolute pixel offsets without inset-aware helpers.

Keyboard rules:

- Use `react-native-keyboard-controller` for sticky input surfaces.
- Keep focused input and submit action visible during keyboard transitions.
- Avoid stacking multiple keyboard-avoidance systems on the same screen.
- Test with short and long text, hardware keyboard, and predictive text bars.

---

## 16. Loading, Empty, Error, and Offline States

Every async surface needs a designed state model.

Loading:

- Reserve space to prevent layout jumps.
- Prefer skeletons for lists and large content blocks.
- Use spinners only for short, contained waits.

Empty:

- Explain the state in plain language.
- Provide one clear next action when possible.
- Avoid large illustrations unless they communicate the state.

Error:

- State what failed and how to recover.
- Preserve user input where possible.
- Use semantic error color with restraint.

Offline or unavailable:

- Make the unavailable state visible.
- Show what remains usable.
- Retry should be explicit and reachable.

---

## 17. Content and Language

Design copy should be calm and operational.

Rules:

- Use concise English in design specifications and shared UI guidance.
- User-facing strings must come from the localization system.
- Labels should describe the action, not the implementation.
- Avoid hype, personality performance, or vague reassurance.
- Prefer verbs for actions and nouns for destinations.
- Confirmation copy must name the consequence.

Tone:

- Clear
- Direct
- Quiet
- Helpful
- Specific

---

## 18. Implementation Standards

Use the established mobile stack and shared primitives.

Requirements:

- Theme values come from `src/theme/tokens.ts`.
- Components consume theme through `useTheme()` or mapped provider themes.
- React Native Paper must use the project theme mapping, not default MD3 colors.
- User-facing strings use localization.
- Persistent bottom UI uses shared layout constants.
- Shared list, selection, swipe, toast, and batch primitives should be reused before creating new patterns.

Do not:

- Hardcode color, spacing, radius, or font values when a token exists.
- Introduce a second navigation system.
- Introduce a second gesture pattern for equivalent lists.
- Use default platform component styling when it conflicts with this system.
- Add decorative animation, gradients, or illustration to compensate for weak hierarchy.

---

## 19. Quality Checklist

Before shipping a screen or component, verify:

1. Colors come from semantic tokens.
2. Light and dark themes have equivalent hierarchy.
3. Text uses the token type scale.
4. Spacing follows the 8pt scale.
5. Touch targets are at least `44x44`.
6. Primary actions are reachable and visually clear.
7. Loading, empty, error, disabled, selected, and pressed states are designed.
8. Keyboard and safe-area behavior are correct.
9. Gesture behavior matches equivalent objects elsewhere.
10. Destructive actions have confirmation or undo as appropriate.
11. Text fits with larger font settings and small screens.
12. No UI elements overlap, clip, or shift unexpectedly.
13. Motion is short, interruptible, and reduced-motion aware.
14. Icons have accessible labels when they are interactive.
15. The screen works without relying on color alone.

The best version of this design system should feel almost invisible: the user sees the work, understands the state, and moves forward without friction.
