# Agentics Simulation Engine

<p align="center">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js"/>
  <img src="https://img.shields.io/badge/Google_Cloud-4285F4?style=for-the-badge&logo=google-cloud&logoColor=white" alt="Google Cloud"/>
  <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker"/>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0-blue?style=flat-square" alt="Version"/>
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License"/>
  <img src="https://img.shields.io/badge/build-passing-brightgreen?style=flat-square" alt="Build"/>
  <img src="https://img.shields.io/badge/tests-92%20passed-brightgreen?style=flat-square" alt="Tests"/>
</p>

<p align="center">
  <strong>Deterministic enterprise decision simulation engine with contract-enforced validation and multi-layer execution proof.</strong>
</p>

---

## Overview

The Agentics Simulation Engine is a production-grade simulation platform designed for enterprise decision modeling. It provides:

- **Contract-Enforced Validation** - Strict JSON schema validation at the HTTP entry point using Ajv
- **Multi-Layer Execution Proof** - Cryptographic proof of execution across foundational, intelligence, and core layers
- **Deterministic Execution** - Reproducible simulations with controlled time, seeded randomness, and complete audit trails
- **Policy Engine** - Configurable policy evaluation with compliance scoring
- **Resource Isolation** - Strict boundaries preventing simulation from affecting production systems

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        HTTP Entry Point                          │
│                     POST /v1/simulate                            │
├─────────────────────────────────────────────────────────────────┤
│                    Contract Validation                           │
│              (Ajv + simulation/v1/request.schema.json)          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Foundational│  │ Intelligence│  │    Core     │             │
│  │   Layer     │──│   Layer     │──│   Layer     │             │
│  │             │  │             │  │             │             │
│  │ • Context   │  │ • Scenario  │  │ • Step      │             │
│  │ • Clock     │  │   Validation│  │   Execution │             │
│  │ • Resources │  │ • Policy    │  │ • State     │             │
│  │             │  │   Analysis  │  │   Transitions│            │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                     Execution Proof                              │
│          (layersExecuted, layerRecords, proofHash)              │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/agentics-simulation-engine.git
cd agentics-simulation-engine

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Start the server
npm start
```

### Docker

```bash
# Build the image
docker build -t agentics-simulation-engine .

# Run the container
docker run -p 8080:8080 agentics-simulation-engine
```

## API Reference

### Health Check

```bash
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "timestamp": "2026-01-08T07:00:00.000Z"
}
```

### Run Simulation

```bash
POST /v1/simulate
Content-Type: application/json
```

**Request Body:**
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
  },
  "config": {
    "resourceLimits": {
      "maxExecutionTimeMs": 60000,
      "maxMemoryBytes": 536870912,
      "maxConcurrency": 4,
      "maxSnapshots": 100,
      "maxTraceEvents": 10000
    }
  }
}
```

**Success Response:**
```json
{
  "success": true,
  "result": {
    "simulationId": "sim-abc123",
    "status": "success",
    "timing": {
      "startTime": "2026-01-08T07:00:00.000Z",
      "endTime": "2026-01-08T07:00:00.100Z",
      "durationMs": 100
    },
    "executionProof": {
      "layersExecuted": ["foundational", "intelligence", "core", "validation", "artifact"],
      "mandatoryLayersComplete": true,
      "totalExecutionMs": 100,
      "proofHash": { "algorithm": "sha256", "value": "..." }
    }
  }
}
```

**Contract Violation Response:**
```json
{
  "error": {
    "code": "CONTRACT_VIOLATION",
    "message": "Request does not conform to simulation/v1/request.schema.json",
    "details": {
      "violations": [
        {
          "code": "SCHEMA_REQUIRED",
          "message": "must have required property 'scenario'",
          "path": "/",
          "keyword": "required"
        }
      ],
      "schema": "simulation/v1/request.schema.json"
    }
  }
}
```

## Contract Enforcement

All incoming requests are validated against `simulation/v1/request.schema.json` using strict Ajv validation **before** any engine initialization or execution occurs.

### Validation Guarantees

1. **Fail-Fast** - Invalid requests are rejected at the HTTP entry point
2. **No Execution Without Validation** - Engine code never runs on invalid input
3. **Detailed Errors** - Schema violations include path, keyword, and parameters
4. **Strict Mode** - No additional properties allowed, all required fields enforced

## Execution Proof

Every successful response includes a mandatory execution proof demonstrating that required layers were executed:

| Layer | Description |
|-------|-------------|
| `foundational` | Context creation, clock setup, resource limits |
| `intelligence` | Scenario validation, policy analysis, decision making |
| `core` | Step execution, state transitions, event recording |
| `validation` | Post-execution validation (optional) |
| `artifact` | Artifact generation (optional) |

**Mandatory layers**: `foundational`, `intelligence`, `core`

## Deployment

### Google Cloud Run

```bash
# Set project
gcloud config set project YOUR_PROJECT_ID

# Deploy
gcloud run deploy agentics-simulation-engine \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --port 8080
```

### Live Endpoints

| Environment | URL |
|-------------|-----|
| Production | `https://agentics-simulation-engine-275061967156.us-central1.run.app` |
| Development | `https://agentics-simulation-engine-1062287243982.us-central1.run.app` |

## Project Structure

```
src/
├── contracts/           # Contract validation (Ajv schemas)
│   ├── simulation/v1/   # Version 1 schemas
│   │   └── request.schema.json
│   ├── validator.ts     # Ajv validator
│   └── index.ts
├── core/                # Core engine components
│   ├── engine.ts        # Main simulation engine
│   ├── context.ts       # Execution context
│   ├── validation.ts    # Configuration validation
│   ├── lifecycle.ts     # Lifecycle management
│   ├── determinism/     # Deterministic execution
│   ├── isolation/       # Production isolation
│   └── resources/       # Resource limiting
├── scenario/            # Scenario execution
├── policy/              # Policy engine
├── state/               # State management
├── trace/               # Trace collection
├── artifact/            # Artifact generation
├── types/               # TypeScript type definitions
│   ├── execution-proof.ts  # Execution proof types
│   └── ...
├── server.ts            # HTTP server
└── index.ts             # Main exports
```

## Development

```bash
# Run in watch mode
npm run test:watch

# Type checking
npm run typecheck

# Run all validations
npm run validate
```

## Testing

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run determinism tests
npm run test:determinism

# Run with coverage
npm run test:coverage
```

## License

MIT License - see [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with TypeScript and deployed on Google Cloud Run
</p>
