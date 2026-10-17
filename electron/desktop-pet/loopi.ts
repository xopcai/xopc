import { renderLoopiSvg } from '../../src/pets/loopi-artwork.js';

import type { DesktopPetDefinition } from './types.js';

export const loopiDesktopPet: DesktopPetDefinition = {
  id: 'loopi',
  name: 'Loopi',
  description: 'A calm companion that helps with work and leaves important decisions to you.',
  i18nKey: 'loopi',
  builtin: true,
  renderer: 'loopi',
  canvasWidth: 400,
  canvasHeight: 400,
  thumbnailDataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderLoopiSvg('thumbnail'))}`,
  persona: { tone: 'warm', warmth: 0.85, energy: 0.3, humor: 0.1 },
};
