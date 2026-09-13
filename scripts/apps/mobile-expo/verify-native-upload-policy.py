#!/usr/bin/env python3
"""Reject release artifacts that silently selected an unpatched precompiled Expo module."""
import plistlib
import sys
from pathlib import Path
from zipfile import ZipFile

artifact = Path(sys.argv[1])
marker = b'foregroundUploadRedirectPolicy'
with ZipFile(artifact) as archive:
    names = archive.namelist()
    if artifact.suffix in ('.apk', '.aab'):
        native_files = [name for name in names if name.endswith('.dex')]
    elif artifact.suffix == '.ipa':
        info = next(name for name in names if name.startswith('Payload/') and name.count('/') == 2 and name.endswith('.app/Info.plist'))
        executable = plistlib.loads(archive.read(info))['CFBundleExecutable']
        native_files = [info.rsplit('/', 1)[0] + '/' + executable]
        native_files += [name for name in names if '.framework/' in name and name.rsplit('/', 1)[-1] == name.rsplit('/', 2)[-2].removesuffix('.framework')]
    else:
        raise SystemExit('Expected APK, AAB, or IPA')
    if not any(marker in archive.read(name) for name in native_files):
        raise SystemExit('Upload redirect policy missing from native binary; build expo-file-system from patched source')
print('PASS: upload redirect policy is present in the native release binary')
