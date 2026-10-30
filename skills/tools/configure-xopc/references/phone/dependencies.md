# Phone dependencies

Inspect readiness dependencies before asking the user to install anything. Use phone_setup install_dependency
{setupId,kind:"adb"|"scrcpy"|"hdc"|"java"|"hoscrcpy"|"harmonyos",expectedRevision,repair?:true} for missing or damaged dependencies.
The product downloads pinned assets with checksum/version validation and verifies them. Explain readiness.distribution and the download size before installation. Installation
happens on the Gateway host, not necessarily the computer displaying this chat.

Local USB/emulator connections require compatible Android Platform Tools (ADB). A cloud
Aliyun direct ADB connection does not need a local ADB executable. scrcpy server supports live
video, continuous touch and Unicode clipboard input for either route. Without it, snapshots
and manual input remain available; do not mark missing video as a failed basic connection.

Install or repair automatically through that tool, then inspect fresh status. Existing ADB can be selected with
an absolute host path and verified version. If managed installation is disabled, explain
that policy and use existing/runtime controls; do not shell-install around it. Downloads may
use a configured proxy or verified offline bundle in Runtime Tools. Do not replace system
ADB keys, kill the shared ADB server, install APKs, switch IMEs, disable security protections,
or claim the dependency is ready until a fresh host check passes.

For USB HarmonyOS choose source harmonyos. kind harmonyos installs all missing HDC, Java and
HOScrcpy components in one bounded action and rechecks each before continuing. HDC provides
screenshots and basic actions; Java 17+ (including javac) and compatible HOScrcpy add live video.
No DevEco Studio is needed. Installations live in xopc user storage and do not modify system PATH
or JAVA_HOME. HDC 3.2.0c is obtained as two host-specific raw files from the pinned third-party hdw2 2.3.10
distribution (about 6 MB), with a fixed size and SHA-256 for each file. Only HDC and its USB
library are downloaded. Do not fetch an SDK, an npm archive, other platforms or run npm scripts.
Both CDN candidates serve the same pinned bytes; failure never falls back to a full SDK. Java uses pinned Amazon Corretto.
HOScrcpy uses the verified 1.0.18-beta SDK from third-party @nszzj/dsh-hos-scrcpy 3.0.2; its
provenance and notices are retained. Do not describe that archive as an official Huawei download.
A partial failure preserves completed components; retry installs only missing ones. Offline bundles
must use the exact catalog filenames and SHA-256. For HDC supply both raw files from its files
list (flat cache filenames), not the former SDK archive. Dependency readiness proves host
preparation only; no phone is accessed by detection/installation. Native video still needs device
compatibility verification after the user connects and authorizes the intended phone.
