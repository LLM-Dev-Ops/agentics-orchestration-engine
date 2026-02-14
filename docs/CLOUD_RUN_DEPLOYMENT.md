# Cloud Run Deployment Preparation

This document describes the two-service Cloud Run architecture for the Agentics Simulation Engine.

**STATUS: Deployment-ready, NOT deployed**

---

## Two-Service Architecture

This repository produces **TWO separate Cloud Run services** from a single codebase and container image:

| Service | Name | Purpose | Entry Point |
|---------|------|---------|-------------|
| **A** | `agentics-orchestration-engine` | HTTP/RPC simulation execution API | `node dist/server.js` |
| **B** | `agentics-orchestration-engine-listener` | Event-driven execution trigger | `node dist/ruvector/startup.js` |

### Shared Resources
- Same container image
- Same Ruvector credentials
- Same codebase

### Different Resources
- Startup commands
- Environment variable subsets
- Cloud Run service configurations

---

## Service A: Simulation Engine API

### Purpose
HTTP server that exposes the simulation engine for direct invocation by the orchestrator and other internal services.

### Entry Point
```bash
npm start
# or
node dist/server.js
```

### Behavior
- Starts HTTP server on `PORT` (default: 8080)
- Exposes health check endpoints: `/`, `/health`, `/healthz`
- Exposes simulation endpoint: `POST /v1/simulate`
- Stateless request-response model
- Does NOT connect to Ruvector
- Does NOT process plan_approved events

### Expected Startup Log
```
Agentics Simulation Engine server listening on port 8080
Health check: http://localhost:8080/health
Simulate endpoint: POST http://localhost:8080/v1/simulate
```

### Cloud Run Configuration
```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: agentics-orchestration-engine
spec:
  template:
    spec:
      containers:
        - image: gcr.io/PROJECT_ID/agentics-orchestration-engine:TAG
          command: ["node"]
          args: ["dist/server.js"]
          ports:
            - containerPort: 8080
```

---

## Service B: Ruvector Execution Listener

### Purpose
Long-running process that subscribes to Ruvector DecisionEvents and triggers simulation execution when approved plans are detected.

### Entry Point
```bash
npm run start:listener
# or
node dist/ruvector/startup.js
```

### Behavior
- Connects to Ruvector via polling (or streaming)
- Subscribes to `plan_approved` events
- Validates events contain `plan_id` and `simulation_id`
- Enforces idempotency (no duplicate executions)
- Triggers simulation via `SimulationEngine.execute()`
- Emits lifecycle events back to Ruvector:
  - `simulation_execution_started`
  - `simulation_execution_completed`
  - `simulation_execution_failed`
- Does NOT start the HTTP server
- Long-running process (not request-response)

### Expected Startup Logs
```
============================================================
AGENTICS SIMULATION ENGINE - EXECUTION LISTENER
============================================================

Environment:
  RUVECTOR_ENDPOINT: https://ruvector.example.com/api
  RUVECTOR_MODE: polling
  ENGINE_ID: simulation-engine-listener-1
  ASYNC_EXECUTION: true
  MAX_CONCURRENT_EXECUTIONS: 5

Starting execution listener...
[RuvectorClient] Connecting to https://ruvector.example.com/api...
[RuvectorClient] Connected successfully
[RuvectorClient] Starting polling (interval: 5000ms)

============================================================
EXECUTION LISTENER RUNNING
Waiting for plan_approved events from Ruvector...
Press Ctrl+C to stop
============================================================
```

### Example Execution Logs
```
[RuvectorClient] Received event: plan_approved {event_id: 'evt-123', plan_id: 'plan-456', simulation_id: 'sim-789'}
[ExecutionListener] === STARTING SIMULATION EXECUTION === {plan_id: 'plan-456', simulation_id: 'sim-789', tier: 'tier2', mode: 'execute', advisory: false}
[RuvectorClient] Emitting lifecycle event: simulation_execution_started {plan_id: 'plan-456', simulation_id: 'sim-789'}
[ExecutionListener] === SIMULATION EXECUTION COMPLETED === {plan_id: 'plan-456', simulation_id: 'sim-789', status: 'success', duration_ms: 1234}
[RuvectorClient] Emitting lifecycle event: simulation_execution_completed {plan_id: 'plan-456', simulation_id: 'sim-789'}
```

### Cloud Run Configuration
```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: agentics-orchestration-engine-listener
spec:
  template:
    metadata:
      annotations:
        # Long-running service - disable scale-to-zero
        autoscaling.knative.dev/minScale: "1"
    spec:
      # Increase timeout for long-running process
      timeoutSeconds: 3600
      containers:
        - image: gcr.io/PROJECT_ID/agentics-orchestration-engine:TAG
          command: ["node"]
          args: ["dist/ruvector/startup.js"]
```

---

## Environment Variable Matrix

### API Service (`agentics-orchestration-engine`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | HTTP server port |
| `NODE_ENV` | No | `production` | Node environment |

### Listener Service (`agentics-orchestration-engine-listener`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RUVECTOR_ENDPOINT` | **Yes** | - | Ruvector API endpoint URL |
| `RUVECTOR_API_KEY` | **Yes*** | - | API key for Ruvector authentication |
| `RUVECTOR_CREDENTIALS_REF` | No | `ruvector-api-key` | Secret Manager reference |
| `RUVECTOR_CLIENT_ID` | No | auto-generated | Client identifier |
| `RUVECTOR_MODE` | No | `polling` | Subscription mode (`polling` or `streaming`) |
| `RUVECTOR_POLL_INTERVAL_MS` | No | `5000` | Polling interval in ms |
| `RUVECTOR_CONNECTION_TIMEOUT_MS` | No | `10000` | Connection timeout in ms |
| `RUVECTOR_RETRY_MAX_ATTEMPTS` | No | `3` | Max retry attempts |
| `RUVECTOR_RETRY_BACKOFF_MS` | No | `1000` | Retry backoff in ms |
| `RUVECTOR_RETRY_MAX_BACKOFF_MS` | No | `30000` | Max retry backoff in ms |
| `ENGINE_ID` | No | auto-generated | Engine identifier for lifecycle events |
| `ASYNC_EXECUTION` | No | `true` | Execute simulations asynchronously |
| `MAX_CONCURRENT_EXECUTIONS` | No | `5` | Max concurrent executions |
| `NODE_ENV` | No | `production` | Node environment |

*Either `RUVECTOR_API_KEY` or a proper Secret Manager implementation is required.

### Shared (Both Services)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `production` | Node environment |

---

## Secret Consumption Contract

### Supported Modes

#### Mode 1: Direct Environment Variables
Secrets are provided directly as environment variables:
```bash
export RUVECTOR_API_KEY=your-secret-api-key
export RUVECTOR_ENDPOINT=https://ruvector.example.com/api
```

#### Mode 2: Google Secret Manager Reference
Secrets are retrieved via Secret Manager using a reference:
```bash
export RUVECTOR_CREDENTIALS_REF=projects/my-project/secrets/ruvector-api-key/versions/latest
```

The default `EnvironmentSecretManager` converts the secret reference path to an environment variable:
- `projects/my-project/secrets/ruvector-api-key/versions/latest` → `RUVECTOR_API_KEY`

For native Secret Manager integration, provide a custom `SecretManager` implementation.

### Secret Requirements

| Secret Name | Used By | Purpose |
|-------------|---------|---------|
| `ruvector-api-key` | Listener | Authentication to Ruvector API |

### Fail-Fast Behavior

The listener **MUST fail fast** if secrets are unavailable:

```typescript
// From client.ts
if (!value) {
  throw new RuvectorClientError(
    `Secret not found: ${secretRef}`,
    'SECRET_NOT_FOUND',
    `Environment variable ${envName} is not set`
  );
}
```

Expected error output:
```
ERROR: Failed to create execution listener: RuvectorClientError: Secret not found: ruvector-api-key
  code: SECRET_NOT_FOUND
  details: Environment variable RUVECTOR_API_KEY is not set
```

---

## IAM Requirements

### Required Roles for Listener Service

| Role | Resource | Purpose |
|------|----------|---------|
| `roles/secretmanager.secretAccessor` | Secret Manager secrets | Access Ruvector API credentials |

### Example IAM Binding
```bash
# Grant the Cloud Run service account access to secrets
gcloud secrets add-iam-policy-binding ruvector-api-key \
  --member="serviceAccount:agentics-orchestration-engine-listener@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### Secret Manager Secret Setup
```bash
# Create the secret
gcloud secrets create ruvector-api-key \
  --replication-policy="automatic"

# Add the secret value
echo -n "your-api-key-value" | gcloud secrets versions add ruvector-api-key --data-file=-
```

---

## Execution Guarantees

### Idempotency
- Each plan is executed at most once
- `IdempotencyGuard` tracks execution records by `plan_id`
- Records are retained for 24 hours (configurable)
- Idempotency is enforced across restarts via in-memory state
  - Note: For full restart persistence, implement a persistent store

### Duplicate Prevention
```
[ExecutionListener] Idempotency check failed: Plan plan-123 has already been executed successfully
[ExecutionListener] EXECUTION SKIPPED: plan=plan-123, reason=Plan plan-123 has already been executed successfully
```

### Lifecycle Event Emission
All execution outcomes emit events to Ruvector:

| Event | When |
|-------|------|
| `simulation_execution_started` | Immediately when execution begins |
| `simulation_execution_completed` | After successful completion |
| `simulation_execution_failed` | After execution failure |

---

## Container Image

### Single Image for Both Services
Both services use the same container image with different startup commands:

```dockerfile
# Build stage
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN cp -r src/contracts/simulation dist/contracts/

# Production stage
FROM node:20-slim AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder --chown=node:node /app/dist ./dist
ENV NODE_ENV=production
USER node

# Default command (API server) - override for listener
CMD ["node", "dist/server.js"]
```

### Build Command
```bash
docker build -t gcr.io/PROJECT_ID/agentics-orchestration-engine:TAG .
docker push gcr.io/PROJECT_ID/agentics-orchestration-engine:TAG
```

---

## Verification Checklist

Before deployment, verify:

- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Container builds successfully
- [ ] API service starts with `node dist/server.js`
- [ ] Listener service starts with `node dist/ruvector/startup.js`
- [ ] Listener fails fast when `RUVECTOR_ENDPOINT` is missing
- [ ] Listener fails fast when `RUVECTOR_API_KEY` is missing
- [ ] Services do NOT share state (separate processes)

---

## Confirmation

**Two-Service Architecture:** ✅ Confirmed
- Service A: `agentics-orchestration-engine` (API)
- Service B: `agentics-orchestration-engine-listener` (Event listener)

**Entrypoints Defined:** ✅ Confirmed
- API: `node dist/server.js`
- Listener: `node dist/ruvector/startup.js`

**Environment Variables Documented:** ✅ Confirmed
- API service: `PORT`
- Listener service: `RUVECTOR_*`, `ENGINE_ID`, `ASYNC_EXECUTION`, `MAX_CONCURRENT_EXECUTIONS`

**Secret Usage Contract:** ✅ Confirmed
- Direct env vars or Secret Manager reference
- Fail-fast on missing secrets

**IAM Requirements:** ✅ Confirmed
- `roles/secretmanager.secretAccessor`

**NO DEPLOYMENT PERFORMED:** ✅ Confirmed
- This document describes preparation only
- No `gcloud` commands executed
- No infrastructure changes made
