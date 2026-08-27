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
  "schemaVersion": 2,
  "id": "my-pet",
  "name": "My Pet",
  "description": "A helpful animated companion.",
  "persona": {
    "tone": "warm",
    "warmth": 0.8,
    "energy": 0.35,
    "humor": 0.1,
    "phrases": {
      "greeting": ["我在。"],
      "success": ["处理好了。"],
      "waiting": ["到你决定了，我先停在这里。"],
      "error": ["这一步没走通，前面的内容还在。"]
    }
  },
  "thumbnail": "thumbnail.png",
  "canvasWidth": 96,
  "canvasHeight": 96,
  "animations": {
    "idle": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 6, "fps": 6, "loop": true, "offsetX": 0, "offsetY": 0 },
    "sleep": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 6, "fps": 6, "loop": true, "offsetX": 0, "offsetY": 96 },
    "wake": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": false, "offsetX": 0, "offsetY": 192 },
    "greet": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": false, "offsetX": 0, "offsetY": 288 },
    "prepare": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": false, "offsetX": 0, "offsetY": 384 },
    "research": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 480 },
    "read": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 576 },
    "create": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 672 },
    "execute": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 768 },
    "wait": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": true, "offsetX": 0, "offsetY": 864 },
    "success": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 8, "fps": 12, "loop": false, "offsetX": 0, "offsetY": 960 },
    "concern": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 8, "fps": 12, "loop": false, "offsetX": 0, "offsetY": 1056 },
    "pet": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": false, "offsetX": 0, "offsetY": 1152 },
    "pickedUp": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": false, "offsetX": 0, "offsetY": 1248 },
    "released": { "src": "pet.png", "frameWidth": 96, "frameHeight": 96, "frameCount": 10, "fps": 10, "loop": false, "offsetX": 0, "offsetY": 1344 }
  }
}
```

All fields shown above are required except `canvasWidth`, `canvasHeight`, `fps`, `loop`, `offsetX`, and `offsetY`.

`schemaVersion` must be `2`; earlier manifests and unknown actions are rejected. `persona` is optional. Numeric traits are clamped to `0..1`. Phrase lists are intended for short, truthful ambient reactions; they must not demand attention, guilt the user, or claim biological needs. Runtime task facts remain system-owned so personality never obscures status accuracy.

Desktop bubbles only display an agent event summary when the event explicitly provides `publicSummary`. Raw assistant text, command output, tool arguments, and error payloads are not treated as safe ambient content.

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
| `sleep` / `wake` | Daily rest rhythm |
| `greet` / `pet` | Warm, user-initiated companionship |
| `prepare` | Planning and getting ready |
| `research` | Search, browsing, and discovery |
| `read` | Reading files and sources |
| `create` | Writing, editing, and composing |
| `execute` | Shell commands and tool execution |
| `wait` | Safely waiting for user input |
| `success` | Completed work |
| `concern` | Errors and blocked work |
| `pickedUp` / `released` | Drag interaction feedback |

## Spritesheet Rules

Each animation describes a horizontal strip of frames.

- `src` is resolved relative to the pet folder.
- `offsetX` and `offsetY` point to the first frame in the source image.
- Each following frame is read by adding `frameWidth` on the x-axis.
- Supported image formats: PNG, JPEG, GIF, WebP, SVG.
- A pet is ignored unless all required actions can be loaded. Settings -> Pet lists invalid custom pet folders with validation details.
