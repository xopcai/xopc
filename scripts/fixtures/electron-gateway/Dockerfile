FROM node:26.12.1-bookworm-slim
WORKDIR /app
COPY pnpm /opt/pnpm
COPY package.json ./
RUN node /opt/pnpm/bin/pnpm.mjs install --prod --ignore-scripts --node-linker=hoisted --no-frozen-lockfile
COPY out out
COPY dist dist
COPY skills skills
RUN mkdir -p /home/node/.xopc && chown -R node:node /home/node/.xopc
ENV XOPC_SQLITE_ASSET_ROOT=/app/out/server XOPC_UI_STATIC_ROOT=/app/dist/gateway/static/root XOPC_TEMPLATE_PATH=/app/out/server/workspace-templates XOPC_BUNDLED_EXTENSIONS_ROOT=/app/dist/electron/extensions XOPC_BUNDLED_SKILLS_ROOT=/app/skills XOPC_STATE_DIR=/home/node/.xopc XOPC_CONFIG_PATH=/home/node/.xopc/xopc.json XOPC_HOME=/home/node/.xopc XOPC_WORKSPACE=/home/node/.xopc/workspace XOPC_SKIP_CHANNELS=1 XOPC_NO_RESPAWN=1 XOPC_LOG_CONSOLE=false XOPC_LOG_FILE=false
USER node
CMD ["node","out/server/index.js","gateway","--bind","lan","--port","18790","--no-hot-reload"]
