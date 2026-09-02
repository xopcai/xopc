# Install with Docker

The official container image runs the xopc gateway and CLI without installing Node.js or pnpm on the host.

- Image: `ghcr.io/xopcai/xopc`
- Platforms: `linux/amd64` and `linux/arm64`
- Gateway port: `18790`
- Container state directory: `/home/node/.xopc`

Use `latest` for a simple installation. For production, pin a version shown on the [package page](https://github.com/xopcai/xopc/pkgs/container/xopc), such as `ghcr.io/xopcai/xopc:0.0.201`.

## Requirements

Install Docker Desktop on macOS or Windows, or Docker Engine with the Compose plugin on Linux. Verify the installation:

```bash
docker --version
docker compose version
```

## Quick start

Create a Docker-managed volume so configuration, sessions, logs, and workspaces survive container replacement:

```bash
docker volume create xopc-data
```

Start the gateway. Publishing the port on `127.0.0.1` keeps it accessible only from this computer:

```bash
docker run -d \
  --name xopc-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:18790:18790 \
  -e TZ=UTC \
  -v xopc-data:/home/node/.xopc \
  ghcr.io/xopcai/xopc:latest
```

Wait for the health check:

```bash
docker logs -f xopc-gateway
```

Open [http://127.0.0.1:18790](http://127.0.0.1:18790) and complete model setup in the web console. Press `Ctrl+C` to stop following the logs; the container continues running.

Check the installed version and gateway health at any time:

```bash
docker exec xopc-gateway xopc --version
curl http://127.0.0.1:18790/api/health
```

## Use a host directory instead

A bind mount makes the state files directly available under `~/.xopc` on the host:

```bash
mkdir -p "$HOME/.xopc/workspace"

docker run -d \
  --name xopc-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:18790:18790 \
  -e TZ=UTC \
  -v "$HOME/.xopc:/home/node/.xopc" \
  ghcr.io/xopcai/xopc:latest
```

The container runs as the non-root `node` user (UID `1000`). On Linux, ensure that UID `1000` can write the mounted directory. Prefer the Docker-managed volume from the quick start if host permissions are unfamiliar.

Do not run both examples with the same container name. Remove the old container first when switching storage methods:

```bash
docker rm -f xopc-gateway
```

## Docker Compose

Download the Compose file into an empty directory:

```bash
mkdir xopc-docker
cd xopc-docker
curl -fsSLO https://raw.githubusercontent.com/xopcai/xopc/main/docker-compose.yml
```

Create a `.env` file in that directory:

```dotenv
XOPC_IMAGE=ghcr.io/xopcai/xopc:latest
XOPC_GATEWAY_PORT=18790
XOPC_STATE_DIR=/absolute/path/to/.xopc
XOPC_WORKSPACE=/absolute/path/to/.xopc/workspace
XOPC_TZ=UTC
```

Replace both `/absolute/path/to` values with real absolute paths. For example, a Linux user named `alice` could use `/home/alice/.xopc`. Do not commit `.env` if you later add API keys or tokens to it.

Pull and start the published image:

```bash
docker compose pull xopc-gateway xopc-cli
docker compose up -d xopc-gateway
docker compose ps
```

Useful Compose commands:

```bash
docker compose logs -f xopc-gateway
docker compose run --rm xopc-cli --version
docker compose restart xopc-gateway
docker compose down
```

`docker compose down` removes the containers and network but keeps the host state directory.

## Configure environment variables

The image reads the same provider variables as the normal xopc installation. Pass a local environment file when needed:

```bash
docker run -d \
  --name xopc-gateway \
  --restart unless-stopped \
  --env-file .env \
  -p 127.0.0.1:18790:18790 \
  -v xopc-data:/home/node/.xopc \
  ghcr.io/xopcai/xopc:latest
```

You can also configure providers in the web console. Keep API keys out of shell history, source control, screenshots, and container logs.

## Update

Pull the new image and recreate the container. Data remains in `xopc-data`:

```bash
docker pull ghcr.io/xopcai/xopc:latest
docker rm -f xopc-gateway

docker run -d \
  --name xopc-gateway \
  --restart unless-stopped \
  -p 127.0.0.1:18790:18790 \
  -e TZ=UTC \
  -v xopc-data:/home/node/.xopc \
  ghcr.io/xopcai/xopc:latest
```

With Compose:

```bash
docker compose pull
docker compose up -d
```

For reproducible deployments, change `XOPC_IMAGE` to a specific version instead of `latest`.

## Expose the gateway to other devices

The quick-start command deliberately binds only to localhost. Do not expose an unauthenticated gateway directly to the public internet.

For LAN access, change the port mapping to `-p 18790:18790`, configure a gateway token, and restrict access with a firewall. For remote access, follow [Expose the gateway safely](./how-to/expose-gateway-safely.md) or [Remote access](./remote-access.md).

## Troubleshooting

| Symptom | Check |
| --- | --- |
| `permission denied` under `/home/node/.xopc` | Use the named volume, or allow UID `1000` to write the bind-mounted host directory |
| Port `18790` is already in use | Stop the other service or map another host port, for example `-p 127.0.0.1:18791:18790`; also configure the browser Origin as described below |
| Container exits immediately | Run `docker logs xopc-gateway` |
| Web console does not open | Run `docker ps` and `curl http://127.0.0.1:18790/api/health` |
| Image cannot be pulled | Confirm the tag on the [package page](https://github.com/xopcai/xopc/pkgs/container/xopc) and retry `docker login ghcr.io` if the package is private |
| Local model is unreachable | Containers cannot use host `127.0.0.1`; use `host.docker.internal` where supported |

When the host and container ports differ, for example with `-p 127.0.0.1:18791:18790`, the gateway still builds its default browser Origin allowlist from the container port `18790`. Add the actual browser address to the host-mounted `~/.xopc/xopc.json`; otherwise browser API requests return `403 Origin not allowed`:

```json
{
  "gateway": {
    "corsOrigins": [
      "http://127.0.0.1:18791",
      "http://localhost:18791"
    ]
  }
}
```

After saving the file, run `docker compose restart xopc-gateway`. The Origin must exactly match the scheme, hostname, and port in the browser address bar. Do not use `"*"` on a network-accessible gateway.

To inspect the container without starting the gateway:

```bash
docker run --rm ghcr.io/xopcai/xopc:latest xopc --version
```
