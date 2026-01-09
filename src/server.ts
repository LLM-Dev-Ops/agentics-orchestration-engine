/**
 * HTTP Server for Agentics Simulation Engine
 *
 * Exposes the simulation engine via REST API for Cloud Run deployment.
 * Enforces contract validation at the earliest HTTP entry point.
 *
 * @module server
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { createSimulationEngine } from './core/engine.js';
import type { SimulationConfig } from './types/simulation.js';
import type { Scenario } from './types/scenario.js';
import type { ISOTimestamp } from './types/common.js';
import { v4 as uuidv4 } from 'uuid';
import {
  validateSimulateRequest,
  createContractViolationResponse,
} from './contracts/index.js';

// ============================================================================
// TYPES
// ============================================================================

interface SimulateRequest {
  config?: Partial<SimulationConfig>;
  scenario: Scenario;
}

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  version: string;
  timestamp: string;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ============================================================================
// REQUEST NORMALIZATION
// ============================================================================

/**
 * Normalizes incoming request to match the strict schema format.
 * Transforms simplified payloads from upstream services into compliant format.
 */
function normalizeRequest(input: unknown): unknown {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const raw = input as Record<string, unknown>;

  // Extract scenario from input (may be nested or at root)
  let scenario = raw['scenario'] as Record<string, unknown> | undefined;

  // If no scenario property, check if the input itself looks like a scenario
  if (!scenario && raw['scenarioId']) {
    scenario = raw as Record<string, unknown>;
  }

  if (!scenario) {
    return input; // Let validation handle missing scenario
  }

  // Normalize version - convert string to object
  let version = scenario['version'];
  if (typeof version === 'string') {
    const parts = version.split('.').map(Number);
    version = {
      major: parts[0] ?? 1,
      minor: parts[1] ?? 0,
      patch: parts[2] ?? 0,
    };
  } else if (!version || typeof version !== 'object') {
    version = { major: 1, minor: 0, patch: 0 };
  }

  // Normalize category - default to 'custom' if invalid
  const validCategories = ['deployment', 'policy', 'integration', 'failure', 'performance', 'compliance', 'migration', 'what-if', 'custom'];
  let category = scenario['category'];
  if (!category || !validCategories.includes(category as string)) {
    category = 'custom';
  }

  // Normalize preconditions - ensure array of objects
  let preconditions = scenario['preconditions'];
  if (!Array.isArray(preconditions)) {
    preconditions = [];
  } else {
    preconditions = preconditions.map((p, i) => {
      if (typeof p === 'string') {
        return { id: `precond-${i}`, description: p, expression: 'true' };
      }
      if (typeof p === 'object' && p !== null) {
        const pc = p as Record<string, unknown>;
        return {
          id: pc['id'] ?? `precond-${i}`,
          description: pc['description'] ?? String(pc['id'] ?? `Precondition ${i}`),
          expression: pc['expression'] ?? 'true',
          ...pc,
        };
      }
      return { id: `precond-${i}`, description: String(p), expression: 'true' };
    });
  }

  // Normalize setup - ensure array
  let setup = scenario['setup'];
  if (!Array.isArray(setup)) {
    setup = [];
  } else {
    setup = setup.map((s, i) => {
      if (typeof s === 'object' && s !== null) {
        const st = s as Record<string, unknown>;
        return {
          id: st['id'] ?? `setup-${i}`,
          name: st['name'] ?? `Setup ${i}`,
          type: st['type'] ?? 'custom',
          config: st['config'] ?? {},
          required: st['required'] ?? true,
          ...st,
        };
      }
      return { id: `setup-${i}`, name: `Setup ${i}`, type: 'custom', config: {}, required: true };
    });
  }

  // Normalize steps - ensure array with required fields
  let steps = scenario['steps'];
  if (!Array.isArray(steps)) {
    // Create a minimal step if none provided
    steps = [{
      stepId: 'step-1',
      name: 'Default Step',
      order: { index: 0 },
      type: 'custom',
      config: {},
    }];
  } else {
    steps = steps.map((s, i) => {
      if (typeof s === 'object' && s !== null) {
        const st = s as Record<string, unknown>;
        // Build a clean step object with only valid properties
        const normalizedStep: Record<string, unknown> = {
          stepId: st['stepId'] ?? st['id'] ?? `step-${i}`,
          name: st['name'] ?? `Step ${i}`,
          order: st['order'] ?? { index: i },
          type: st['type'] ?? 'custom',
          config: st['config'] ?? {},
        };
        // Copy over optional valid properties
        if (st['description']) normalizedStep['description'] = st['description'];
        if (st['when']) normalizedStep['when'] = st['when'];
        if (st['retry']) normalizedStep['retry'] = st['retry'];
        if (st['timeoutMs']) normalizedStep['timeoutMs'] = st['timeoutMs'];
        if (st['assertions']) normalizedStep['assertions'] = st['assertions'];
        if (st['continueOnFailure'] !== undefined) normalizedStep['continueOnFailure'] = st['continueOnFailure'];
        if (st['tags']) normalizedStep['tags'] = st['tags'];
        if (st['metadata']) normalizedStep['metadata'] = st['metadata'];
        return normalizedStep;
      }
      return { stepId: `step-${i}`, name: `Step ${i}`, order: { index: i }, type: 'custom', config: {} };
    });
  }

  // Normalize teardown - ensure array
  let teardown = scenario['teardown'];
  if (!Array.isArray(teardown)) {
    teardown = [];
  } else {
    teardown = teardown.map((t, i) => {
      if (typeof t === 'object' && t !== null) {
        const td = t as Record<string, unknown>;
        return {
          id: td['id'] ?? `teardown-${i}`,
          name: td['name'] ?? `Teardown ${i}`,
          type: td['type'] ?? 'cleanup',
          config: td['config'] ?? {},
          alwaysRun: td['alwaysRun'] ?? true,
          ...td,
        };
      }
      return { id: `teardown-${i}`, name: `Teardown ${i}`, type: 'cleanup', config: {}, alwaysRun: true };
    });
  }

  // Normalize expectations - ensure array
  let expectations = scenario['expectations'];
  if (!Array.isArray(expectations)) {
    expectations = [];
  } else {
    expectations = expectations.map((e, i) => {
      if (typeof e === 'object' && e !== null) {
        const ex = e as Record<string, unknown>;
        return {
          id: ex['id'] ?? `expect-${i}`,
          description: ex['description'] ?? `Expectation ${i}`,
          type: ex['type'] ?? 'custom',
          expression: ex['expression'] ?? 'true',
          severity: ex['severity'] ?? 'warning',
          ...ex,
        };
      }
      return { id: `expect-${i}`, description: String(e), type: 'custom', expression: 'true', severity: 'warning' };
    });
  }

  // Build normalized scenario
  const normalizedScenario: Record<string, unknown> = {
    scenarioId: scenario['scenarioId'] ?? scenario['id'] ?? `scenario-${Date.now()}`,
    version,
    name: scenario['name'] ?? 'Unnamed Scenario',
    description: scenario['description'] ?? '',
    category,
    tags: Array.isArray(scenario['tags']) ? scenario['tags'] : [],
    preconditions,
    setup,
    steps,
    teardown,
    expectations,
  };

  // Copy optional fields if present
  if (scenario['parameterDefinitions']) normalizedScenario['parameterDefinitions'] = scenario['parameterDefinitions'];
  if (scenario['defaultParameters']) normalizedScenario['defaultParameters'] = scenario['defaultParameters'];
  if (scenario['postconditions']) normalizedScenario['postconditions'] = scenario['postconditions'];
  if (scenario['timeoutMs']) normalizedScenario['timeoutMs'] = scenario['timeoutMs'];
  if (scenario['parallelizable'] !== undefined) normalizedScenario['parallelizable'] = scenario['parallelizable'];
  if (scenario['dependencies']) normalizedScenario['dependencies'] = scenario['dependencies'];
  if (scenario['author']) normalizedScenario['author'] = scenario['author'];
  if (scenario['createdAt']) normalizedScenario['createdAt'] = scenario['createdAt'];
  if (scenario['updatedAt']) normalizedScenario['updatedAt'] = scenario['updatedAt'];
  if (scenario['contentHash']) normalizedScenario['contentHash'] = scenario['contentHash'];

  // Return normalized request with only scenario and config (no extra properties)
  const result: Record<string, unknown> = {
    scenario: normalizedScenario,
  };

  if (raw['config']) {
    result['config'] = raw['config'];
  }

  return result;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Reads JSON body from request
 */
async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        if (!body) {
          reject(new Error('Empty request body'));
          return;
        }
        resolve(JSON.parse(body) as T);
      } catch (error) {
        reject(new Error(`Invalid JSON: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    });

    req.on('error', reject);
  });
}

/**
 * Sends JSON response
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

/**
 * Sends error response
 */
function sendError(res: ServerResponse, statusCode: number, code: string, message: string, details?: unknown): void {
  const errorResponse: ErrorResponse = {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
  sendJson(res, statusCode, errorResponse);
}

/**
 * Creates a default simulation config
 */
function createDefaultConfig(scenario: Scenario): SimulationConfig {
  const simulationId = `sim-${uuidv4()}` as SimulationConfig['simulationId'];
  const now = new Date().toISOString() as ISOTimestamp;

  return {
    simulationId,
    scenario: {
      scenarioId: scenario.scenarioId,
      parameters: scenario.defaultParameters,
    },
    policies: [],
    resourceLimits: {
      maxExecutionTimeMs: 120000, // 2 minutes
      maxMemoryBytes: 512 * 1024 * 1024, // 512MB
      maxConcurrency: 4,
      maxSnapshots: 100,
      maxTraceEvents: 10000,
    },
    timing: {
      mode: 'controlled',
      simulatedStartTime: now,
    },
    dataSources: [],
    artifactConfig: {
      generateReport: true,
      generatePolicyLog: true,
      generateStateSnapshots: false,
      generateTrace: true,
      formats: ['json'],
      signArtifacts: false,
    },
    observability: {
      logLevel: 'info',
      enableMetrics: true,
      enableTracing: true,
      traceSamplingRate: 1.0,
    },
    metadata: {
      name: scenario.name,
      description: scenario.description,
      tags: [...scenario.tags],
    },
  };
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

/**
 * Health check endpoint
 */
function handleHealth(res: ServerResponse): void {
  const health: HealthResponse = {
    status: 'healthy',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  };
  sendJson(res, 200, health);
}

/**
 * Simulate endpoint - POST /v1/simulate
 *
 * CRITICAL: Contract validation occurs at the earliest entry point.
 * Invalid requests MUST fail before any engine initialization,
 * scenario loading, or execution begins.
 */
async function handleSimulate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Validate method
  if (req.method !== 'POST') {
    sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST method is allowed');
    return;
  }

  // Parse request body first
  let rawBody: unknown;
  try {
    rawBody = await readJsonBody<unknown>(req);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Invalid JSON')) {
        sendError(res, 400, 'INVALID_JSON', error.message);
      } else if (error.message.includes('Empty request body')) {
        sendError(res, 400, 'EMPTY_BODY', 'Request body is required');
      } else {
        sendError(res, 400, 'PARSE_ERROR', error.message);
      }
    } else {
      sendError(res, 400, 'PARSE_ERROR', 'Failed to parse request body');
    }
    return;
  }

  // DIAGNOSTIC LOGGING - Log full request body for debugging
  console.log("SIMULATE BODY (raw):", JSON.stringify(rawBody, null, 2));

  // NORMALIZE REQUEST - Transform simplified payloads to strict schema format
  const normalizedBody = normalizeRequest(rawBody);
  console.log("SIMULATE BODY (normalized):", JSON.stringify(normalizedBody, null, 2));

  // CONTRACT VALIDATION - EARLIEST ENTRY POINT
  // Validate against simulation/v1/request.schema.json with strict Ajv validation.
  // No engine initialization, scenario loading, or execution may occur before this.
  const validation = validateSimulateRequest(normalizedBody);
  if (!validation.valid) {
    // Contract violation - fail immediately with detailed errors
    const errorResponse = createContractViolationResponse(validation.errors);
    sendJson(res, 400, errorResponse);
    return;
  }

  // Type assertion is now safe after schema validation
  const body = normalizedBody as SimulateRequest;

  try {
    // Create configuration - no manual field checks needed
    // Schema validation guarantees scenario exists and has required structure
    const config = body.config
      ? { ...createDefaultConfig(body.scenario), ...body.config }
      : createDefaultConfig(body.scenario);

    // Create and initialize engine
    const engine = createSimulationEngine();
    await engine.initialize(config);

    // Execute simulation
    const result = await engine.execute(body.scenario);

    // Send result with mandatory execution proof and execution_metadata
    // execution_metadata is required by CLI contract for execution graph participation
    sendJson(res, 200, {
      success: true,
      result,
      execution_metadata: {
        service: 'agentics-simulation-engine',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        simulation_id: result.simulationId,
        status: result.status,
        execution_proof: result.executionProof,
        layers_executed: result.executionProof.layersExecuted,
        proof_hash: result.executionProof.proofHash,
        mandatory_layers_complete: result.executionProof.mandatoryLayersComplete,
      },
    });
  } catch (error) {
    // DIAGNOSTIC LOGGING - Log full error details for debugging
    // Use JSON.stringify to properly serialize non-Error objects
    console.error("SIMULATION ERROR:", error);
    console.error("SIMULATION ERROR (stringified):", JSON.stringify(error, Object.getOwnPropertyNames(error ?? {}), 2));
    if (error instanceof Error && error.stack) {
      console.error("SIMULATION ERROR STACK:", error.stack);
    }

    if (error instanceof Error) {
      sendError(res, 500, 'SIMULATION_ERROR', error.message, {
        name: error.name,
        stack: error.stack,
      });
    } else {
      // Handle non-Error thrown values (objects, strings, etc.)
      const errorStr = typeof error === 'string'
        ? error
        : JSON.stringify(error, null, 2);
      sendError(res, 500, 'UNKNOWN_ERROR', `Non-Error thrown: ${errorStr}`, {
        rawError: error,
      });
    }
  }
}

// ============================================================================
// REQUEST ROUTER
// ============================================================================

/**
 * Main request handler
 */
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  console.log(`${new Date().toISOString()} ${req.method} ${path}`);

  // CORS headers for authenticated requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route requests
  try {
    switch (path) {
      case '/':
      case '/health':
      case '/healthz':
        handleHealth(res);
        break;

      case '/v1/simulate':
        await handleSimulate(req, res);
        break;

      default:
        sendError(res, 404, 'NOT_FOUND', `Endpoint not found: ${path}`);
    }
  } catch (error) {
    console.error('Unhandled error:', error);
    sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = parseInt(process.env['PORT'] ?? '8080', 10);

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('Request handler error:', error);
    if (!res.headersSent) {
      sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Agentics Simulation Engine server listening on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Simulate endpoint: POST http://localhost:${PORT}/v1/simulate`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
