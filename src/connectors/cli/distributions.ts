import type { CliDistribution } from './types.js';

export const LARK_DISTRIBUTIONS: Record<string, CliDistribution> = {
  "darwin-x64": {
    "url": "https://github.com/larksuite/cli/releases/download/v1.0.96/lark-cli-1.0.96-darwin-amd64.tar.gz",
    "integrity": "sha256-f6bd28263dfc4a4d6c2581657efa6af8e8f92eba22394c9c4d840d4ad1fae65e",
    "archiveEntry": "lark-cli"
  },
  "darwin-arm64": {
    "url": "https://github.com/larksuite/cli/releases/download/v1.0.96/lark-cli-1.0.96-darwin-arm64.tar.gz",
    "integrity": "sha256-124acdf380f72fa4b1b1e8307a0b00ee93217cf9558baca5bc40091304f2adcd",
    "archiveEntry": "lark-cli"
  },
  "linux-x64": {
    "url": "https://github.com/larksuite/cli/releases/download/v1.0.96/lark-cli-1.0.96-linux-amd64.tar.gz",
    "integrity": "sha256-5d1fa96832307b13298fdb11c477ab3f31c3e98026fec585b4b2eb7f63960c36",
    "archiveEntry": "lark-cli"
  },
  "linux-arm64": {
    "url": "https://github.com/larksuite/cli/releases/download/v1.0.96/lark-cli-1.0.96-linux-arm64.tar.gz",
    "integrity": "sha256-a83124bad70ddb5a42c8d10a80e8d52f49913b1cb397c7a0a835bd0ddb65f3e2",
    "archiveEntry": "lark-cli"
  }
};

export const WECOM_DISTRIBUTIONS: Record<string, CliDistribution> = {
  "linux-x64": {
    "url": "https://registry.npmjs.org/@wecom/cli-linux-x64/-/cli-linux-x64-1.3.0.tgz",
    "integrity": "sha512-kJOub+Gg+wa+K4f21pDyrLtaZK/cPOSrYkm1iST/PfrK66urNKHv7GIEtRUcD4WvKL7yxfyl+QwxyNsMixLAAA==",
    "archiveEntry": "package/bin/wecom-cli"
  },
  "darwin-arm64": {
    "url": "https://registry.npmjs.org/@wecom/cli-darwin-arm64/-/cli-darwin-arm64-1.3.0.tgz",
    "integrity": "sha512-DXMSKg3YOF+raHyFeTIFncq3njViWV2dpGltrFvC3Ao6inUFPAbw5mHtgEMFZLlCprmeKshhhOAetn5TqiugjQ==",
    "archiveEntry": "package/bin/wecom-cli"
  },
  "darwin-x64": {
    "url": "https://registry.npmjs.org/@wecom/cli-darwin-x64/-/cli-darwin-x64-1.3.0.tgz",
    "integrity": "sha512-j4Uak8gVfT9/lwDCSwT6RqTKED5YLM818I/DL5U66U45gFds/ztMzWKjmpYbRs7uxE1NzQli/H2/WmD6G27OAg==",
    "archiveEntry": "package/bin/wecom-cli"
  },
  "linux-arm64": {
    "url": "https://registry.npmjs.org/@wecom/cli-linux-arm64/-/cli-linux-arm64-1.3.0.tgz",
    "integrity": "sha512-t2Mww45xF9E2AEO7hWMKfsynLljfnn4ngVcDGljGIhm306wNBheMU7F6n/HNVwu8fNL76uPIH+eoYyL7EVxf+w==",
    "archiveEntry": "package/bin/wecom-cli"
  }
};
