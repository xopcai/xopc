# Local Android and emulators

Reuse an existing enabled registration when it is the intended test phone. Otherwise open
Phone Use → Add phone → Local phone and refresh discovery. Guide one missing step at a time:
use a data-capable USB cable, unlock Android, enable Developer options and USB debugging,
then review the RSA authorization prompt for this Gateway computer on the phone.

unauthorized means the user must decide on that physical prompt; a model cannot grant it.
offline suggests reconnecting/unlocking and checking the cable. No devices found can mean
ADB missing, a charge-only cable, USB mode, a stopped emulator or a remote Gateway mismatch.
Do not advise clearing phone data or revoking all debugging trust as a routine fix.
On Windows the phone vendor may require its own official USB driver; do not guess downloads.

After discovery reports device, the owner adds the exact device and reviews app access.
Selected-only access needs the intended apps explicitly selected; do not widen to all apps.
The setup test needs Android Settings. Do not register a different serial after disconnect.
For an emulator, start the user's chosen AVD through its normal manager. No new emulator,
system image download or app install is silently required. Recheck and then let the owner
select the registered phone and approve basic acceptance in the original chat.
