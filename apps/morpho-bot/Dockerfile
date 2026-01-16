# syntax=docker/dockerfile:1

# Morpho Bot (EREBUS) Dockerfile
# Optimized for pnpm workspace monorepo

FROM node:20-slim AS base

# Install build dependencies for native modules (keccak)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# ============================================
# Dependencies stage - install all deps
# ============================================
FROM base AS deps

# Copy workspace config files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy package.json files for all workspace packages
COPY apps/morpho-bot/package.json ./apps/morpho-bot/
COPY packages/core/package.json ./packages/core/

# Install dependencies (frozen lockfile for reproducibility)
RUN pnpm install --frozen-lockfile --prod=false

# ============================================
# Production stage
# ============================================
FROM base AS runner

ENV NODE_ENV=production

# Install wget for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd --gid 1001 nodejs \
    && useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nodejs

WORKDIR /app

# Copy workspace config
COPY package.json pnpm-workspace.yaml ./

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/morpho-bot/node_modules ./apps/morpho-bot/node_modules

# Copy application source
COPY apps/morpho-bot ./apps/morpho-bot
COPY packages/core ./packages/core

# Change ownership to non-root user
RUN chown -R nodejs:nodejs /app

USER nodejs

# Expose health port (default 4001)
EXPOSE 4001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:4001/health | grep -q 'status' || exit 1

# Run the bot
CMD ["pnpm", "--filter", "@apps/morpho-bot", "start"]
