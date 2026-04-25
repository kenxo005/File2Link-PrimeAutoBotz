# Build stage
FROM node:18-alpine AS builder

# Install dependencies
RUN apk add --no-cache python3 make g++ ffmpeg

WORKDIR /app

# Copy all files
COPY . .

# Install pnpm
RUN npm install -g pnpm

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build the project
RUN pnpm --filter @workspace/db run push-force && \
    pnpm --filter @workspace/api-server run build

# Runtime stage
FROM node:18-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy built files and node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/pnpm-lock.yaml ./

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8080/api/healthz', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" || exit 1

CMD ["pnpm", "--filter", "@workspace/api-server", "run", "start"]

