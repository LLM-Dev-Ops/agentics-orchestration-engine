# Cloud Run Deployment Preparation

This document describes the Cloud Run deployment for the Agentics Orchestration Engine.

**STATUS: Deployment-ready, NOT deployed**

---

## Single-Service Architecture

This repository produces **one** Cloud Run service from its container image:

| Service | Name | Purpose | Entry Point |
|---------|------|---------|-------------|
| **A** | `agentics-orchestration-engine` | Synchronous delegation API | `node dist/server.js` |

> **ADR-0001 change.** A second service, `agentics-orchestration-engine-listener`
> (`node dist/ruvector/startup.js`), previously subscribed to `plan_approved`
> events. This service no longer subscribes to any Ruvector decision event —
> `agentics-execution-engine` is the sole subscriber and ruvector-service the
> sole publisher. **The listener service must be undeployed**; its entry point
> no longer exists in the image.

---

## Service A: Orchestration Engine API

### Purpose
HTTP server that accepts simulation requests, obtains execution acceptance from
Ruvector, and delegates all work to the four Layer-3 Agentics Cores.

### Entry Point
```bash
npm start
# or
node dist/server.js
```

### Behavior
- Starts HTTP server on `PORT` (default: 8080)
- Exposes health checks: `/health`, `/healthz`
- Exposes `POST /v1/simulate`, `POST /api/v1/runs`, `GET /api/v1/runs/:id`
- Stateless request-response model
- Requests execution acceptance from Ruvector; does NOT mint `execution_id`
- Does NOT subscribe to or publish decision events
- **Fails closed at startup** if any Layer-3 Core URL is unset

### Expected Startup Log
```
[contracts] loaded
[cores] endpoints resolved
SERVICE_NAME=agentics-orchestration-engine
SERVICE_VERSION=0.2.0
AGENTICS_ROLE=orchestrator
AGENTICS_MODE=orchestration
Using RUVECTOR_SERVICE_URL: https://ruvector.example.com
Using SECURITY_CORE_URL: https://security-core.example.com
Using DATA_CORE_URL: https://data-core.example.com
Using GOVERNANCE_CORE_URL: https://governance-core.example.com
Using AUTOMATION_CORE_URL: https://automation-core.example.com
Listening on port 8080
```

### Fail-Closed Startup

With any Core URL missing, the process exits non-zero naming the variable:

```
[contracts] loaded
[cores] Layer-3 Core service URLs are not configured (missing: SECURITY_CORE_URL). This service delegates all execution to the real Cores and refuses to start without them.
[cores] offending variables: SECURITY_CORE_URL
```

Audit every deployment target for all four variables before rolling out.

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

## Environment Variable Matrix

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | HTTP server port |
| `NODE_ENV` | No | `production` | Node environment |
| `SECURITY_CORE_URL` | **Yes** | - | LLM-Security-Core base URL |
| `DATA_CORE_URL` | **Yes** | - | LLM-Data-Core base URL |
| `GOVERNANCE_CORE_URL` | **Yes** | - | LLM-Governance-Core base URL |
| `AUTOMATION_CORE_URL` | **Yes** | - | LLM-Automation-Core base URL |
| `CORE_REQUEST_TIMEOUT_MS` | No | `30000` | Per-Core request timeout |
| `RUVECTOR_SERVICE_URL` | **Yes** | - | Ruvector service base URL |
| `RUVECTOR_CREDENTIALS_REF` | No | `ruvector-api-key` | Secret Manager reference |
| `RUVECTOR_CLIENT_ID` | No | auto-generated | Client identifier |
| `RUVECTOR_TIMEOUT_MS` | No | `10000` | Ruvector request timeout |
| `RESULTS_INDEX_URL` | No | - | Results-index base URL |
| `PLATFORM_API_KEY` | No | - | Bearer credential for results-index and Cores |
| `ENVIRONMENT` | No | `production` | Environment tag on result packets |

---

## Secret Consumption Contract

### Supported Modes

#### Mode 1: Direct Environment Variables
```bash
export RUVECTOR_API_KEY=your-secret-api-key
export RUVECTOR_SERVICE_URL=https://ruvector.example.com/api
```

#### Mode 2: Google Secret Manager Reference
```bash
export RUVECTOR_CREDENTIALS_REF=projects/my-project/secrets/ruvector-api-key/versions/latest
```

The default `EnvironmentSecretManager` converts the secret reference path to an environment variable:
- `projects/my-project/secrets/ruvector-api-key/versions/latest` → `RUVECTOR_API_KEY`

For native Secret Manager integration, provide a custom `SecretManager` implementation.

### Secret Requirements

| Secret Name | Used By | Purpose |
|-------------|---------|---------|
| `ruvector-api-key` | API service | Authentication to Ruvector API |

### Fail-Fast Behavior

Credential loading fails fast:

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

---

## IAM Requirements

| Role | Resource | Purpose |
|------|----------|---------|
| `roles/secretmanager.secretAccessor` | Secret Manager secrets | Access Ruvector API credentials |
| `roles/run.invoker` | Layer-3 Core services | Invoke the four Cores |

### Example IAM Binding
```bash
gcloud secrets add-iam-policy-binding ruvector-api-key \
  --member="serviceAccount:agentics-orchestration-engine@PROJECT_ID.iam.gserviceaccount.com" \
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

### Identity
Ruvector is the sole authority for accepting execution and minting identity
(agentics-enforcement ADR-004). This service mints no `execution_id` and
declares no plan approved.

### Delegation
Every `/v1/simulate` request delegates to all four Cores with span propagation
under Ruvector's root span. A Core that returns no nested span hierarchy fails
the delegation — flat results are rejected rather than recorded as genuine work.

### Lifecycle Event Emission

| Event | When |
|-------|------|
| `simulation_execution_started` | Immediately when execution begins |
| `simulation_execution_completed` | After successful completion |
| `simulation_execution_failed` | After execution failure |

---

## Container Image

```dockerfile
# Build stage
FROM node:20 AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/ ./packages/
RUN cd packages/agentics-contracts && npm install && npm run build
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN cp -r src/contracts/simulation dist/contracts/

# Production stage
FROM node:20-slim AS production
WORKDIR /app
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages ./packages
RUN npm ci --omit=dev
COPY --from=builder --chown=node:node /app/dist ./dist
ENV NODE_ENV=production
USER node

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
- [ ] `npm run check:no-mock-cores` passes
- [ ] `npm test` passes
- [ ] Container builds successfully
- [ ] API service starts with `node dist/server.js`
- [ ] Service exits non-zero when any `*_CORE_URL` is missing
- [ ] All four Layer-3 Cores are reachable from the service account
- [ ] The `agentics-orchestration-engine-listener` service is undeployed

---

## Confirmation

**Single-Service Architecture:** Confirmed
- Service A: `agentics-orchestration-engine` (API)
- The former listener service is retired (ADR-0001)

**Entrypoint Defined:** Confirmed
- API: `node dist/server.js`

**Environment Variables Documented:** Confirmed
- Required: the four `*_CORE_URL` variables and `RUVECTOR_SERVICE_URL`

**Secret Usage Contract:** Confirmed
- Direct env vars or Secret Manager reference, fail-fast on missing secrets

**IAM Requirements:** Confirmed
- `roles/secretmanager.secretAccessor`, `roles/run.invoker`

**NO DEPLOYMENT PERFORMED:** Confirmed
- This document describes preparation only
- No `gcloud` commands executed
- No infrastructure changes made
