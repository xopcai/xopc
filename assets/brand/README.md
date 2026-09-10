# xopc brand assets

`xopc-mark.svg` is the canonical Human–AI Loop mark. Its two segments share one
circle, radius, and stroke width. The arc centre lines use an exact 80:20 ratio:
AI handles the larger execution segment while the blue human segment represents
intention, judgment, and final control.

Run `pnpm run assets:brand` from the repository root after changing that source. The
generator creates every consumable asset under `docs/public`, `web/public`,
`apps/mobile-expo/assets`, `electron/resources`, and `packages/browser-ext/icons`.

Do not edit generated files by hand. Use `pnpm run assets:brand:check` in CI or before
committing to confirm the repository has no stale brand assets.

The generator uses three purpose-built compositions:

- **UI mark:** transparent two-colour artwork that adapts to light and dark surfaces.
- **App icon:** full-bleed background for iOS, Android launchers, and PWA
  installation; the mobile glyph stays within roughly 56% of the canvas so the
  operating system can apply circular, squircle, or adaptive masks without
  crowding the mark.
- **Desktop / badge:** a transparent outer canvas with a rounded desktop tile or
  compact badge, so Windows taskbar and browser toolbar icons remain legible.

The role palette is deliberately compact:

- Light surfaces: AI graphite `#1D1D1F`, human blue `#007AFF`.
- Dark surfaces: AI soft white `#F5F5F7`, human blue `#0A84FF`.
- Monochrome assets are generated only where the platform owns the tint, such as the
  macOS menu-bar template and Android themed icons.
