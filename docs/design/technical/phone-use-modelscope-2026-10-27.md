# ModelScope credential verification — 2026-10-27

The user's Token is stored in the local Gateway credential system and in the
xopc-platform encrypted provider key pool. Local credential resolution was
verified against the supplied Token without recording it. Temporary Token files
and the remote provisioning bundle were removed.

After account email verification:

| Actual API request | Result |
|---|---|
| `Qwen/Qwen3.5-35B-A3B`, text authentication smoke test | HTTP 200, `OK`, normal stop |
| `iic/GUI-Owl-1.5-8B-Instruct` | HTTP 400, `has no provider supported` |
| `iic/GUI-Owl-1.5-8B-Think` | HTTP 404 |
| Authenticated `GET /v1/models` | HTTP 200, 37 models, no GUI-Owl entries |

Endpoint: `https://api-inference.modelscope.cn/v1`. The account verification
restriction is resolved. Availability of hosted GUI-Owl remains an upstream
blocker, independently of credential storage or protocol support. A downloadable
model page is not proof of API-Inference availability.

Cloud connection: ModelScope · Phone Use, with unpublished `phone-gui-owl` and
`phone-gui-owl-thinking` drafts. No GUI-Owl service was published or marked as
passing live model validation. No native phone input was dispatched for these
unsupported models. The tested Doubao BYOK phone primary remains selected.

The successful Qwen call establishes Token/API access only; it does not establish
Qwen or GUI-Owl phone-control capability. GUI-Owl requires an actually available
hosted endpoint and live screenshot/phone acceptance before activation.

Follow-up: the official project's Bailian hosted entry was found and accepted as
`gui-plus-2026-02-26`; see [the GUI-Plus acceptance record](phone-use-guiplus-2026-10-27.md).
It uses a Bailian credential independently of the unavailable ModelScope IDs.

Subsequent requested cleanup removed both unavailable GUI-Owl entries and their
Cloud drafts while preserving the ModelScope Token for ordinary inference. See
[the cleanup record](phone-preset-cleanup-2026-10-27.md) for the final live list.
