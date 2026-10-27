# Sandbench runner image. Build from the repo root:
#   docker build -f runner/Dockerfile -t sandbench-runner .
# SB-13 moves the runtime stage onto the Playwright base with Java and firebase-tools.

# 1. Build the UI so the runner can serve it at the same address as /api.
FROM node:22-bookworm-slim AS ui
WORKDIR /src
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src
# Public Firebase web config only (it ships in every page anyway). No API keys here.
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_APP_ID=""
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=""
ARG VITE_FIREBASE_STORAGE_BUCKET=""
ARG VITE_RUNNER_URL="/api"
RUN npm run build

# 2. Runtime.
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates git python3 tini \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY runner/package.json runner/package-lock.json ./runner/
RUN cd runner && npm ci --omit=dev --no-audit --no-fund
COPY harness ./harness
COPY runner ./runner
# SB-08 memory import and backup, run with `docker compose exec runner node scripts/...`.
COPY scripts/memory-import.mjs scripts/memory-backup.mjs ./scripts/
COPY --from=ui /src/dist ./dist
RUN mkdir -p /srv/sandbench && chown node:node /srv/sandbench
USER node
ENV NODE_ENV=production \
    PORT=8080 \
    SANDBENCH_HOME=/srv/sandbench \
    SANDBENCH_UI_DIR=/app/dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "runner/main.mjs"]
