# xopc brand assets

`xopc-mark.svg` is the canonical vector trace of the supplied logo. Its orbit and
asymmetric centre geometry are immutable: platform variants may change only the canvas,
colour, material, and uniform scale around this exact mark.

Run `pnpm run assets:brand` from the repository root after changing that source. The
generator creates every consumable asset under `docs/public`, `web/public`,
`apps/mobile-expo/assets`, `electron/resources`, and `packages/browser-ext/icons`.

Do not edit generated files by hand. Use `pnpm run assets:brand:check` in CI or before
committing to confirm the repository has no stale brand assets.

The generator uses three purpose-built compositions rather than applying one square
PNG everywhere:

- **UI mark:** transparent, monochrome artwork for light and dark product surfaces.
- **App icon:** full-bleed, subtly layered artwork for iOS, Android launchers, and PWA
  installation; the operating system supplies the final mask where appropriate.
- **Desktop / badge:** a transparent outer canvas with a rounded desktop tile or circular
  badge, so Windows taskbar and browser toolbar icons never show a blunt black square.

The palette is deliberately compact:

- `#0B0D10` / `#F8FAFC`: app-icon surfaces and high-contrast mark.
- `#111827` / `#F8FAFC`: transparent UI mark on light and dark themes.
- Android uses the white foreground over `#0B0D10`; its monochrome image exposes the
  same alpha silhouette for Android themed icons.

The macOS menu-bar asset remains a transparent template image and is recoloured by the
system. Browser and Windows/Linux tray assets use a white rounded-square badge with an
ink mark, while the mobile and desktop application icons use their own richer composition.
