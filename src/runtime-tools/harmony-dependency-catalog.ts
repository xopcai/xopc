import type { PhoneDependencyAsset } from './phone-dependency-catalog.js';
import { hdcDependencyAsset } from './hdc-dependency-catalog.js';
import { HOSCRCPY_VERSION } from './harmony-paths.js';

export type HarmonyDependencyKind = 'hdc' | 'hoscrcpy' | 'java';
export const PHONE_JAVA_VERSION = '17.0.21.0.11';
// Pinned Corretto resource URLs and official SHA-256 values from corretto.aws.
const JAVA_ASSETS = {
  "darwin-arm64": {
    "filename": "amazon-corretto-17.0.21.0.11-macosx-aarch64.tar.gz",
    "url": "https://corretto.aws/downloads/resources/17.0.21.0.11/amazon-corretto-17.0.21.0.11-macosx-aarch64.tar.gz",
    "sha256": "3cd5a2bdd380a5654aa1ef5eda3032f60021e8e48a0bdd552e8e39b032705732"
  },
  "darwin-x64": {
    "filename": "amazon-corretto-17.0.21.0.11-macosx-x64.tar.gz",
    "url": "https://corretto.aws/downloads/resources/17.0.21.0.11/amazon-corretto-17.0.21.0.11-macosx-x64.tar.gz",
    "sha256": "dca4175d94d404533c4230eff1a64cc3ae9f3919bfdf35902c64bfd4d3bcb70e"
  },
  "linux-x64": {
    "filename": "amazon-corretto-17.0.21.0.11-linux-x64.tar.gz",
    "url": "https://corretto.aws/downloads/resources/17.0.21.0.11/amazon-corretto-17.0.21.0.11-linux-x64.tar.gz",
    "sha256": "8f9a2ddb131ec5317419f2b0769240fe22ce27f8a0ae43f5346d53e1c8aec6a0"
  },
  "linux-arm64": {
    "filename": "amazon-corretto-17.0.21.0.11-linux-aarch64.tar.gz",
    "url": "https://corretto.aws/downloads/resources/17.0.21.0.11/amazon-corretto-17.0.21.0.11-linux-aarch64.tar.gz",
    "sha256": "33412bba53b912b21528150df7cf60c161d10fc3b7dae89cd5383d8f3c0362c0"
  },
  "win32-x64": {
    "filename": "amazon-corretto-17.0.21.0.11-windows-x64-jdk.zip",
    "url": "https://corretto.aws/downloads/resources/17.0.21.0.11/amazon-corretto-17.0.21.0.11-windows-x64-jdk.zip",
    "sha256": "59d6514305f6fab3b18955fb17185562f0a0bbf20e1466eda33a5429f3b31618"
  }
} as const;

export function harmonyDependencyAsset(kind: HarmonyDependencyKind, platform: NodeJS.Platform, arch: string): PhoneDependencyAsset | undefined {
  const key = `${platform}-${arch}`;
  if (kind === 'hoscrcpy') return { kind, version: HOSCRCPY_VERSION, archive: true,
    filename: 'dsh-hos-scrcpy-3.0.2.tgz',
    url: 'https://registry.npmjs.org/@nszzj/dsh-hos-scrcpy/-/dsh-hos-scrcpy-3.0.2.tgz',
    sha256: '955a5f6dfa72cc8e61905fa6960a149e4a75f3167c2984afb1fcc5f4ab99868a' };
  if (kind === 'java') {
    const asset = JAVA_ASSETS[key as keyof typeof JAVA_ASSETS];
    return asset && { ...asset, kind, version: PHONE_JAVA_VERSION, archive: true };
  }
  return hdcDependencyAsset(platform, arch);
}
