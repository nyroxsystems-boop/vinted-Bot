# Dockerfile for Railway / any container host that deploys blackruby.de.
#
# WHY THIS EXISTS:
# The repo is a 24-workspace npm monorepo. Without an explicit Dockerfile,
# Railway's auto-detector reads `package.json#workspaces` and tries to
# create a separate service per workspace — vinted, wallapop, kleinanzeigen,
# mercari, depop, etc. — none of which are HTTP services Railway can route
# to. The result: 24 broken services in the Railway dashboard.
#
# By providing this Dockerfile at repo root, Railway treats the repo as a
# single containerised app and ignores the workspaces array entirely.
#
# WHAT IT BUILDS:
# Just the marketing site + API. Nothing else. The Tauri shell + bot
# workspaces ship via GitHub Releases (MSI/DMG), not via Railway.

FROM node:24-bookworm-slim AS builder

# Build-essentials for native modules (better-sqlite3 needs gcc + python).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy ONLY what marketing needs. Avoids dragging in 22 bot workspaces.
COPY marketing/package.json marketing/package-lock.json* ./marketing/

WORKDIR /app/marketing

# Install ONLY marketing's dependencies — no workspace resolution against
# the parent repo.
RUN npm install --no-audit --no-fund

# Copy marketing source + build the static site.
WORKDIR /app
COPY marketing/ ./marketing/
WORKDIR /app/marketing
RUN npm run build

# ── Runtime image ────────────────────────────────────────────────────────────
FROM node:24-bookworm-slim

WORKDIR /app/marketing

# Copy everything needed at runtime: node_modules (with native bindings
# compiled for this image's arch), built dist/, and the api/ source.
COPY --from=builder /app/marketing/node_modules ./node_modules
COPY --from=builder /app/marketing/dist ./dist
COPY --from=builder /app/marketing/api ./api
COPY --from=builder /app/marketing/package.json ./

# Persist license-DB across deploys. Railway mounts a Volume at this path
# — without the Volume, every redeploy wipes all license keys.
RUN mkdir -p /app/marketing/data

ENV NODE_ENV=production
# PORT is set by Railway at runtime. Default to 5181 for local docker-run.
ENV PORT=5181

EXPOSE 5181

# tini-style signal handling so SIGTERM from Railway actually stops the
# Node process cleanly (otherwise Railway force-kills after a timeout).
CMD ["node", "--import", "tsx", "api/server.ts"]
