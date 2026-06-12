# syntax=docker/dockerfile:1.7

# Multi-stage image for xopc gateway and CLI.
# The build stage uses full Debian for native packages; runtime uses slim and runs as non-root.
ARG XOPC_NODE_IMAGE=docker.io/library/node:22-bookworm
ARG XOPC_NODE_SLIM_IMAGE=docker.io/library/node:22-bookworm-slim
ARG XOPC_PNPM_VERSION=10.25.0

FROM ${XOPC_NODE_IMAGE} AS build
ARG XOPC_PNPM_VERSION

ENV CI=true \
    NODE_ENV=development \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

WORKDIR /app

RUN corepack enable && corepack prepare "pnpm@${XOPC_PNPM_VERSION}" --activate

COPY . .

RUN --mount=type=cache,id=xopc-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile \
      --config.store-dir=/pnpm/store \
      --config.supportedArchitectures.os=linux \
      --config.supportedArchitectures.cpu="$(node -p 'process.arch')" \
      --config.supportedArchitectures.libc=glibc

RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm run build

FROM build AS runtime-assets

ENV CI=true \
    NODE_ENV=production \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN --mount=type=cache,id=xopc-pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm prune --prod \
      --config.store-dir=/pnpm/store \
      --config.supportedArchitectures.os=linux \
      --config.supportedArchitectures.cpu="$(node -p 'process.arch')" \
      --config.supportedArchitectures.libc=glibc && \
    find dist -type f \( -name '*.map' -o -name '*.tsbuildinfo' \) -delete

FROM ${XOPC_NODE_SLIM_IMAGE} AS runtime
ARG XOPC_PNPM_VERSION
ARG XOPC_APT_MIRROR=""

LABEL org.opencontainers.image.source="https://github.com/xopcai/xopc" \
      org.opencontainers.image.url="https://github.com/xopcai/xopc" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.title="xopc" \
      org.opencontainers.image.description="xopc gateway and CLI runtime container image"

ENV NODE_ENV=production \
    HOME=/home/node \
    XOPC_HOME=/home/node \
    XOPC_STATE_DIR=/home/node/.xopc \
    XOPC_CONFIG_PATH=/home/node/.xopc/xopc.json \
    XOPC_WORKSPACE=/home/node/.xopc/workspace \
    XOPC_LOG_DIR=/home/node/.xopc/logs \
    COREPACK_HOME=/usr/local/share/corepack \
    TERM=xterm-256color

WORKDIR /app

RUN --mount=type=cache,id=xopc-bookworm-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=xopc-bookworm-apt-lists,target=/var/lib/apt,sharing=locked \
    if [ -n "$XOPC_APT_MIRROR" ]; then \
      sed -i "s|http://deb.debian.org/debian|$XOPC_APT_MIRROR|g; s|http://deb.debian.org/debian-security|$XOPC_APT_MIRROR-security|g" /etc/apt/sources.list.d/debian.sources; \
    fi && \
    apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl git hostname lsof openssl procps python3 tini && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=runtime-assets --chown=node:node /app/dist ./dist
COPY --from=runtime-assets --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-assets --chown=node:node /app/package.json ./package.json
COPY --from=runtime-assets --chown=node:node /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=runtime-assets --chown=node:node /app/skills ./skills
COPY --from=runtime-assets --chown=node:node /app/docs ./docs
COPY --from=runtime-assets --chown=node:node /app/extensions ./extensions
COPY --from=runtime-assets --chown=node:node /app/packages ./packages

RUN install -d -m 0755 "$COREPACK_HOME" && \
    corepack enable && \
    corepack prepare "pnpm@${XOPC_PNPM_VERSION}" --activate && \
    chmod -R a+rX "$COREPACK_HOME" && \
    ln -sf /app/dist/src/cli/bin.js /usr/local/bin/xopc && \
    chmod 755 /app/dist/src/cli/bin.js && \
    install -d -m 0700 -o node -g node \
      /home/node/.xopc \
      /home/node/.xopc/workspace \
      /home/node/.xopc/logs \
      /home/node/.config/xopc && \
    chown -R node:node /app

# Install additional system packages for skills/extensions when needed.
# Example: docker build --build-arg XOPC_IMAGE_APT_PACKAGES="python3-pip wget" .
ARG XOPC_IMAGE_APT_PACKAGES=""
RUN --mount=type=cache,id=xopc-bookworm-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=xopc-bookworm-apt-lists,target=/var/lib/apt,sharing=locked \
    if [ -n "$XOPC_IMAGE_APT_PACKAGES" ]; then \
      apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $XOPC_IMAGE_APT_PACKAGES && \
      rm -rf /var/lib/apt/lists/*; \
    fi

# Optionally preinstall Chromium for browser automation.
# Example: docker build --build-arg XOPC_INSTALL_BROWSER=1 .
ARG XOPC_INSTALL_BROWSER=""
ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright
RUN --mount=type=cache,id=xopc-bookworm-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=xopc-bookworm-apt-lists,target=/var/lib/apt,sharing=locked \
    if [ -n "$XOPC_INSTALL_BROWSER" ]; then \
      apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
      chown -R node:node "$PLAYWRIGHT_BROWSERS_PATH" && \
      rm -rf /var/lib/apt/lists/*; \
    fi

USER node

EXPOSE 18790

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:18790/api/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "-s", "--"]
CMD ["node", "dist/src/cli/bin.js", "gateway", "--bind", "lan", "--port", "18790"]
