# Ponder indexer Dockerfile
FROM node:20-alpine

# Install pnpm v9 (v10 blocks esbuild postinstall) and curl (for healthcheck)
RUN npm install -g pnpm@9 && apk add --no-cache curl

WORKDIR /app

# Copy package files and config
COPY package.json pnpm-lock.yaml* .npmrc* ./

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source files
COPY . .

# Expose port
EXPOSE 42069

# Run Ponder in production mode
CMD ["pnpm", "run", "start"]
