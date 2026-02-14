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
- **Event-driven listening** for `plan_approved` decisions from Ruvector

### What this service does NOT do

- Mint `execution_id` (Ruvector does)
- Execute simulation logic
- Evaluate policies (LLM-Security-Core does)
- Compute costs (LLM-Data-Core does)
- Validate governance (LLM-Governance-Core does)
- Generate artifacts (LLM-Automation-Core does)

## Architecture

```
                         ┌──────────────────────┐
                         │      Ruvector         │
                         │  (execution substrate)│
                         └──────┬───────┬───────┘
                        accept  │       │  plan_approved
                        ────────┘       └────────
                                │       │
              ┌─────────────────┴───────┴──────────────────┐
              │         Agentics Orchestration Engine       │
              │                                            │
              │  ┌────────────┐       ┌─────────────────┐  │
              │  │ HTTP API   │       │ Event Listener  │  │
              │  │ (server)   │       │ (startup)       │  │
              │  │            │       │                 │  │
              │  │ POST       │       │ Subscribes to   │  │
              │  │ /v1/simulate       │ plan_approved   │  │
              │  └─────┬──────┘       └────────┬────────┘  │
              │        │                       │           │
              │        └───────┬───────────────┘           │
              │                │                           │
              │     ┌──────────┴──────────┐                │
              │     │  OrchestrationEngine │                │
              │     │  (pure delegation)   │                │
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

## Two-Service Deployment

This repo deploys as a **single Docker image with two entry points** on Google Cloud Run:

| Service | Cloud Run Name | Entry Point | Role |
|---------|---------------|-------------|------|
| HTTP API | `agentics-orchestration-engine` | `node dist/server.js` | Handles REST requests, validates contracts, orchestrates via Ruvector |
| Event Listener | `agentics-orchestration-engine-listener` | `node dist/ruvector/startup.js` | Subscribes to `plan_approved` events, triggers orchestration |

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
# HTTP API server
npm start

# Event listener
npm run start:listener
```

### Docker

```bash
docker build -t agentics-orchestration-engine .

# Run API server
docker run -p 8080:8080 agentics-orchestration-engine

# Run event listener
docker run -e RUVECTOR_ENDPOINT=https://ruvector.example.com \
  agentics-orchestration-engine node dist/ruvector/startup.js
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
| `PLATFORM_API_KEY` | No | -- | API key for results-index |

### Event Listener Service

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `RUVECTOR_ENDPOINT` | **Yes** | -- | Ruvector API endpoint |
| `RUVECTOR_API_KEY` | **Yes** | -- | API key for authentication |
| `RUVECTOR_MODE` | No | `polling` | `polling` or `streaming` |
| `RUVECTOR_POLL_INTERVAL_MS` | No | `5000` | Polling interval (ms) |
| `ENGINE_ID` | No | auto-generated | Engine identifier |
| `MAX_CONCURRENT_EXECUTIONS` | No | `5` | Concurrency limit |

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
│   ├── client.ts          # RuvectorClient (connect, poll, emit)
│   ├── execution-listener.ts  # Event-driven listener (Service B)
│   ├── startup.ts         # Listener entry point (Service B)
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

# Deploy HTTP API
gcloud run deploy agentics-orchestration-engine \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --port 8080

# Deploy Event Listener
gcloud run deploy agentics-orchestration-engine-listener \
  --source . \
  --region us-central1 \
  --platform managed \
  --no-allow-unauthenticated \
  --min-instances 1 \
  --timeout 3600 \
  --command node \
  --args dist/ruvector/startup.js
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
