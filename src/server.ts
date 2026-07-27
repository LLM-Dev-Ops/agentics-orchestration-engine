/**
 * HTTP Server for Agentics Orchestration Engine
 *
 * Exposes the orchestration engine via REST API for Cloud Run deployment.
 * This service is a CONDUCTOR, not an engine. It delegates all execution
 * to downstream Agentics Cores after receiving execution acceptance from ruvector.
 *
 * CRITICAL: All /v1/simulate responses MUST include execution_metadata.
 * CRITICAL: This service MUST NOT mint execution_id — ruvector does.
 *
 * @module server
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import {
  createOrchestrationEngine,
  OrchestrationError,
  type OrchestrationConfig,
} from './core/engine.js';
import { createCoreClientRegistryFromEnv } from './integration/cores/http-cores.js';
import {
  resolveCoreEndpoints,
  CoreConfigurationError,
} from './integration/cores/core-endpoints.js';
import type { SimulationConfig, SimulationResult } from './types/simulation.js';
import type { Scenario } from './types/scenario.js';
import type { ExecutionId, ISOTimestamp, SimulationId } from './types/common.js';
import { createSimulationId } from './types/common.js';
import {
  RuvectorClient,
  createRuvectorClient,
  RuvectorClientError,
} from './ruvector/client.js';
import type { RuvectorClientConfig } from './ruvector/types.js';
import {
  validateSimulateRequest,
  validateResultPacket,
  formatValidationErrors,
  type ContractValidationError,
} from './contracts/index.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const SERVICE_NAME = 'agentics-orchestration-engine';
const SERVICE_VERSION = '0.2.0';
const SERVICE_INSTANCE_ID = `orchestrator-${Date.now()}-${Math.random().toString(36).substring(7)}`;

// ============================================================================
// DIAGNOSTIC LOGGING
// ============================================================================

function logResponse(context: string, statusCode: number, hasExecutionMetadata: boolean, responsePreview?: string): void {
  console.log(`[RESPONSE-DEBUG] ${new Date().toISOString()}`);
  console.log(`  Service: ${SERVICE_NAME}`);
  console.log(`  Instance: ${SERVICE_INSTANCE_ID}`);
  console.log(`  Context: ${context}`);
  console.log(`  Status: ${statusCode}`);
  console.log(`  Has execution_metadata: ${hasExecutionMetadata}`);
  if (responsePreview) {
    console.log(`  Response preview: ${responsePreview.substring(0, 200)}...`);
  }
}

// ============================================================================
// TYPES
// ============================================================================

interface SimulateRequest {
  config?: Partial<SimulationConfig>;
  scenario: Scenario;
}

interface HealthResponse {
  service: string;
  version: string;
  status: 'healthy' | 'unhealthy';
  role: string | undefined;
  mode: string | undefined;
}

interface RunCreateResponse {
  execution_id: string;
  status: 'accepted';
  simulation_resolution?: string;
}

interface ExecutionMetadata {
  service: string;
  version: string;
  timestamp: string;
  execution_id: string | null;
  simulation_id: string | null;
  simulation_resolution: string | null;
  status: 'error' | 'success' | 'partial_success' | 'failure' | 'timeout' | 'cancelled';
  error_code?: string;
  error_phase?: string;
  execution_proof?: unknown;
  layers_executed?: readonly string[];
  proof_hash?: unknown;
  mandatory_layers_complete?: boolean;
  delegation_count?: number;
  _debug_service_instance?: string;
}

interface SimulateErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  execution_metadata: ExecutionMetadata;
}

interface SimulateSuccessResponse {
  success: true;
  result: SimulationResult;
  execution_id: string;
  execution_metadata: ExecutionMetadata;
}

type SimulateResponse = SimulateErrorResponse | SimulateSuccessResponse;

// ============================================================================
// REQUEST NORMALIZATION
// ============================================================================

function normalizeRequest(input: unknown): unknown {
  if (!input || typeof input !== 'object') {
    return input;
  }

  const raw = input as Record<string, unknown>;

  let scenario = raw['scenario'] as Record<string, unknown> | undefined;

  if (!scenario && raw['scenarioId']) {
    scenario = raw as Record<string, unknown>;
  }

  if (!scenario) {
    return input;
  }

  // Normalize version
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

  // Normalize category
  const validCategories = ['deployment', 'policy', 'integration', 'failure', 'performance', 'compliance', 'migration', 'what-if', 'custom'];
  let category = scenario['category'];
  if (!category || !validCategories.includes(category as string)) {
    category = 'custom';
  }

  // Normalize preconditions
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

  // Normalize setup
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

  // Normalize steps
  let steps = scenario['steps'];
  if (!Array.isArray(steps)) {
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
        const normalizedStep: Record<string, unknown> = {
          stepId: st['stepId'] ?? st['id'] ?? `step-${i}`,
          name: st['name'] ?? `Step ${i}`,
          order: st['order'] ?? { index: i },
          type: st['type'] ?? 'custom',
          config: st['config'] ?? {},
        };
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

  // Normalize teardown
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

  // Normalize expectations
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

function _sendJsonInternal(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

// ============================================================================
// CENTRALIZED SIMULATE RESPONSE HELPER
// ============================================================================

function createErrorExecutionMetadata(code: string, phase: string): ExecutionMetadata {
  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    execution_id: null,
    simulation_id: null,
    simulation_resolution: null,
    status: 'error',
    error_code: code,
    error_phase: phase,
    _debug_service_instance: SERVICE_INSTANCE_ID,
  };
}

function createSuccessExecutionMetadata(
  result: SimulationResult,
  executionId: ExecutionId,
  simulationResolution: string
): ExecutionMetadata {
  return {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    execution_id: executionId,
    simulation_id: result.simulationId,
    simulation_resolution: simulationResolution,
    status: result.status,
    execution_proof: result.executionProof,
    layers_executed: result.executionProof.layersExecuted,
    proof_hash: result.executionProof.proofHash,
    mandatory_layers_complete: result.executionProof.mandatoryLayersComplete,
    _debug_service_instance: SERVICE_INSTANCE_ID,
  };
}

function sendSimulateResponse(res: ServerResponse, statusCode: number, response: SimulateResponse): void {
  if (!response.execution_metadata) {
    console.error('CRITICAL: Attempted to send simulate response without execution_metadata');
    (response as SimulateErrorResponse).execution_metadata = createErrorExecutionMetadata(
      'INTERNAL_METADATA_ERROR',
      'response'
    );
  }

  const responseStr = JSON.stringify(response);
  const hasMetadata = !!response.execution_metadata;
  const context = 'error' in response ? `error:${response.error.code}` : 'success';
  logResponse(`sendSimulateResponse:${context}`, statusCode, hasMetadata, responseStr);

  _sendJsonInternal(res, statusCode, response);
}

function sendSimulateError(
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  phase: string,
  details?: unknown
): void {
  const response: SimulateErrorResponse = {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
    execution_metadata: createErrorExecutionMetadata(code, phase),
  };
  sendSimulateResponse(res, statusCode, response);
}

function sendSimulateSuccess(
  res: ServerResponse,
  result: SimulationResult,
  executionId: ExecutionId,
  simulationResolution: string
): void {
  const response: SimulateSuccessResponse = {
    success: true,
    result,
    execution_id: executionId,
    execution_metadata: createSuccessExecutionMetadata(result, executionId, simulationResolution),
  };
  sendSimulateResponse(res, 200, response);
}

function sendContractViolation(
  res: ServerResponse,
  errors: ReadonlyArray<ContractValidationError>
): void {
  const response: SimulateErrorResponse = {
    error: {
      code: 'CONTRACT_VIOLATION',
      message: `Request does not conform to simulation/v1/request.schema.json: ${formatValidationErrors(errors)}`,
      details: {
        violations: errors,
        schema: 'simulation/v1/request.schema.json',
      },
    },
    execution_metadata: createErrorExecutionMetadata('CONTRACT_VIOLATION', 'validation'),
  };
  sendSimulateResponse(res, 400, response);
}

/**
 * Creates a default simulation config.
 * NOTE: No execution_id is minted here. The simulationId is a scenario reference only.
 * The canonical execution_id comes from ruvector acceptance.
 */
function createDefaultConfig(scenario: Scenario): SimulationConfig {
  const simulationId = createSimulationId(`scenario-ref-${scenario.scenarioId}`);
  const now = new Date().toISOString() as ISOTimestamp;

  return {
    simulationId,
    scenario: {
      scenarioId: scenario.scenarioId,
      parameters: scenario.defaultParameters,
    },
    policies: [],
    resourceLimits: {
      maxExecutionTimeMs: 120000,
      maxMemoryBytes: 512 * 1024 * 1024,
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
// RUVECTOR CLIENT SETUP
// ============================================================================

/**
 * Creates a RuvectorClient from environment variables.
 * Fails fast if RUVECTOR_SERVICE_URL is not set.
 */
function createRuvectorClientFromEnv(): RuvectorClient {
  const endpoint = process.env['RUVECTOR_SERVICE_URL'];
  if (!endpoint) {
    throw new Error('RUVECTOR_SERVICE_URL is not defined');
  }
  const config: RuvectorClientConfig = {
    endpoint,
    credentialsRef: process.env['RUVECTOR_CREDENTIALS_REF'] ?? 'ruvector-api-key',
    clientId: process.env['RUVECTOR_CLIENT_ID'] ?? SERVICE_INSTANCE_ID,
    mode: 'polling',
    connectionTimeoutMs: parseInt(process.env['RUVECTOR_TIMEOUT_MS'] ?? '10000', 10),
  };
  return createRuvectorClient(config);
}

// ============================================================================
// ROUTE HANDLERS
// ============================================================================

function handleHealth(res: ServerResponse): void {
  const health: HealthResponse = {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    status: 'healthy',
    role: process.env['AGENTICS_ROLE'],
    mode: process.env['AGENTICS_MODE'],
  };
  _sendJsonInternal(res, 200, health);
}

/**
 * Simulate endpoint - POST /v1/simulate
 *
 * ORCHESTRATION FLOW:
 * 1. Validate request contract
 * 2. Request execution acceptance from ruvector (BLOCKING)
 * 3. Delegate ALL work to downstream cores using ruvector-minted execution_id
 * 4. Return collated result with execution_id
 *
 * This handler MUST NOT:
 * - Mint execution_id
 * - Execute simulation logic
 * - Perform policy evaluation, cost computation, artifact generation, or validation math
 */
async function handleSimulate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendSimulateError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST method is allowed', 'request');
    return;
  }

  let rawBody: unknown;
  try {
    rawBody = await readJsonBody<unknown>(req);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Invalid JSON')) {
        sendSimulateError(res, 400, 'INVALID_JSON', error.message, 'parsing');
      } else if (error.message.includes('Empty request body')) {
        sendSimulateError(res, 400, 'EMPTY_BODY', 'Request body is required', 'parsing');
      } else {
        sendSimulateError(res, 400, 'PARSE_ERROR', error.message, 'parsing');
      }
    } else {
      sendSimulateError(res, 400, 'PARSE_ERROR', 'Failed to parse request body', 'parsing');
    }
    return;
  }

  console.log("SIMULATE BODY (raw):", JSON.stringify(rawBody, null, 2));

  const normalizedBody = normalizeRequest(rawBody);
  console.log("SIMULATE BODY (normalized):", JSON.stringify(normalizedBody, null, 2));

  // CONTRACT VALIDATION - EARLIEST ENTRY POINT
  const validation = validateSimulateRequest(normalizedBody);
  if (!validation.valid) {
    sendContractViolation(res, validation.errors);
    return;
  }

  const body = normalizedBody as SimulateRequest;

  try {
    const simConfig = body.config
      ? { ...createDefaultConfig(body.scenario), ...body.config }
      : createDefaultConfig(body.scenario);

    // Create orchestration engine and initialize with ruvector + core clients
    const ruvectorClient = createRuvectorClientFromEnv();
    const coreClients = createCoreClientRegistryFromEnv();
    const engine = createOrchestrationEngine();
    engine.initialize(ruvectorClient, coreClients);

    // Build orchestration config — NO execution_id minted here
    const orchestrationConfig: OrchestrationConfig = {
      simulationId: simConfig.simulationId,
      simulationConfig: simConfig,
      scenario: body.scenario,
      engineId: SERVICE_INSTANCE_ID,
    };

    // Orchestrate — blocks until ruvector acceptance, delegates everything
    const orchestrationResult = await engine.orchestrate(orchestrationConfig);

    // Persist to results-index with contract validation
    const RESULTS_INDEX_URL = process.env['RESULTS_INDEX_URL'];

    if (!RESULTS_INDEX_URL) {
      console.warn('[RESULTS_INDEX_WRITE] skipped — RESULTS_INDEX_URL missing');
    } else {
      const resultPacket = {
        execution_id: orchestrationResult.executionId,
        simulation_id: orchestrationResult.result?.simulationId,
        simulation_resolution: orchestrationResult.simulation_resolution,
        metadata: orchestrationResult.result?.metadata ?? {},
        execution_proof: orchestrationResult.result?.executionProof,
        environment: process.env['ENVIRONMENT'] ?? 'production',
      };

      // Validate outbound payload against result-packet contract schema
      const packetValidation = validateResultPacket(resultPacket);
      if (!packetValidation.valid) {
        throw new Error(
          `Result packet contract validation failed: ${formatValidationErrors(packetValidation.errors)}`
        );
      }

      // Await the write — do NOT fire-and-forget
      const writeResponse = await fetch(`${RESULTS_INDEX_URL}/api/v1/runs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${process.env['PLATFORM_API_KEY']}`,
        },
        body: JSON.stringify(resultPacket),
      });

      if (!writeResponse.ok) {
        throw new Error(
          `Results-index write failed: ${writeResponse.status} ${writeResponse.statusText}`
        );
      }

      console.log('[RESULTS_INDEX_WRITE] success');
    }

    // Return with ruvector-minted execution_id
    sendSimulateSuccess(res, orchestrationResult.result, orchestrationResult.executionId, orchestrationResult.simulation_resolution);
  } catch (error) {
    console.error("ORCHESTRATION ERROR:", error);
    if (error instanceof Error && error.stack) {
      console.error("ORCHESTRATION ERROR STACK:", error.stack);
    }

    if (error instanceof OrchestrationError) {
      const statusCode = error.code === 'RUVECTOR_REJECTED' ? 403
        : error.code === 'RUVECTOR_UNAVAILABLE' ? 503
        : 500;
      sendSimulateError(res, statusCode, error.code, error.message, 'orchestration', {
        details: error.details,
      });
    } else if (error instanceof Error) {
      sendSimulateError(res, 500, 'ORCHESTRATION_ERROR', error.message, 'orchestration', {
        name: error.name,
        stack: error.stack,
      });
    } else {
      const errorStr = typeof error === 'string'
        ? error
        : JSON.stringify(error, null, 2);
      sendSimulateError(res, 500, 'UNKNOWN_ERROR', `Non-Error thrown: ${errorStr}`, 'orchestration', {
        rawError: error,
      });
    }
  }
}

// ============================================================================
// RUN ENDPOINTS
// ============================================================================

/**
 * POST /api/v1/runs — Submit a run intent to Ruvector for acceptance.
 *
 * Ruvector is the sole authority for accepting execution and minting identity
 * (agentics-enforcement ADR-004), so this handler mints nothing and declares
 * nothing approved. It forwards the intent to Ruvector's accept endpoint and
 * returns the Ruvector-minted execution_id.
 */
async function handleCreateRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    sendGenericError(res, 405, 'METHOD_NOT_ALLOWED', 'Only POST method is allowed');
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody<unknown>(req);
  } catch (error) {
    sendGenericError(res, 400, 'INVALID_BODY', error instanceof Error ? error.message : 'Failed to parse request body');
    return;
  }

  if (!body || typeof body !== 'object') {
    sendGenericError(res, 400, 'INVALID_BODY', 'Request body must be a JSON object');
    return;
  }

  const ruvectorEndpoint = process.env['RUVECTOR_SERVICE_URL'];
  if (!ruvectorEndpoint) {
    sendGenericError(res, 500, 'RUVECTOR_NOT_CONFIGURED', 'RUVECTOR_SERVICE_URL is not defined');
    return;
  }

  const intent = body as Record<string, unknown>;
  const simulationId = intent['simulation_id'] ?? intent['simulationId'];
  if (typeof simulationId !== 'string' || simulationId.length === 0) {
    sendGenericError(res, 400, 'INVALID_BODY', 'simulation_id is required');
    return;
  }

  const acceptancePayload = {
    simulation_id: simulationId,
    plan_id: intent['plan_id'] ?? intent['planId'] ?? simulationId,
    simulation_resolution: intent['simulation_resolution'] ?? 'aggregate',
    execution_metadata: {
      source: SERVICE_NAME,
      environment: process.env['ENVIRONMENT'] ?? process.env['NODE_ENV'] ?? 'production',
      timestamp: new Date().toISOString(),
    },
  };

  const acceptUrl = `${ruvectorEndpoint}/v1/accept`;
  console.log(`[POST /api/v1/runs] submitting intent to ${acceptUrl}`, JSON.stringify(acceptancePayload));

  let acceptance: Record<string, unknown>;
  try {
    const acceptResponse = await fetch(acceptUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${process.env['PLATFORM_API_KEY']}`,
      },
      body: JSON.stringify(acceptancePayload),
    });

    if (!acceptResponse.ok) {
      const detail = `${acceptResponse.status} ${acceptResponse.statusText}`;
      console.error(`[orchestration] Ruvector acceptance request failed: ${detail}`);
      sendGenericError(res, 502, 'RUVECTOR_ACCEPTANCE_FAILED', `Ruvector acceptance request failed: ${detail}`);
      return;
    }

    acceptance = (await acceptResponse.json()) as Record<string, unknown>;
  } catch (error) {
    console.error('[orchestration] Ruvector acceptance request failed:', error);
    sendGenericError(res, 503, 'RUVECTOR_UNAVAILABLE', error instanceof Error ? error.message : 'Ruvector is unreachable');
    return;
  }

  const executionId = acceptance['execution_id'];
  if (acceptance['accepted'] === false || typeof executionId !== 'string') {
    const reason = typeof acceptance['rejection_reason'] === 'string'
      ? acceptance['rejection_reason']
      : 'Ruvector did not accept the run';
    sendGenericError(res, 403, 'RUVECTOR_REJECTED', reason);
    return;
  }

  console.log(`[orchestration] Ruvector accepted run execution_id=${executionId}`);

  const response: RunCreateResponse = {
    execution_id: executionId,
    status: 'accepted',
    ...(typeof acceptance['simulation_resolution'] === 'string' && {
      simulation_resolution: acceptance['simulation_resolution'],
    }),
  };
  _sendJsonInternal(res, 202, response);
}

/**
 * GET /api/v1/runs/:id — Placeholder for run state retrieval.
 * No persistence yet — always returns { runId, status: "pending" }.
 */
function handleGetRun(res: ServerResponse, runId: string): void {
  _sendJsonInternal(res, 200, { runId, status: 'pending' });
}

// ============================================================================
// REQUEST ROUTER
// ============================================================================

function sendGenericError(res: ServerResponse, statusCode: number, code: string, message: string): void {
  _sendJsonInternal(res, statusCode, {
    error: { code, message },
  });
}

function isSimulatePath(path: string): boolean {
  return path.startsWith('/v1/simulate') || path === '/simulate';
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  console.log(`${new Date().toISOString()} ${req.method} ${path}`);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Match /api/v1/runs/:id
  const runsIdMatch = path.match(/^\/api\/v1\/runs\/([^/]+)$/);

  try {
    switch (path) {
      case '/health':
      case '/healthz':
        handleHealth(res);
        break;

      case '/v1/simulate':
        await handleSimulate(req, res);
        break;

      case '/api/v1/runs':
        await handleCreateRun(req, res);
        break;

      default:
        if (runsIdMatch && req.method === 'GET') {
          handleGetRun(res, runsIdMatch[1]!);
        } else if (isSimulatePath(path)) {
          sendSimulateError(res, 404, 'NOT_FOUND', `Endpoint not found: ${path}`, 'routing');
        } else {
          sendGenericError(res, 404, 'NOT_FOUND', `Endpoint not found: ${path}`);
        }
    }
  } catch (error) {
    console.error('Unhandled error:', error);
    if (isSimulatePath(path)) {
      sendSimulateError(res, 500, 'INTERNAL_ERROR', 'Internal server error', 'routing');
    } else {
      sendGenericError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  }
}

// ============================================================================
// CONTRACT DEPENDENCY GUARD
// ============================================================================

try {
  await import('@agentics/contracts');
  console.log('[contracts] loaded');
} catch (err) {
  console.error('[contracts] missing', err);
  process.exit(1);
}

// ============================================================================
// LAYER-3 CORE CONFIGURATION GUARD (fail closed)
// ============================================================================

let coreEndpoints: ReturnType<typeof resolveCoreEndpoints>;
try {
  coreEndpoints = resolveCoreEndpoints();
  console.log('[cores] endpoints resolved');
} catch (err) {
  if (err instanceof CoreConfigurationError) {
    console.error(`[cores] ${err.message}`);
    console.error(`[cores] offending variables: ${err.variables.join(', ')}`);
  } else {
    console.error('[cores] endpoint resolution failed', err);
  }
  process.exit(1);
}

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = parseInt(process.env['PORT'] ?? '8080', 10);

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error('Request handler error:', error);
    if (!res.headersSent) {
      sendSimulateError(res, 500, 'INTERNAL_ERROR', 'Internal server error', 'routing');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SERVICE_NAME=${SERVICE_NAME}`);
  console.log(`SERVICE_VERSION=${SERVICE_VERSION}`);
  console.log(`AGENTICS_ROLE=${process.env['AGENTICS_ROLE'] ?? 'orchestrator'}`);
  console.log(`AGENTICS_MODE=${process.env['AGENTICS_MODE'] ?? 'orchestration'}`);
  console.log(`Using RUVECTOR_SERVICE_URL: ${process.env['RUVECTOR_SERVICE_URL'] ?? '(NOT SET — will fail at runtime)'}`);
  console.log(`Using SECURITY_CORE_URL: ${coreEndpoints.security}`);
  console.log(`Using DATA_CORE_URL: ${coreEndpoints.data}`);
  console.log(`Using GOVERNANCE_CORE_URL: ${coreEndpoints.governance}`);
  console.log(`Using AUTOMATION_CORE_URL: ${coreEndpoints.automation}`);
  console.log(`Listening on port ${PORT}`);
  console.log(`Routes:`);
  console.log(`  GET  /health`);
  console.log(`  POST /v1/simulate`);
  console.log(`  POST /api/v1/runs`);
  console.log(`  GET  /api/v1/runs/:id`);
});

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
