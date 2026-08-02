---
name: hatch-pet
description: Create and install a custom animated xopc desktop pet from a user description.
metadata:
  xopc:
    activates_capabilities:
      - desktop-pet-authoring
---

# Hatch Pet

Use this skill when the user wants to create, customize, refine, or install an xopc desktop pet.

## Conversation flow

Do not jump straight to `create_desktop_pet` when the pet idea is vague. First guide the user with `clarify` so the final pet has a clear visual identity, personality, and action set.

Use at most 3 concise `clarify` calls before creating or updating the pet. Each call should ask one short question. Provide `choices` when useful, set a sensible `default`, and write the question so the user knows they can type their own custom answer instead of picking a listed option.

Recommended questions for a new pet:

1. Base character: ask what kind of pet it should be.
   - Choices: `Tiny robot companion`, `Cute animal mascot`, `Plant or object spirit`, `Describe my own`
   - Default: `Tiny robot companion`
2. Visual mood: ask what style or vibe it should have.
   - Choices: `Soft and cute`, `Techy and energetic`, `Calm and focused`, `Describe my own`
   - Default: `Soft and cute`
3. Signature work behavior: ask which behavior should be most recognizable.
   - Choices: `Creating at a laptop`, `Investigating clues`, `Celebrating completed work`, `Describe my own`
   - Default: `Typing at a laptop`

For an existing pet update, ask only what is missing for the requested refinement:

1. Refinement target: ask what should change.
   - Choices: `Appearance`, `Personality and dialogue`, `Animations and work actions`, `Everything`
   - Default: `Animations and work actions`
2. Update behavior: overwrite the same custom pet by default. Ask about renaming or creating a variant only if the user explicitly requests a separate version.

Skip clarification when the user already supplied enough detail, or when they explicitly asked you to choose. In that case, choose a coherent cute desktop-helper design and proceed.

## Prompt assembly

After clarification, synthesize one complete `prompt` for `create_desktop_pet`. Include:

- The pet's base form, silhouette, colors, face/expression, and visual style.
- Personality and short dialogue tone.
- Required v2 desktop-helper animation ideas: idle/sleep/wake, greeting and petting, preparing, researching, reading, creating, executing, safely waiting, success celebration, concern, and picked-up/released reactions.
- Any user-requested refinements, constraints, or brand cues.
- A note that the pet should read clearly at small desktop size and feel cute, lively, and polished.

Do not expose implementation details to the user unless they ask.

## Tool call

Once the pet concept is clear, call `create_desktop_pet` with:

- `mode`: use `create` for a new pet; use `update` when the user is refining an existing custom pet.
- `petId`: required for `update`; pass the id from Settings, including the `custom:` prefix if present.
- `name`: a short display name when the user provides or implies one.
- `prompt`: the full visual and personality description, including all requested refinements.
- `description`: a concise one-line description for Settings.
- `persona`: always provide a restrained personality profile. Choose `tone`, numeric `warmth`, `energy`, and `humor` values between 0 and 1, plus 2–4 short phrases for greeting, success, waiting, and error. Phrases must be concise, truthful, non-manipulative, and written in the user's language. Never make the pet guilt the user, demand attention, or pretend to have biological needs.

When updating an existing pet, keep the same name unless the user explicitly asks to rename it. After the tool succeeds, tell the user the pet was installed under `~/.xopc/pets` and can be selected from Settings > Pet.
