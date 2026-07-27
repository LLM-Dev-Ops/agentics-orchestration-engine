/**
 * Real HTTP Core Client Implementations.
 *
 * Speaks each Layer-3 Core's actual HTTP contract:
 *
 * | Core            | Endpoint                   | Parent span propagated as |
 * |-----------------|----------------------------|---------------------------|
 * | security-core   | POST /gate                 | `options.parentSpanId`    |
 * | data-core       | POST /simulation/persist   | `metadata.parentSpanId`   |
 * | governance-core | POST /gate                 | `context.parentSpanId`    |
 * | automation-core | POST /execute              | `options.parentSpanId`    |
 *
 * A deny is a real answer, not a transport failure: security-core and
 * governance-core answer 403 with a decision body, so 403 is parsed rather
 * than thrown.
 *
 * @module integration/cores/http-cores
 */

import type { SpanId, TraceId } from '../../types/common.js';
import type {
  CoreName,
  CoreSpanHierarchy,
  SecurityCoreRequest,
  SecurityCoreResponse,
  DataCoreRequest,
  DataCoreResponse,
  AutomationCoreRequest,
  AutomationCoreResponse,
  GovernanceCoreRequest,
  GovernanceCoreResponse,
} from '../../types/core-delegation.js';
import type { PolicyResult } from '../../types/simulation.js';
import type {
  SecurityCoreClient,
  DataCoreClient,
  AutomationCoreClient,
  GovernanceCoreClient,
  CoreClientRegistry,
  CoreHealth,
} from './core-client.js';
import { CoreDelegationError } from './errors.js';
import { normalizeExecutionGraph, type RawExecutionGraph } from './span-normalizer.js';
import { resolveCoreEndpoints, type CoreEndpoints } from './core-endpoints.js';
import { createContentHashFromObject } from '../../utils/hash.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

/** The subset of `fetch` these clients use; injectable for testing. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface HttpCoreClientConfig {
  /** Base URL of the Core service, without trailing slash. */
  readonly baseUrl: string;
  /** Fallback timeout when the request carries none. */
  readonly timeoutMs?: number;
  /** Bearer credential presented to the Core, if it requires one. */
  readonly apiKey?: string;
  /** Injected transport. Defaults to global fetch. */
  readonly fetchImpl?: FetchLike;
}

export interface HttpCoreRegistryConfig {
  readonly endpoints: CoreEndpoints;
  readonly timeoutMs?: number;
  readonly apiKey?: string;
  readonly fetchImpl?: FetchLike;
}

const DEFAULT_TIMEOUT_MS = 30000;

// ============================================================================
// SHARED TRANSPORT
// ============================================================================

interface CorePostOptions {
  readonly path: string;
  readonly body: unknown;
  readonly traceId: string;
  readonly timeoutMs: number;
  /** Non-2xx statuses that still carry a decision body. */
  readonly acceptStatuses?: ReadonlyArray<number>;
}

abstract class BaseHttpCoreClient {
  abstract readonly coreName: CoreName;
  protected readonly config: HttpCoreClientConfig;

  constructor(config: HttpCoreClientConfig) {
    this.config = config;
  }

  async checkHealth(): Promise<CoreHealth> {
    const started = Date.now();
    try {
      const response = await this.fetchImpl()(`${this.config.baseUrl}/health`, {
        method: 'GET',
        headers: this.headers(),
      });
      return {
        coreName: this.coreName,
        healthy: response.ok,
        latencyMs: Date.now() - started,
        ...(response.ok
          ? { lastSuccessfulCall: new Date().toISOString() }
          : { errors: [`HTTP ${response.status} ${response.statusText}`] }),
      };
    } catch (error) {
      return {
        coreName: this.coreName,
        healthy: false,
        latencyMs: Date.now() - started,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  protected fetchImpl(): FetchLike {
    return this.config.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  protected headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...(this.config.apiKey !== undefined && {
        Authorization: `Bearer ${this.config.apiKey}`,
      }),
    };
  }

  protected async post(options: CorePostOptions): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const url = `${this.config.baseUrl}${options.path}`;

    try {
      const response = await this.fetchImpl()(url, {
        method: 'POST',
        headers: { ...this.headers(), 'X-Correlation-Id': options.traceId },
        body: JSON.stringify(options.body),
        signal: controller.signal,
      });

      const accepted =
        response.ok || (options.acceptStatuses ?? []).includes(response.status);

      if (!accepted) {
        throw new CoreDelegationError(
          `Core ${this.coreName} rejected the delegation: ${response.status} ${response.statusText}`,
          'CORE_HTTP_ERROR',
          this.coreName,
          `POST ${url} returned ${response.status}: ${await safeText(response)}`
        );
      }

      const parsed = await response.json();
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new CoreDelegationError(
          `Core ${this.coreName} returned a non-object response body`,
          'CORE_INVALID_RESPONSE',
          this.coreName,
          `POST ${url} returned ${typeof parsed}`
        );
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof CoreDelegationError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new CoreDelegationError(
          `Core ${this.coreName} timed out`,
          'CORE_TIMEOUT',
          this.coreName,
          `POST ${url} exceeded ${options.timeoutMs}ms`
        );
      }
      throw new CoreDelegationError(
        `Core ${this.coreName} is unreachable`,
        'CORE_UNAVAILABLE',
        this.coreName,
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      clearTimeout(timer);
    }
  }

  protected timeoutFor(requestTimeoutMs: number | undefined): number {
    return requestTimeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  protected hierarchy(
    body: Record<string, unknown>,
    request: { parentSpanId: SpanId; traceId: TraceId }
  ): CoreSpanHierarchy {
    return normalizeExecutionGraph(
      body['execution_graph'] as RawExecutionGraph | undefined,
      request.parentSpanId,
      request.traceId,
      this.coreName
    );
  }
}

async function safeText(response: {
  text(): Promise<string>;
}): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '<unreadable body>';
  }
}

function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

// ============================================================================
// SECURITY CORE
// ============================================================================

type SecurityGateAction = 'allow' | 'deny' | 'filter' | 'redact' | 'require-approval';

const SECURITY_OUTCOME: Record<
  SecurityGateAction,
  'allow' | 'deny' | 'warn' | 'require_approval'
> = {
  allow: 'allow',
  deny: 'deny',
  filter: 'warn',
  redact: 'warn',
  'require-approval': 'require_approval',
};

/** Compliance score is a restatement of the Core's own gate decision. */
const GATE_DECISION_SCORE: Record<string, number> = {
  allow: 100,
  'require-approval': 50,
  deny: 0,
};

export class HttpSecurityCoreClient
  extends BaseHttpCoreClient
  implements SecurityCoreClient
{
  readonly coreName = 'llm-security-core' as const;

  async call(request: SecurityCoreRequest): Promise<SecurityCoreResponse> {
    const startedAt = Date.now();

    const body = await this.post({
      path: '/gate',
      traceId: request.traceId,
      timeoutMs: this.timeoutFor(request.timeoutMs),
      acceptStatuses: [403],
      body: {
        request: {
          id: `${request.simulationId}:${request.phase}`,
          type: request.phase === 'pre-execution' ? 'prompt' : 'output',
          content: JSON.stringify(request.evaluationContext),
          context: {
            simulationId: request.simulationId,
            traceId: request.traceId,
            phase: request.phase,
            policyReferences: request.policyReferences,
            evaluationContext: request.evaluationContext,
            ...(request.stateSnapshot !== undefined && {
              stateSnapshot: request.stateSnapshot,
            }),
          },
          metadata: { timestamp: Date.parse(request.requestedAt) },
        },
        options: { parentSpanId: request.parentSpanId },
      },
    });

    const spanHierarchy = this.hierarchy(body, request);
    const gate = (body['gate'] ?? {}) as Record<string, unknown>;
    const rawDecisions = Array.isArray(gate['policyDecisions'])
      ? (gate['policyDecisions'] as Record<string, unknown>[])
      : [];

    const decisions = rawDecisions.map((decision) => ({
      policyId: String(decision['policyId'] ?? ''),
      outcome:
        SECURITY_OUTCOME[decision['action'] as SecurityGateAction] ?? 'deny',
      reason: String(decision['reason'] ?? ''),
      evaluationTimeMs: 0,
    }));

    const gateDecision = String(gate['decision'] ?? 'deny');

    return {
      coreName: this.coreName,
      success: gateDecision === 'allow',
      spanHierarchy,
      durationMs: elapsedMs(startedAt),
      responseHash: createContentHashFromObject(body),
      policyResult: buildPolicyResult(decisions, GATE_DECISION_SCORE[gateDecision] ?? 0),
      decisions,
    };
  }
}

function buildPolicyResult(
  decisions: ReadonlyArray<{ outcome: string }>,
  complianceScore: number
): PolicyResult {
  const decisionCounts: Record<string, number> = {
    allow: 0,
    deny: 0,
    warn: 0,
    require_approval: 0,
  };
  for (const decision of decisions) {
    decisionCounts[decision.outcome] = (decisionCounts[decision.outcome] ?? 0) + 1;
  }

  return {
    policiesEvaluated: decisions.length,
    decisionCounts,
    violations: [],
    complianceScore,
    policyResults: [],
  };
}

// ============================================================================
// DATA CORE
// ============================================================================

export class HttpDataCoreClient extends BaseHttpCoreClient implements DataCoreClient {
  readonly coreName = 'llm-data-core' as const;

  async call(request: DataCoreRequest): Promise<DataCoreResponse> {
    const startedAt = Date.now();

    const body = await this.post({
      path: '/simulation/persist',
      traceId: request.traceId,
      timeoutMs: this.timeoutFor(request.timeoutMs),
      body: {
        operationId: `${request.simulationId}:cost-attribution`,
        operationType: 'data:store',
        simulationId: request.simulationId,
        entityId: request.entityReferences[0]?.entityId ?? request.simulationId,
        payload: {
          entityReferences: request.entityReferences,
          executionSummary: request.executionSummary,
          ...(request.costBaselines !== undefined && {
            costBaselines: request.costBaselines,
          }),
        },
        metadata: {
          traceId: request.traceId,
          parentSpanId: request.parentSpanId,
          requestedAt: request.requestedAt,
        },
      },
    });

    const spanHierarchy = this.hierarchy(body, request);
    const costMetrics = (body['costMetrics'] ?? {}) as Record<string, unknown>;

    return {
      coreName: this.coreName,
      success: body['success'] !== false,
      spanHierarchy,
      durationMs: elapsedMs(startedAt),
      responseHash: createContentHashFromObject(body),
      costMetrics: {
        totalCost: numberOr(costMetrics['totalCost'], 0),
        currency: String(costMetrics['currency'] ?? 'USD'),
        breakdown: Array.isArray(costMetrics['breakdown'])
          ? (costMetrics['breakdown'] as DataCoreResponse['costMetrics']['breakdown'])
          : [],
      },
      executionMetrics: (body['executionMetrics'] ?? {}) as DataCoreResponse['executionMetrics'],
    };
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// ============================================================================
// GOVERNANCE CORE
// ============================================================================

export class HttpGovernanceCoreClient
  extends BaseHttpCoreClient
  implements GovernanceCoreClient
{
  readonly coreName = 'llm-governance-core' as const;

  async call(request: GovernanceCoreRequest): Promise<GovernanceCoreResponse> {
    const startedAt = Date.now();

    const body = await this.post({
      path: '/gate',
      traceId: request.traceId,
      timeoutMs: this.timeoutFor(request.timeoutMs),
      acceptStatuses: [403],
      body: {
        requestId: `${request.simulationId}:governance`,
        resourceId: String(request.simulationId),
        action: 'simulation:execute',
        principal: 'agentics-orchestration-engine',
        context: {
          traceId: request.traceId,
          parentSpanId: request.parentSpanId,
          policyResults: request.policyResults,
          scenarioResults: request.scenarioResults,
          ...(request.complianceRequirements !== undefined && {
            complianceRequirements: request.complianceRequirements,
          }),
        },
      },
    });

    const spanHierarchy = this.hierarchy(body, request);
    const allowed = body['allowed'] === true;

    return {
      coreName: this.coreName,
      success: allowed,
      spanHierarchy,
      durationMs: elapsedMs(startedAt),
      responseHash: createContentHashFromObject(body),
      validatedPolicyResult: {
        ...request.policyResults,
        complianceScore: allowed ? request.policyResults.complianceScore : 0,
      },
      governanceMetrics: {
        complianceScore: allowed ? request.policyResults.complianceScore : 0,
        frameworkResults: (request.complianceRequirements ?? []).map((requirement) => ({
          framework: requirement.framework,
          score: allowed ? 100 : 0,
          passed: allowed ? requirement.controls.length : 0,
          failed: allowed ? 0 : requirement.controls.length,
        })),
      },
    };
  }
}

// ============================================================================
// AUTOMATION CORE
// ============================================================================

export class HttpAutomationCoreClient
  extends BaseHttpCoreClient
  implements AutomationCoreClient
{
  readonly coreName = 'llm-automation-core' as const;

  async call(request: AutomationCoreRequest): Promise<AutomationCoreResponse> {
    const startedAt = Date.now();

    const body = await this.post({
      path: '/execute',
      traceId: request.traceId,
      timeoutMs: this.timeoutFor(request.timeoutMs),
      body: {
        input: {
          simulationId: request.simulationId,
          simulationResult: request.simulationResult,
          simulationConfig: request.simulationConfig,
          artifactConfig: request.artifactConfig,
        },
        options: { parentSpanId: request.parentSpanId, traceId: request.traceId },
      },
    });

    const spanHierarchy = this.hierarchy(body, request);
    const output = (body['output'] ?? {}) as Record<string, unknown>;
    const artifacts = (output['artifacts'] ?? body['artifacts']) as
      | AutomationCoreResponse['artifacts']
      | undefined;

    if (!artifacts) {
      throw new CoreDelegationError(
        `Core ${this.coreName} returned no artifact manifest`,
        'CORE_INVALID_RESPONSE',
        this.coreName,
        'Expected an ArtifactManifest at output.artifacts or artifacts.'
      );
    }

    return {
      coreName: this.coreName,
      success: body['success'] !== false,
      spanHierarchy,
      durationMs: elapsedMs(startedAt),
      responseHash: createContentHashFromObject(body),
      artifacts,
    };
  }
}

// ============================================================================
// REGISTRY
// ============================================================================

/**
 * Builds a registry of real HTTP Core clients from resolved endpoints.
 */
export function createHttpCoreClientRegistry(
  config: HttpCoreRegistryConfig
): CoreClientRegistry {
  const shared = {
    ...(config.timeoutMs !== undefined && { timeoutMs: config.timeoutMs }),
    ...(config.apiKey !== undefined && { apiKey: config.apiKey }),
    ...(config.fetchImpl !== undefined && { fetchImpl: config.fetchImpl }),
  };

  return {
    security: new HttpSecurityCoreClient({ baseUrl: config.endpoints.security, ...shared }),
    data: new HttpDataCoreClient({ baseUrl: config.endpoints.data, ...shared }),
    governance: new HttpGovernanceCoreClient({
      baseUrl: config.endpoints.governance,
      ...shared,
    }),
    automation: new HttpAutomationCoreClient({
      baseUrl: config.endpoints.automation,
      ...shared,
    }),
  };
}

/**
 * Builds the real Core client registry from environment configuration.
 *
 * FAILS CLOSED: propagates CoreConfigurationError when any of
 * SECURITY_CORE_URL, DATA_CORE_URL, GOVERNANCE_CORE_URL or
 * AUTOMATION_CORE_URL is absent. There is no mock fallback.
 */
export function createCoreClientRegistryFromEnv(
  env: NodeJS.ProcessEnv = process.env
): CoreClientRegistry {
  const timeoutRaw = env['CORE_REQUEST_TIMEOUT_MS'];
  const parsedTimeout = timeoutRaw ? Number.parseInt(timeoutRaw, 10) : NaN;

  return createHttpCoreClientRegistry({
    endpoints: resolveCoreEndpoints(env),
    ...(Number.isFinite(parsedTimeout) && { timeoutMs: parsedTimeout }),
    ...(env['PLATFORM_API_KEY'] !== undefined && { apiKey: env['PLATFORM_API_KEY'] }),
  });
}
