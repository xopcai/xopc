# xopc brand assets

`xopc-mark.svg` is the canonical Human–AI Loop mark. Its two segments share one
circle, radius, and stroke width. The arc centre lines use an exact 80:20 ratio:
AI handles the larger execution segment while the blue human segment represents
intention, judgment, and final control.

The 80:20 split is a direction for collaboration, not a guaranteed ratio for every
task. As understanding, capability, and trust grow, AI can carry more repeatable,
time-consuming, verifiable execution. The person still defines the whole loop:
what matters, which tradeoffs are acceptable, and what the final decision should
be. The time and attention this returns to life are part of the product promise.

Run `pnpm run assets:brand` from the repository root after changing that source. The
generator creates every consumable asset under `docs/public`, `web/public`,
`apps/mobile-expo/assets`, `electron/resources`, and `packages/browser-ext/icons`.

Do not edit generated files by hand. Use `pnpm run assets:brand:check` in CI or before
committing to confirm the repository has no stale brand assets.

The generator uses four purpose-built compositions:

- **UI mark:** transparent two-colour artwork that adapts to light and dark surfaces.
- **Apple app icon:** opaque light, dark, and genuinely grayscale tinted fallbacks
  on a restrained frosted surface. Source layers under
  `apps/mobile-expo/assets/apple-icon-layers/` keep the background, AI segment,
  human segment, and monochrome mark separate for Icon Composer refinement.
- **Android adaptive icon:** separate material background, transparent two-colour
  foreground, and monochrome layer. The mark occupies roughly 59% of the 108dp
  canvas (about 64dp), inside Android's 66dp safe zone.
- **Desktop / badge:** platform-specific macOS, Windows, and Linux renders. Small
  desktop sizes remove hairline decoration and enlarge the mark optically so it
  remains legible in window chrome and taskbars.

Harmony's flat launcher icon uses a dedicated optical scale of approximately 67%
of the canvas with a liquid-glass lens, directional highlights, and a raised
two-tone ring. It intentionally does not copy Android adaptive-layer overscan,
because Harmony consumes a flat launcher resource. Regenerate only Harmony resources with
`node scripts/generate-brand-assets.mjs --target=harmony`.

The role palette is deliberately compact:

- Light surfaces: AI graphite `#1D1D1F`, human blue `#007AFF`.
- Dark surfaces: AI soft white `#F5F5F7`, human blue `#0A84FF`.
- Monochrome assets are generated only where the platform owns the tint, such as the
  macOS menu-bar template and Android themed icons.
