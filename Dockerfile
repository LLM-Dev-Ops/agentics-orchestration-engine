# Build stage - use full node image for native module compilation
FROM node:20 AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for build)
RUN npm ci

# Copy source code and contracts
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Copy JSON schema files to dist (TypeScript doesn't copy non-ts files)
RUN cp -r src/contracts/simulation dist/contracts/

# Production stage - use slim image for smaller final image
FROM node:20-slim AS production

# Install python3 for native modules that need rebuilding at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built files from builder with proper ownership
COPY --from=builder --chown=node:node /app/dist ./dist

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8080

# Expose port
EXPOSE 8080

# Run as non-root user for security
USER node

# Start the server
CMD ["node", "dist/server.js"]
