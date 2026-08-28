# Images and vision

xopc can understand images attached to Chat and generate new images when a compatible model and credential are configured.

## Understand an image

1. Open Chat and attach a supported image.
2. Ask a specific question, such as “Extract the totals from this receipt” or “Describe the layout problems in this screen.”
3. Review the answer against the original image, especially for small text, numbers, and safety-critical details.

The selected Chat model may process the image directly, or xopc may use a separate vision-capable model. If neither is configured, the Agent will report that image understanding is unavailable.

## Configure image generation

1. Open **Settings → Capabilities → Image**.
2. Choose a provider and generation model.
3. Add the requested credential.
4. Assign the model to the intended Agent.
5. Generate a small test image.

Use `xopc image status` and `xopc image providers` from a terminal to inspect availability.

## Generate or edit

Describe subject, composition, style, aspect ratio, and important exclusions. For an edit, attach the source image and state exactly what should change and what must remain unchanged. Editing support varies by provider and model.

Generated files are saved in the configured workspace or media output location. Confirm the destination before using them in another application.

## Privacy and accuracy

- Images sent to a cloud model are processed under that provider's policy.
- Remove sensitive metadata and crop unrelated private content before uploading.
- Do not rely on vision output alone for identity, legal, financial, or medical decisions.
- Verify text, measurements, and counts manually.
- Check provider terms before generating trademarked, copyrighted, or personal likeness content.

## Troubleshooting

- Attachment is rejected: check format and size limits.
- Agent cannot see the image: choose a vision-capable model and start a new Session.
- Generation is unavailable: configure an image provider and assign its model to the Agent.
- Edit behaves like a new image: the selected model may not support image editing.
- Output is missing: check the Agent workspace and Gateway logs.
