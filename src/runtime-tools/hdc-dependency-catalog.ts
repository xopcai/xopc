import type { PhoneDependencyAsset, PhoneDependencyFile } from './phone-dependency-catalog.js';
import { HDC_VERSION } from './harmony-paths.js';

export const HDC_DISTRIBUTION = {
  package: 'hdw2', version: '2.3.10', url: 'https://www.npmjs.com/package/hdw2/v/2.3.10',
  archiveIntegrity: 'sha512-Kcbz0pfxgeSN3zeB3LcaAERfwWAz3unUtzrG7GgJy8fSUW5rb8Tb8jG13dEjfx8oVv69NaIhDGQk+fyscDT1UQ==',
} as const;

// Audited against the integrity-verified npm archive. Clients fetch only these two host files.
const HDC_FILES: Record<string, readonly PhoneDependencyFile[]> = {
  "darwin-arm64": [
    {
      "targetName": "hdc",
      "filename": "hdc-3.2.0c-hdw2-2.3.10-darwin-arm64-hdc",
      "url": "https://cdn.jsdelivr.net/npm/hdw2@2.3.10/toolchains/mac-arm/hdc",
      "fallbackUrls": [
        "https://unpkg.com/hdw2@2.3.10/toolchains/mac-arm/hdc"
      ],
      "sha256": "441f328329dd9906d6ff7f53674db690913a6bf753bea0a400faa5dca7d9b097",
      "sizeBytes": 6092944
    },
    {
      "targetName": "libusb_shared.dylib",
      "filename": "hdc-3.2.0c-hdw2-2.3.10-darwin-arm64-libusb_shared.dylib",
      "url": "https://cdn.jsdelivr.net/npm/hdw2@2.3.10/toolchains/mac-arm/libusb_shared.dylib",
      "fallbackUrls": [
        "https://unpkg.com/hdw2@2.3.10/toolchains/mac-arm/libusb_shared.dylib"
      ],
      "sha256": "62df81c6c938e505011f175f30cdbeb208984594d4d1ff66fc3950403d1dd790",
      "sizeBytes": 192384
    }
  ],
  "darwin-x64": [
    {
      "targetName": "hdc",
      "filename": "hdc-3.2.0c-hdw2-2.3.10-darwin-x64-hdc",
      "url": "https://cdn.jsdelivr.net/npm/hdw2@2.3.10/toolchains/mac-x86/hdc",
      "fallbackUrls": [
        "https://unpkg.com/hdw2@2.3.10/toolchains/mac-x86/hdc"
      ],
      "sha256": "5daaaec247a75193d3afa31337c9be44c2326a6062adb188abea6a1d7bafb89d",
      "sizeBytes": 6120144
    },
    {
      "targetName": "libusb_shared.dylib",
      "filename": "hdc-3.2.0c-hdw2-2.3.10-darwin-x64-libusb_shared.dylib",
      "url": "https://cdn.jsdelivr.net/npm/hdw2@2.3.10/toolchains/mac-x86/libusb_shared.dylib",
      "fallbackUrls": [
        "https://unpkg.com/hdw2@2.3.10/toolchains/mac-x86/libusb_shared.dylib"
      ],
      "sha256": "621462d23360a5a47e228d9067f98618b27cb39575d774ab79824f086edc4caa",
      "sizeBytes": 176144
    }
  ],
  "linux-x64": [
    {
      "targetName": "hdc",
      "filename": "hdc-3.2.0c-hdw2-2.3.10-linux-x64-hdc",
      "url": "https://cdn.jsdelivr.net/npm/hdw2@2.3.10/toolchains/linux-x86/hdc",
      "fallbackUrls": [
        "https://unpkg.com/hdw2@2.3.10/toolchains/linux-x86/hdc"
      ],
      "sha256": "b3d929c7af4ba6ddc2638cd68f43e833ed4b8a5a54e9d23dde07ac201e73dd1f",
      "sizeBytes": 6129376
    },
    {
      "targetName": "libusb_shared.so",
      "filename": "hdc-3.2.0c-hdw2-2.3.10-linux-x64-libusb_shared.so",
      "url": "https://cdn.jsdelivr.net/npm/hdw2@2.3.10/toolchains/linux-x86/libusb_shared.so",
      "fallbackUrls": [
        "https://unpkg.com/hdw2@2.3.10/toolchains/linux-x86/libusb_shared.so"
      ],
      "sha256": "431e69ebe2f87ac693c3dae032ec82baa3196b9d403139ae9775ccbaf9227887",
      "sizeBytes": 116512
    }
  ],
  "win32-x64": [
    {
      "targetName": "hdc.exe",
      "filename": "hdc-3.2.0c-hdw2-2.3.10-win32-x64-hdc.exe",
      "url": "https://cdn.jsdelivr.net/npm/hdw2@2.3.10/toolchains/win-x86/hdc.exe",
      "fallbackUrls": [
        "https://unpkg.com/hdw2@2.3.10/toolchains/win-x86/hdc.exe"
      ],
      "sha256": "fc71ad9853a6b0d28dbfb95fe2908388f26b1cef07cee835626953093f346b11",
      "sizeBytes": 5480904
    },
    {
      "targetName": "libusb_shared.dll",
      "filename": "hdc-3.2.0c-hdw2-2.3.10-win32-x64-libusb_shared.dll",
      "url": "https://cdn.jsdelivr.net/npm/hdw2@2.3.10/toolchains/win-x86/libusb_shared.dll",
      "fallbackUrls": [
        "https://unpkg.com/hdw2@2.3.10/toolchains/win-x86/libusb_shared.dll"
      ],
      "sha256": "e978bfe2e22f4db7f7afeefa8a9b042cb4cff938830446c86a28a3b46778a3d2",
      "sizeBytes": 208328
    }
  ]
};

export function hdcDependencyAsset(platform: NodeJS.Platform, arch: string): PhoneDependencyAsset | undefined {
  const files = HDC_FILES[`${platform}-${arch}`];
  if (!files) return undefined;
  return { ...files[0]!, kind: 'hdc', version: HDC_VERSION, archive: false, files };
}
