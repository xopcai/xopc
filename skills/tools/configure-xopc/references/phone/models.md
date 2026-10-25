# Phone model configuration

Phone actions use models.phoneUse, separately from models.chat. Inspect this Agent's effective
model and its source first. Keep a healthy existing configuration; never replace the chat model.

Use phone_setup models to list compatible real models and configured providers. For a missing
Phone model use set_model {setupId,modelRef:<listed compatible ref>,expectedRevision}. This
bounded tool changes only this Agent's Phone model, preserving chat and all other routes.
Do not use generic agent update or models.chat for Phone setup. Respect a specific user choice;
explain ambiguity between configured compatible models rather than choosing an unrelated provider.
If a healthy different Phone model already exists, replaceExisting:true is only for an explicit
user-requested replacement; reuse it otherwise.
XOPC Cloud phone can reuse an existing Cloud login. A model needs image input, the supported API
and explicit Phone profile. Never use internal mock.

Only new credentials or OAuth require the user's secure product settings. Give a precise link
to Models and explain what to enter there, never request keys in chat. After the user returns,
re-inspect and continue yourself. A saved model or logged-in account does not prove service
availability or free quota. Real acceptance sends Settings screenshots to the selected model
and can incur model costs. On quota exhaustion, close, report release and wait for resolution;
do not silently change providers or enable billing.
