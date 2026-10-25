// Upgrade SDK and driver together, after reviewing native protocol fixtures.
export const COMPUTER_DRIVER_VERSION = '0.36.0';
export const WINDOWS_COMPUTER_DRIVER_FILES = {
  'cua-driver.exe': '99291d8d6a4851d9df96da5813a1ef2761f2c9d3a59d2a7036c0bf4d09652f4f',
  'cua-driver-uia.exe': '4d895d122ccdc6f78b631f573f63d7d5e3b8ff339ea03e2dcb31a014bcdcdc88',
  'cua-cursor-theme.exe': '5f6eb9cc2f9aa7ae69b959815df633cbbd84d7c522ada00ffaa3614027b91384',
  'cua_driver_sdk.dll': '1ed2591691e48e9a58689a4a32f7d19b936020f386122b4d33723940c54b3477',
  'cua_driver_node_runtime.node': 'da0ec5a0b3321634754d76a9858def3c0f69c8fd8e6fb2c4be8a2d2aee83c8d8',
};

export function computerDriverRelease(platform, arch) {
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return {
    assetId: '646667377', archive: 'driver.tar.gz',
    sha256: '584e44435a26f5aa90c2f0097242307efbd63e843fc3f61072147c1963b0e592',
    files: { 'cua-driver': '87c7e782e69703d95524e4ceb7ceba03c8a159caabf1f1ce2c118eade7d2a5ec' },
    cacheDirectory: '',
  };
  if (platform === 'win32' && arch === 'x64') return {
    assetId: '646668361', archive: 'driver.zip',
    sha256: 'f8c47024b626f4e0e70f8428d2998df39e4879110c5722a29d5fd03e367353ad',
    files: WINDOWS_COMPUTER_DRIVER_FILES, cacheDirectory: 'win32-x64',
  };
  throw new Error(`Unsupported Computer Use driver target: ${platform}-${arch}`);
}
