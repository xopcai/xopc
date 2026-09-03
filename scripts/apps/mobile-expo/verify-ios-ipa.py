#!/usr/bin/env python3
"""Inspect an exported App Store IPA before upload; never prints signing credentials."""

import argparse
import json
import plistlib
import re
import subprocess
import tempfile
import zipfile
from pathlib import Path


MAIN_ID = "ai.xopc.xopc"
EXPECTED_IDS = {MAIN_ID, MAIN_ID + ".ShareIntake", MAIN_ID + ".ExpoWidgetsTarget"}
APP_GROUP = "group.ai.xopc.xopc"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_plist(path):
    with path.open("rb") as stream:
        return plistlib.load(stream)


def validate_bundle(info, version, build):
    bundle_id = info.get("CFBundleIdentifier")
    require(bundle_id in EXPECTED_IDS, f"Unexpected bundle: {bundle_id}")
    require(info.get("CFBundleShortVersionString") == version, f"Version mismatch: {bundle_id}")
    require(info.get("CFBundleVersion") == build, f"Build number mismatch: {bundle_id}")
    require(bool(re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,2}", build)), "Invalid CFBundleVersion")
    sdk = str(info.get("DTSDKName", ""))
    match = re.fullmatch(r"iphoneos(\d+)(?:\.\d+)*", sdk)
    require(match is not None and int(match.group(1)) >= 26, f"iOS 26+ device SDK required: {bundle_id} ({sdk})")
    return {"bundleId": bundle_id, "version": version, "build": build, "sdk": sdk}


def entitlements(bundle):
    result = subprocess.run(
        ["codesign", "-d", "--entitlements", ":-", str(bundle)],
        check=True, capture_output=True,
    )
    return plistlib.loads(result.stdout)


def inspect_ipa(ipa, version):
    with tempfile.TemporaryDirectory(prefix="xopc-ios-verify-") as directory:
        root = Path(directory)
        # ditto preserves the framework symlinks required by codesign verification.
        with zipfile.ZipFile(ipa) as archive:
            for name in archive.namelist():
                require(not name.startswith("/") and ".." not in Path(name).parts, "Unsafe IPA archive path")
        subprocess.run(["ditto", "-x", "-k", str(ipa), str(root)], check=True, capture_output=True)
        apps = list((root / "Payload").glob("*.app"))
        require(len(apps) == 1, "Expected exactly one app in Payload")
        app = apps[0]
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True, capture_output=True)
        main = read_plist(app / "Info.plist")
        build = str(main.get("CFBundleVersion", ""))
        bundles = [app, *sorted((app / "PlugIns").glob("*.appex"))]
        details = [validate_bundle(read_plist(bundle / "Info.plist"), version, build) for bundle in bundles]
        require({item["bundleId"] for item in details} == EXPECTED_IDS, "Missing main, ShareIntake or Widget target")
        require(main.get("NSAppTransportSecurity", {}).get("NSAllowsArbitraryLoads") is not True, "Unrestricted cleartext networking is enabled")
        for key in ("NSCameraUsageDescription", "NSMicrophoneUsageDescription", "NSPhotoLibraryUsageDescription", "NSContactsUsageDescription"):
            require(bool(str(main.get(key, "")).strip()), f"Missing purpose string: {key}")
        for bundle, detail in zip(bundles, details):
            signed = entitlements(bundle)
            require(signed.get("get-task-allow") is not True, "Development debugging entitlement in release IPA")
            if detail["bundleId"] == MAIN_ID:
                require(signed.get("aps-environment") == "production", "Main app must use production APNs")
                require("applinks:link.xopc.ai" in signed.get("com.apple.developer.associated-domains", []), "Missing Universal Links entitlement")
            if detail["bundleId"] in (MAIN_ID, MAIN_ID + ".ExpoWidgetsTarget"):
                require(APP_GROUP in signed.get("com.apple.security.application-groups", []), "Missing shared Widget App Group")
        manifests = []
        for path in sorted(app.rglob("PrivacyInfo.xcprivacy")):
            manifest = read_plist(path)
            apis = manifest.get("NSPrivacyAccessedAPITypes", [])
            require(isinstance(apis, list), f"Invalid privacy manifest: {path.name}")
            for api in apis:
                require(bool(api.get("NSPrivacyAccessedAPIType")) and bool(api.get("NSPrivacyAccessedAPITypeReasons")), "Required-reason API is missing its reason")
            manifests.append({"path": str(path.relative_to(app)), "accessedAPIs": apis, "tracking": manifest.get("NSPrivacyTracking", False)})
        require(bool(manifests), "No privacy manifests found in the IPA")
        return {
            "bundles": details,
            "privacyManifests": manifests,
            "usesNonExemptEncryption": main.get("ITSAppUsesNonExemptEncryption"),
            "note": "Artifact checks passed. Verify privacy answers, actual API usage, export compliance and App Store Connect processing separately.",
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ipa", type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    try:
        report = inspect_ipa(args.ipa.resolve(), args.version)
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(f"Verified {len(report['bundles'])} bundles and {len(report['privacyManifests'])} privacy manifests.")
    except (ValueError, OSError, zipfile.BadZipFile, plistlib.InvalidFileException, subprocess.CalledProcessError) as error:
        parser.exit(1, f"IPA verification failed: {error}\n")


if __name__ == "__main__":
    main()
