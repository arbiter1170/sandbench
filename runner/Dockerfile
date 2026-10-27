# Sandbench runner image. Build from the repo root:
#   docker build -f runner/Dockerfile -t sandbench-runner .

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

# 2. Runtime: Playwright's Ubuntu noble image (Chromium and its libraries), pinned to the same
# version as `playwright` in runner/package.json. SB-13 adds Java 21 (Firebase emulators), gh and
# firebase-tools.
FROM mcr.microsoft.com/playwright:v1.64.1-noble
# The runner targets Node 22, like CI; stop here if the base image ever moves off it.
RUN node -v && node -v | grep -q '^v22\.' || { echo "Expected Node 22 in the Playwright base image"; exit 1; }
RUN apt-get update \
 && apt-get install -y --no-install-recommends bash ca-certificates curl git gnupg openjdk-21-jre-headless python3 tini \
 && install -d -m 0755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g --no-audit --no-fund firebase-tools@14.27.0 && npm cache clean --force
WORKDIR /app
COPY runner/package.json runner/package-lock.json ./runner/
# Browsers come from the base image (PLAYWRIGHT_BROWSERS_PATH=/ms-playwright).
RUN cd runner && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev --no-audit --no-fund
COPY harness ./harness
COPY runner ./runner
COPY --from=ui /src/dist ./dist
# pwuser is the base image's non-root user.
RUN mkdir -p /srv/sandbench && chown pwuser:pwuser /srv/sandbench
USER pwuser
ENV NODE_ENV=production \
    PORT=8080 \
    SANDBENCH_HOME=/srv/sandbench \
    SANDBENCH_UI_DIR=/app/dist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "runner/main.mjs"]
