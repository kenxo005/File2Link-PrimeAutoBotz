# Build stage
FROM node:18-alpine AS builder

# Install build dependencies including FFmpeg
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    ffmpeg

WORKDIR /app

# Copy package files
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./

# Install pnpm globally
RUN npm install -g pnpm

# Install dependencies using frozen lockfile
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the project
RUN pnpm --filter @workspace/db run push-force
RUN pnpm --filter @workspace/api-server run build

# Runtime stage
FROM node:18-alpine

# Install FFmpeg in runtime image
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Install pnpm globally
RUN npm install -g pnpm

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/pnpm-lock.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/artifacts ./artifacts
COPY --from=builder /app/lib ./lib

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/api/healthz', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start the bot
CMD ["npx", "pnpm", "--filter", "@workspace/api-server", "run", "start"]
