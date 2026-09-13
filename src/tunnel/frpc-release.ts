// Archive digests: https://github.com/fatedier/frp/releases/download/v0.62.1/frp_sha256_checksums.txt
// Binary digests were extracted only after verifying those release archives.
export const FRPC_VERSION = '0.62.1';
export const FRPC_RELEASES = {
  "darwin_amd64": {
    "archive": "f951a5aa727a4880f32753ba3c41ecc9dee38a63658760354011e71ea83db995",
    "binary": "5ce5258b6ff1a232e9eb8e29247a55badb127e7fc66b5a58c299b442aba2bcb2"
  },
  "darwin_arm64": {
    "archive": "f9fc616d994a87d790504da21c2f942cd4224637d9ade9a67482f3c23c7f2432",
    "binary": "49afde483f55927c3eeac9141cae82857cb2f15b9e9d55f4ac45378e761eabcc"
  },
  "linux_amd64": {
    "archive": "dcf1c62e5862543b6686a8e4c2f430ef636ac33306167f377e7272875020c4d3",
    "binary": "030bff369048a49fce09e44f96e71fab36522394675ab10b2e684c9e3cc0aa26"
  },
  "linux_arm64": {
    "archive": "94c98c19ce181f8e09e0d0cb79c278c31e9ec936eb713826a1ddf4995e7c2155",
    "binary": "3f900ac9b035aac50b117ce5f7c450ca073d3e453448783979e978dc57bc39a9"
  },
  "windows_amd64": {
    "archive": "a12e3b36b81232ad9888b43519a6dbcacc5c8def52f3a6c6e95d4fae6a373c5d",
    "binary": "14cd52ca87fea607852b3a8e194146eeabe6ce87976cd1fc6327b74caebb6c77"
  },
  "windows_arm64": {
    "archive": "da9e79e7cacc5570631196fae2f9e50ae5202521aa8abaf2e6de85b1778086b9",
    "binary": "14b1b4bdd75228dc29dbc3ca264602911242a0e60cb0acb3311eb4926d50cb4b"
  }
} as const;
