# Phone model configuration

Phone action model is models.phoneUse, separate from models.chat. Do not replace the chat
model. Inspect the current Agent's effective model: an Agent override can differ from the
global Phone settings. Let the owner edit that specific override when it exists.

Phone settings list supported real models. XOPC Cloud phone routing can use existing Cloud
login when available; do not promise a Cloud login grants balance or service availability.
Otherwise guide the owner to Intelligence → Models for an independently configured compatible
provider. A model needs image input, the supported chat protocol and an explicit Phone action
profile; generic vision support or a model name is insufficient. Never select internal mock.

API keys and OAuth login go through product settings, never chat. Save the Phone model in
Settings → Phone Use, or the current Agent's Phone override if intentionally configured.
Use the product's Test model connection action: it sends a synthetic image and reports protocol
and grounding separately, with possible model charges. It does not inspect or operate a phone.
A saved reference and credential status are not proof of a working provider. Real device
acceptance is still required and sends screenshots to the selected Phone model.
