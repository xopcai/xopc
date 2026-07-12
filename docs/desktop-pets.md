# Desktop Pets

Desktop pets are small animated companions shown by the Electron desktop app.

The pet runtime uses one asset protocol: every pet is a folder with a `manifest.json`, a thumbnail, and spritesheet animations for the required actions.

## Folder Layout

Custom pets live under `~/.xopc/pets` by default. The exact path is shown in Settings -> Pet.

```text
<pets-dir>/
  my-pet/
    manifest.json
    thumbnail.png
    pet.png
```

## Manifest

```json
{
  "id": "my-pet",
  "name": "My Pet",
  "description": "A helpful animated companion.",
  "thumbnail": "thumbnail.png",
  "canvasWidth": 96,
  "canvasHeight": 96,
  "animations": {
    "idle": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 6, "fps": 6, "loop": true, "offsetX": 0, "offsetY": 0 },
    "typing": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 96 },
    "toolbox": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 192 },
    "search": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 288 },
    "file": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 384 },
    "terminal": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 480 },
    "browser": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 576 },
    "success": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 8, "fps": 12, "loop": false, "offsetX": 0, "offsetY": 672 },
    "error": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 8, "fps": 12, "loop": false, "offsetX": 0, "offsetY": 768 }
  }
}
```

All fields shown above are required except `canvasWidth`, `canvasHeight`, `fps`, `loop`, `offsetX`, and `offsetY`.

## Creating Pets

Use the chat-driven pet workflow for custom pets:

- Settings -> Pet -> Create in chat opens a new chat prefilled with the `hatch-pet` skill.
- In chat, describe the pet. The skill activates the `desktop-pet-authoring` capability for the current turn only and writes a package under `~/.xopc/pets/<id>`.
- For custom pets, Settings -> Pet -> Refine opens a new chat with the pet id and current concept. The capability can overwrite the same package when the user asks for refinements.

Generated pets use the same strict manifest protocol as hand-authored pets.

## Actions

| Action | Used for |
| --- | --- |
| `idle` | Waiting for work |
| `typing` | Agent start and progress |
| `toolbox` | Generic tool use |
| `search` | Search, weather, finance, sports, and image lookup tools |
| `file` | Reading, writing, editing, or listing files |
| `terminal` | Shell and command execution |
| `browser` | Browser and URL operations |
| `success` | Completed work |
| `error` | Errors and blocked work |

## Spritesheet Rules

Each animation describes a horizontal strip of frames.

- `src` is resolved relative to the pet folder.
- `offsetX` and `offsetY` point to the first frame in the source image.
- Each following frame is read by adding `frameWidth` on the x-axis.
- Supported image formats: PNG, JPEG, GIF, WebP, SVG.
- A pet is ignored unless all required actions can be loaded. Settings -> Pet lists invalid custom pet folders with validation details.
