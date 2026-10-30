# HarmonyOS USB setup

Choose source harmonyos. Inspect dependencies and explain distribution and download size;
use install_dependency {setupId,kind:"harmonyos",expectedRevision} to install missing host tools
without DevEco Studio. Existing healthy components are reused. Recheck after a failed operation;
completed components remain installed. See dependencies.md for sources, proxy and offline bundles.

Ask the user to connect and unlock the intended phone on the Gateway computer, enable USB debugging
and accept the device authorization. Inspect localDiscovery; only register a discovered online serial
with register_local {setupId,serial,expectedRevision,name?}. Registration keeps an existing device's
policy and grants new phones access to HarmonyOS Settings only. Do not widen app access.

A ready dependency is not proof of a connected phone or working video. Explain screenshot/model
sharing and the Settings-only test, then follow acceptance.md if the user wants verification.
Typing remains manual and gestures execute on release. Do not access the phone merely to install
or detect dependencies, especially when the user needs to keep using it.
