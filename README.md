# Agentics Orchestration Engine

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white" alt="Google Cloud"/>
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.2.0-blue?style=flat-square" alt="Version"/>
  <img src="https://img.shields.io/badge/license-Proprietary-red?style=flat-square" alt="License"/>
  <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build"/>
  <img src="https://img.shields.io/badge/tests-104%20passed-brightgreen?style=flat-square" alt="Tests"/>
</p>

<p align="center">
  <strong>Pure orchestration conductor that delegates all simulation execution to downstream Agentics Cores via Ruvector acceptance protocol.</strong>
</p>

---

## Overview

The Agentics Orchestration Engine is a **conductor, not an engine**. It receives simulation requests, obtains execution acceptance from Ruvector (the execution substrate and event source of truth), then delegates all actual work to downstream Agentics Cores. It does not execute simulation logic, evaluate policies, compute costs, or generate artifacts internally.

### What this service does

- **Scenario intake** via `POST /v1/simulate`
- **Contract validation** against `simulation/v1/request.schema.json` using Ajv
- **Ruvector acceptance** (blocking) to obtain the canonical `execution_id`, `root_span_id`, and `trace_id`
- **Delegation** to downstream Agentics Cores (Security, Data, Governance, Automation)
- **Span propagation** under Ruvector's root span for distributed tracing
- **Execution graph collation** from core responses

### What this service does NOT do

- Mint `execution_id` (Ruvector does)
- Execute simulation logic
- Evaluate policies (LLM-Security-Core does)
- Compute costs (LLM-Data-Core does)
- Validate governance (LLM-Governance-Core does)
- Generate artifacts (LLM-Automation-Core does)
- Subscribe to or publish `plan_approved` decisions — this is a **synchronous
  delegation service**. Per ADR-0001, `agentics-execution-engine` is the sole
  subscriber and ruvector-service the sole publisher.

## Architecture

```
                         ┌──────────────────────┐
                         │      Ruvector         │
                         │  (execution substrate)│
                         └───────────┬──────────┘
                                     │  accept
                                     │  (blocking)
              ┌──────────────────────┴─────────────────────┐
              │         Agentics Orchestration Engine       │
              │                                            │
              │            ┌────────────┐                  │
              │            │ HTTP API   │                  │
              │            │ (server)   │                  │
              │            │            │                  │
              │            │ POST       │                  │
              │            │ /v1/simulate                  │
              │            └─────┬──────┘                  │
              │                  │                         │
              │     ┌────────────┴─────────┐               │
              │     │  OrchestrationEngine │               │
              │     │  (pure delegation)   │               │
              │     └──────────┬──────────┘                │
              └────────────────┼───────────────────────────┘
                               │
              ┌────────┬───────┴────────┬────────────┐
              │        │                │            │
        ┌─────┴──┐ ┌───┴───┐  ┌────────┴──┐ ┌──────┴─────┐
        │Security│ │ Data  │  │Governance │ │ Automation │
        │ Core   │ │ Core  │  │  Core     │ │   Core     │
        │        │ │       │  │           │ │            │
        │Policy  │ │Cost   │  │Compliance │ │Artifact    │
        │analysis│ │attrib.│  │validation │ │generation  │
        └────────┘ └───────┘  └───────────┘ └────────────┘
```

## Deployment

This repo deploys as a **single Cloud Run service**:

| Service | Cloud Run Name | Entry Point | Role |
|---------|---------------|-------------|------|
| HTTP API | `agentics-orchestration-engine` | `node dist/server.js` | Handles REST requests, validates contracts, orchestrates via Ruvector |

> **ADR-0001.** The former `agentics-orchestration-engine-listener` service
> (`node dist/ruvector/startup.js`) is retired and **must be undeployed**. This
> service no longer subscribes to `plan_approved`; `agentics-execution-engine`
> is the sole subscriber.

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm

### Installation

```bash
npm install
npm run build
npm test
```

### Run locally

```bash
npm start
```

### Docker

```bash
docker build -t agentics-orchestration-engine .

docker run -p 8080:8080 \
  -e RUVECTOR_SERVICE_URL=https://ruvector.example.com \
  -e SECURITY_CORE_URL=https://security-core.example.com \
  -e DATA_CORE_URL=https://data-core.example.com \
  -e GOVERNANCE_CORE_URL=https://governance-core.example.com \
  -e AUTOMATION_CORE_URL=https://automation-core.example.com \
  agentics-orchestration-engine
```

## API Reference

### Health Check

```
GET /health
```

```json
{
  "status": "healthy",
  "version": "0.2.0",
  "timestamp": "2026-02-14T08:00:00.000Z",
  "mode": "orchestration"
}
```

### Run Simulation

```
POST /v1/simulate
Content-Type: application/json
```

**Request:**
```json
{
  "scenario": {
    "scenarioId": "deployment-test",
    "version": { "major": 1, "minor": 0, "patch": 0 },
    "name": "Deployment Test",
    "description": "Test deployment scenario",
    "category": "deployment",
    "tags": ["test"],
    "preconditions": [],
    "setup": [],
    "steps": [
      {
        "stepId": "step-1",
        "name": "Execute Action",
        "order": { "index": 0 },
        "type": "agent_action",
        "config": { "action": "deploy" }
      }
    ],
    "teardown": [],
    "expectations": []
  }
}
```

**Success Response (200):**
```json
{
  "success": true,
  "result": {
    "simulationId": "sim-abc123",
    "status": "success",
    "timing": { "startTime": "...", "endTime": "...", "durationMs": 142 },
    "executionProof": {
      "layersExecuted": ["integration"],
      "mandatoryLayersComplete": true,
      "proofHash": { "algorithm": "sha256", "value": "..." }
    }
  },
  "execution_id": "exec-ruvector-minted-id",
  "execution_metadata": {
    "service": "agentics-orchestration-engine",
    "version": "0.2.0",
    "status": "success",
    "delegation_count": 4
  }
}
```

**Contract Violation (400):**
```json
{
  "error": {
    "code": "CONTRACT_VIOLATION",
    "message": "Request does not conform to simulation/v1/request.schema.json",
    "details": { "violations": [...], "schema": "simulation/v1/request.schema.json" }
  },
  "execution_metadata": { "status": "error", "error_code": "CONTRACT_VIOLATION" }
}
```

### Submit Run Intent

```
POST /api/v1/runs
Content-Type: application/json
```

Forwards the intent to Ruvector's `/v1/accept` and returns the Ruvector-minted
identity. This service mints no identity and declares no plan approved
(agentics-enforcement ADR-004).

**Request:**
```json
{ "simulation_id": "sim-abc123", "plan_id": "plan-1", "simulation_resolution": "aggregate" }
```

**Accepted (202):**
```json
{ "execution_id": "exec-ruvector-minted-id", "status": "accepted", "simulation_resolution": "aggregate" }
```

> **Breaking change (ADR-0001).** This endpoint previously returned a locally
> minted `runId` and published a synthetic `plan_approved` event to Ruvector.
> It now returns Ruvector's `execution_id` and publishes nothing. Callers
> reading `runId` from the 202 body must be updated.

## Orchestration Flow

1. **Contract validation** -- Request validated against JSON schema (fail-fast)
2. **Ruvector acceptance** -- ADR-004 decision envelope sent to `/v1/accept` (blocking)
3. **Execution ID received** -- Ruvector mints canonical `execution_id`, `root_span_id`, `trace_id`
4. **Core delegation** -- All work delegated to downstream cores with span propagation:
   - LLM-Security-Core: policy evaluation
   - LLM-Data-Core: cost attribution
   - LLM-Governance-Core: compliance validation
   - LLM-Automation-Core: artifact generation
5. **Graph collation** -- Results assembled from core responses
6. **Results persistence** -- Written to results-index (if configured)
7. **Response** -- Returned with `execution_metadata` and delegation proof

## Environment Variables

### HTTP API Service

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `8080` | HTTP server port |
| `NODE_ENV` | No | `production` | Node environment |
| `RUVECTOR_ENDPOINT` | No | `http://localhost:8081` | Ruvector API endpoint |
| `RUVECTOR_CREDENTIALS_REF` | No | `ruvector-api-key` | Secret Manager reference |
| `RESULTS_INDEX_URL` | No | -- | URL for persisting results |
| `PLATFORM_API_KEY` | No | -- | API key for results-index and Cores |
| `SECURITY_CORE_URL` | **Yes** | -- | LLM-Security-Core base URL |
| `DATA_CORE_URL` | **Yes** | -- | LLM-Data-Core base URL |
| `GOVERNANCE_CORE_URL` | **Yes** | -- | LLM-Governance-Core base URL |
| `AUTOMATION_CORE_URL` | **Yes** | -- | LLM-Automation-Core base URL |
| `CORE_REQUEST_TIMEOUT_MS` | No | `30000` | Per-Core request timeout |

The four `*_CORE_URL` variables are **fail closed** (ADR-0001): the process exits
with a non-zero status naming the missing variable rather than starting up and
delegating to mocks. There is no mock fallback in any server-reachable path —
`npm run check:no-mock-cores` enforces this.

## Project Structure

```
src/
├── server.ts              # HTTP API server (Service A entry point)
├── index.ts               # Public exports
├── contracts/             # Contract validation (Ajv + JSON schemas)
│   └── simulation/v1/     # v1 request/response schemas
├── core/
│   └── engine.ts          # OrchestrationEngine (pure delegation)
├── ruvector/              # Ruvector integration
│   ├── client.ts          # RuvectorClient (acceptance, lifecycle events)
│   ├── idempotency.ts     # Idempotency guard
│   └── types.ts           # Decision event types, acceptance protocol
├── integration/
│   └── cores/             # Downstream core clients
├── trace/                 # Span propagation
├── types/                 # Shared TypeScript types
├── error/                 # Error types
└── utils/                 # Utilities (hashing, serialization)

packages/
└── agentics-contracts/    # @agentics/contracts (bundled)
```

## Deployment

### Google Cloud Run

```bash
gcloud config set project agentics-dev

gcloud run deploy agentics-orchestration-engine \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --port 8080
```

The former `agentics-orchestration-engine-listener` service must be undeployed:

```bash
gcloud run services delete agentics-orchestration-engine-listener --region us-central1
```

### Live Endpoints

| Environment | URL |
|-------------|-----|
| Development | `https://agentics-orchestration-engine-1062287243982.us-central1.run.app` |

## Development

```bash
npm run typecheck       # Type checking
npm run validate        # typecheck + lint + test
npm run test:watch      # Watch mode
npm run test:unit       # Unit tests only
npm run test:determinism # Determinism tests
npm run test:coverage   # Coverage report
```

## License

Proprietary. All rights reserved by Global Business Advisors. A commercial license is required to use, modify, or distribute this software. Contact sales@globalbusinessadvisors.co for licensing inquiries.
