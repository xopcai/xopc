---
name: algorithmic-art
description: Design reproducible, interactive generative-art studies as self-contained browser artifacts or workspace assets.
metadata:
  xopc:
    emoji: "✨"
    requires_tools:
      - write_file
      - image_generate
---

# Generative art

Use this skill when the user asks for algorithmic or generative visual work. Build an expressive system,
not a static image with random decoration.

## Creative process

1. Extract a compact conceptual seed from the brief: mood, reference, material, motion, or tension.
2. Describe the system in plain language: its rules, forces, palette logic, and source of variation.
3. Implement a reproducible artifact with a visible seed and a small set of meaningful parameters.
4. Make the controls change the system's behaviour, not just cosmetic values.
5. Inspect several seeds and tune density, contrast, performance, and composition before delivery.

## Artifact rules

- Prefer a self-contained HTML artifact for interactive work. It may load a stable public rendering
  library when necessary, but all artwork logic and controls belong in the artifact.
- Keep the interface neutral and xopc-branded; do not reproduce another product's styling or marks.
- Include seed navigation, reset, regeneration, and export when creating an interactive browser piece.
- Use seeded pseudo-randomness so the same seed and parameters produce the same result.
- Respect the user's visual references without claiming an artist's identity or copying protected work.

## Included resources

- `templates/viewer.html`: a neutral, self-contained starting point with seed and export controls.
- `templates/generator-template.js`: a compact seeded-system scaffold.
