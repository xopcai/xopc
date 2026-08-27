# XOPC Design Language System

Version 1.1 · Calm Intelligence

> Keep what matters moving. Every visual decision should reinforce movement, alignment, and long-term progress.

---

## 01. Design Philosophy

XOPC is not a chatbot skin and not a generic productivity dashboard. It is a quiet operating surface for an assistant that keeps work moving.

**Core principle: the interface should be quiet.** Intelligence is embedded in the workflow and becomes visible only when it helps the next decision.

The product should communicate:

- **Continuity** — work has context before and after the current screen.
- **Alignment** — signals, state, and next actions point in the same direction.
- **Direction** — the user always knows what can move next.
- **Rhythm** — repeated patterns feel stable over long sessions.
- **Progress** — status matters more than spectacle.

Avoid visual metaphors of robots, magic, gamification, or “AI showing off”.

---

## 02. Brand Personality

XOPC should feel:

- Calm
- Precise
- Thoughtful
- Systematic
- Future-facing
- Trustworthy

XOPC should not feel:

- Playful or toy-like
- Noisy or colorful for its own sake
- Overly emotional
- Cyberpunk / neon / sci-fi cliché
- Gamified
- Like a chat product first

**Reference feeling:** a spacecraft dashboard designed by Apple — clear, disciplined, and quietly advanced.

---

## 03. Visual Archetype

**Calm workstation + directional system.**

Most tools organize information. XOPC maintains momentum. Therefore the UI should emphasize stable surfaces, clean hierarchy, and a small number of directional signals.

Implementation cues:

- Neutral surfaces dominate.
- Blue indicates direction, focus, and primary action.
- Indigo and cyan are intelligence accents, not backgrounds.
- Progress appears as continuous state, not celebration.
- Cards describe the task objective, state, momentum, next action, and health.

---

## 04. Color System

Use color sparingly. Rough target: **90–95% neutral**, **5–10% signal color**.

### Brand colors

| Token | Name | Hex | Purpose |
|---|---|---:|---|
| Primary | Loop Blue | `#3A6BFF` | Direction, trust, focus, primary action |
| Secondary | Loop Indigo | `#5B57FF` | Intelligence, memory, reasoning |
| Accent | Momentum Cyan | `#2ED8FF` | Movement, recommendations, insights |
| Success | Alignment Green | `#2CCB7F` | Healthy alignment, completed progress |
| Warning | Feedback Amber | `#FFB84D` | Attention, review, uncertainty |
| Error | Signal Red | `#FF5D5D` | Failure, risk, destructive action |

### Light theme

| Role | Hex |
|---|---:|
| Background | `#FFFFFF` |
| Surface | `#FAFAFA` |
| Surface Hover | `#F4F6FF` |
| Surface Active | `#EEF2FF` |
| Border | `#ECECEC` |
| Strong Border | `#D8DCE8` |
| Primary Text | `#111111` |
| Secondary Text | `#666666` |
| Tertiary Text | `#999999` |

### Dark theme

| Role | Hex |
|---|---:|
| Background | `#0A0A0A` |
| Surface | `#121212` |
| Surface Hover | `#1A1A1A` |
| Surface Active | `#202020` |
| Border | `#222222` |
| Strong Border | `#333333` |
| Primary Text | `#F5F5F5` |
| Secondary Text | `#A1A1A1` |
| Tertiary Text | `#666666` |

### Signature gradient

Only for brand assets, empty-state illustration details, or rare hero moments. Never use it as the primary application background.

`#3A6BFF → #5B57FF → #2ED8FF`

The gradient should imply flow, direction, movement, and loop continuity.

---

## 05. Typography

### Font stack

- English primary: Inter / system UI
- English secondary display: SF Pro Display where available
- Chinese primary: PingFang SC
- Chinese secondary: HarmonyOS Sans where available
- Code: SF Mono / Menlo / Consolas / monospace

### Typography philosophy

- Large titles, few words.
- Clear hierarchy, generous spacing.
- Titles are tight; body copy is comfortable.
- Use weight and spacing before using color.
- Avoid heavy default bold; `600` is usually enough.

### UI scale

| Level | Typical size | Use |
|---|---:|---|
| Display | 30–36px | Welcome, empty state, major product moments |
| Title | 20–24px | Page titles, dialogs |
| Heading | 16px / 600 | Cards, panels, sections |
| Body | 14–15px | Reading and long-lived UI |
| Caption | 12px | Metadata, timestamps, chips |

---

## 06. Layout Principles

1. **Whitespace creates trust.** Let important decisions breathe.
2. **One screen = one decision.** Every screen should have an obvious next action or state.
3. **Remove non-essential elements.** Density is allowed only when it increases clarity.
4. **Progress beats information volume.** Show momentum, health, and next action before raw detail.

Recommended structure:

- Application shell: stable navigation + calm work surface.
- Focus screens: centered readable column with generous top/bottom space.
- Dense screens: compact rows inside clearly bounded panels.
- Settings screens: grouped cards, short labels, explicit saved / error state.

---

## 07. Core Visual Motif: The Loop

The Loop is not a circle, infinity symbol, or arrow. It is a continuous flowing path.

It represents:

- Direction
- Action
- Feedback
- Alignment
- Returning to direction again

Use the Loop as a conceptual motif in product language and brand assets. In UI components, express it through continuity: connected steps, persistent session state, health rings, and next-action surfaces.

---

## 08. Motion Language

Motion should communicate progress, not excitement.

| Speed | Duration | Use |
|---|---:|---|
| Fast | 120–180ms | Hover, pressed, small reveals |
| Standard | 220–320ms | Panel transitions, route-level soft changes |
| Slow | 400–600ms | Rare page-level or brand moments |

Preferred motion types:

- Flow
- Alignment
- Expansion
- Reveal

Never use bounce, elastic, cartoon-like motion, or animation that delays the task. Always respect `prefers-reduced-motion`.

---

## 09. Product Components

### Loop Card

A primary work object card. It should answer:

- Objective
- Current state
- Momentum
- Next action
- Health

### Loop Feed Item

A feed object for system intelligence. It may contain:

- Insight
- Recommendation
- Reflection
- Decision
- Opportunity

### Loop Health Indicator

Health is `0–100`, but the visual should be a **continuous ring**, not a progress bar alone. Use text only as a supplement.

---

## 10. Icon Language

- Linear outline icons
- 2px stroke
- Rounded corners and caps
- Minimal detail
- Consistent optical size

Core icon concepts: Direction, Loop, Alignment, Momentum, Feedback, Signal, Insight, Agent, Review, Health.

---

## 11. AI Expression

Do not make intelligence feel like a separate character. Avoid labels such as “AI generated this”. Prefer embedded, operational language:

- Suggested Next Step
- Recommended
- Detected Pattern
- Observed Change
- Alignment Risk
- Momentum Opportunity

The system should feel supportive, not performative.

---

## 12. Web UI Theme Implementation

The default Web UI theme uses semantic tokens in `web/src/styles/globals.css`:

- `surface-*` for quiet layered surfaces
- `fg-*` for text hierarchy
- `edge-*` for borders and separators
- `accent` for Loop Blue primary interaction
- semantic `success / warning / danger` only for state

Do not hardcode brand colors inside feature components unless the component is itself a brand asset. Prefer Tailwind semantic utilities such as `bg-surface-panel`, `text-fg-muted`, `border-edge`, `bg-accent`, and `text-accent-fg`.

---

## 13. Emotional Goal

When users open XOPC they should feel:

- Calm
- Clear
- Supported
- Moving forward

Never overwhelmed. Never rushed. Never distracted.
