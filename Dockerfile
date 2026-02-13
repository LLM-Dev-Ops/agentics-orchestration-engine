# Build stage - use full node image for native module compilation
FROM node:20 AS builder

WORKDIR /app

# Copy package files and local packages
COPY package*.json ./
COPY packages/ ./packages/

# Build the local contracts package first (must exist before npm install resolves it)
RUN cd packages/agentics-contracts && npm install && npm run build

# Install all dependencies (including dev for build)
RUN npm install

# Copy source code
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

# Copy everything needed for npm ci from builder (not context)
# This ensures package-lock.json matches builder's resolved state
# and packages/ includes the built contracts dist/
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages ./packages

# Install production dependencies only
# bundledDependencies ensures @agentics/contracts is copied, not symlinked
RUN npm ci --omit=dev

# Verify @agentics/contracts is installed and resolvable
# This FAILS the image build if contracts cannot resolve
RUN node -e "require.resolve('@agentics/contracts')" \
    && echo '[contracts] resolved in production image'

# Copy built application from builder
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
