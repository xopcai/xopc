#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: docker-release-smoke.sh IMAGE VERSION}"
version="${2:?Expected package version required}"
container="xopc-release-smoke-${RANDOM}-${RANDOM}"

trap '
  status=$?
  if (( status != 0 )); then docker logs "$container" 2>/dev/null || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
' EXIT

docker run --rm "$image" xopc --version
docker run --rm -e EXPECTED_VERSION="$version" "$image" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { readFileSync } from "node:fs";
  import { execFileSync } from "node:child_process";
  import { DatabaseSync } from "node:sqlite";
  import sharp from "sharp";
  import { rgPath } from "@vscode/ripgrep";
  await import("silk-wasm");
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).version, process.env.EXPECTED_VERSION);
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE smoke (value TEXT)");
  db.close();
  await sharp({ create: { width: 1, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  execFileSync(rgPath, ["--version"]);
  execFileSync("ffmpeg", ["-version"]);
'

docker run -d --name "$container" -e XOPC_NO_RESPAWN=1 -e XOPC_SKIP_CHANNELS=1 \
  "$image" sh -ec '
    node -e '\''require("node:fs").writeFileSync(process.env.XOPC_CONFIG_PATH, JSON.stringify({ gateway: { auth: { mode: "token", token: "release-smoke-token" } } }))'\''
    exec xopc gateway --bind loopback --port 18790 --no-hot-reload
  '

for ((attempt = 0; attempt < 60; attempt++)); do
  if docker exec "$container" node --input-type=module -e '
    const response = await fetch("http://127.0.0.1:18790/api/health", { signal: AbortSignal.timeout(2000) });
    const body = await response.json();
    process.exit(response.ok && body.ready === true ? 0 : 1);
  ' >/dev/null 2>&1; then
    echo "Docker smoke passed: $image"
    exit 0
  fi
  test "$(docker inspect --format '{{.State.Running}}' "$container")" = true
  sleep 1
done
echo 'Gateway did not become ready' >&2
exit 1
