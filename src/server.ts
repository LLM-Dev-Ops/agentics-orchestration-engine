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

  // CONTRACT VALIDATION - EARLIEST ENTRY POINT
  // Validate against simulation/v1/request.schema.json with strict Ajv validation.
  // No engine initialization, scenario loading, or execution may occur before this.
  const validation = validateSimulateRequest(rawBody);
  if (!validation.valid) {
    // Contract violation - fail immediately with detailed errors
    const errorResponse = createContractViolationResponse(validation.errors);
    sendJson(res, 400, errorResponse);
    return;
  }

  // Type assertion is now safe after schema validation
  const body = rawBody as SimulateRequest;

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

    // Send result with mandatory execution proof
    sendJson(res, 200, {
      success: true,
      result,
    });
  } catch (error) {
    console.error('Simulation error:', error);

    if (error instanceof Error) {
      sendError(res, 500, 'SIMULATION_ERROR', error.message, {
        name: error.name,
      });
    } else {
      sendError(res, 500, 'UNKNOWN_ERROR', 'An unknown error occurred');
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
