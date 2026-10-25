# Phone dependencies

Inspect readiness dependencies before asking the user to install anything. Use phone_setup install_dependency
{setupId,kind:"adb"|"scrcpy",expectedRevision,repair?:true} for missing or damaged dependencies.
The product downloads pinned official assets with checksum/version validation and verifies them. Installation
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
