/**
 * Mock Core Client Implementations.
 *
 * Provides mock implementations of all four external Agentics Core clients
 * for simulation isolation and testing. Each mock generates proper nested
 * span hierarchies (repo + agent spans) that pass validation.
 *
 * Follows the same pattern as mock-registry.ts in the adapters module.
 *
 * @module integration/cores/mock-cores
 */

import type {
  ISOTimestamp,
  SpanId,
  TraceId,
} from '../../types/common.js';
import { createSpanId } from '../../types/common.js';
import type { TraceSpanData } from '../../trace/span.js';
import type {
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
import type {
  SecurityCoreClient,
  DataCoreClient,
  AutomationCoreClient,
  GovernanceCoreClient,
  CoreClientRegistry,
  CoreHealth,
} from './core-client.js';
import { createContentHashFromObject } from '../../utils/hash.js';

// ============================================================================
// MOCK CONFIGURATION
// ============================================================================

/**
 * Configuration for mock Core clients.
 */
export interface MockCoreConfig {
  /** Simulated latency in milliseconds */
  readonly latencyMs?: number;
  /** Whether to simulate failures */
  readonly simulateFailures?: boolean;
  /** Failure rate (0-1) if simulateFailures is true */
  readonly failureRate?: number;
}

// ============================================================================
// SPAN HIERARCHY BUILDER
// ============================================================================

/**
 * Generates a mock ID string.
 */
function generateMockId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

/**
 * Builds a valid nested span hierarchy for a mock Core response.
 */
function buildMockSpanHierarchy(
  parentSpanId: SpanId,
  traceId: TraceId,
  coreName: string,
  agentNames: string[]
): CoreSpanHierarchy {
  const now = new Date().toISOString() as ISOTimestamp;
  const repoSpanId = createSpanId(`mock-repo-${generateMockId()}`);

  const repoSpan: TraceSpanData = {
    spanId: repoSpanId,
    traceId,
    parentSpanId,
    operationName: `${coreName}.repo`,
    serviceName: coreName,
    startTime: now,
    endTime: now,
    status: 'completed',
    durationMs: 1,
    attributes: { 'core.type': 'repo' },
    events: [],
    links: [],
  };

  const agentSpans: TraceSpanData[] = agentNames.map((name) => ({
    spanId: createSpanId(`mock-agent-${generateMockId()}`),
    traceId,
    parentSpanId: repoSpanId,
    operationName: `${coreName}.agent.${name}`,
    serviceName: coreName,
    startTime: now,
    endTime: now,
    status: 'completed',
    durationMs: 1,
    attributes: { 'core.type': 'agent', 'agent.name': name },
    events: [],
    links: [],
  }));

  return {
    parentSpanId,
    traceId,
    repoSpan,
    agentSpans,
    allSpans: [repoSpan, ...agentSpans],
  };
}

// ============================================================================
// MOCK SECURITY CORE CLIENT
// ============================================================================

/**
 * Mock implementation of LLM-Security-Core client.
 */
export class MockSecurityCoreClient implements SecurityCoreClient {
  readonly coreName = 'llm-security-core' as const;
  private readonly config: MockCoreConfig;

  constructor(config: MockCoreConfig = {}) {
    this.config = config;
  }

  async call(request: SecurityCoreRequest): Promise<SecurityCoreResponse> {
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const spanHierarchy = buildMockSpanHierarchy(
      request.parentSpanId,
      request.traceId,
      'llm-security-core',
      ['policy-evaluator']
    );

    return {
      coreName: 'llm-security-core',
      success: true,
      spanHierarchy,
      durationMs: this.config.latencyMs ?? 1,
      responseHash: createContentHashFromObject({ mock: true, ts: Date.now() }),
      policyResult: {
        policiesEvaluated: request.policyReferences.length,
        decisionCounts: {
          allow: request.policyReferences.length,
          deny: 0,
          warn: 0,
          require_approval: 0,
        },
        violations: [],
        complianceScore: 100,
        policyResults: [],
      },
      decisions: request.policyReferences.map((ref) => ({
        policyId: ref.policyId,
        outcome: 'allow' as const,
        reason: 'Mock policy evaluation: allowed',
        evaluationTimeMs: 1,
      })),
    };
  }

  async checkHealth(): Promise<CoreHealth> {
    return {
      coreName: 'llm-security-core',
      healthy: !this.config.simulateFailures,
      latencyMs: this.config.latencyMs ?? 0,
    };
  }

  private async simulateLatency(): Promise<void> {
    const latency = this.config.latencyMs ?? 0;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }

  private maybeSimulateFailure(): void {
    if (
      this.config.simulateFailures &&
      Math.random() < (this.config.failureRate ?? 0.1)
    ) {
      throw new Error('Simulated LLM-Security-Core failure');
    }
  }
}

// ============================================================================
// MOCK DATA CORE CLIENT
// ============================================================================

/**
 * Mock implementation of LLM-Data-Core client.
 */
export class MockDataCoreClient implements DataCoreClient {
  readonly coreName = 'llm-data-core' as const;
  private readonly config: MockCoreConfig;

  constructor(config: MockCoreConfig = {}) {
    this.config = config;
  }

  async call(request: DataCoreRequest): Promise<DataCoreResponse> {
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const spanHierarchy = buildMockSpanHierarchy(
      request.parentSpanId,
      request.traceId,
      'llm-data-core',
      ['cost-analyzer']
    );

    return {
      coreName: 'llm-data-core',
      success: true,
      spanHierarchy,
      durationMs: this.config.latencyMs ?? 1,
      responseHash: createContentHashFromObject({ mock: true, ts: Date.now() }),
      costMetrics: {
        totalCost: 0,
        currency: 'USD',
        breakdown: [],
      },
      executionMetrics: {
        externalCalls: 1,
      },
    };
  }

  async checkHealth(): Promise<CoreHealth> {
    return {
      coreName: 'llm-data-core',
      healthy: !this.config.simulateFailures,
      latencyMs: this.config.latencyMs ?? 0,
    };
  }

  private async simulateLatency(): Promise<void> {
    const latency = this.config.latencyMs ?? 0;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }

  private maybeSimulateFailure(): void {
    if (
      this.config.simulateFailures &&
      Math.random() < (this.config.failureRate ?? 0.1)
    ) {
      throw new Error('Simulated LLM-Data-Core failure');
    }
  }
}

// ============================================================================
// MOCK AUTOMATION CORE CLIENT
// ============================================================================

/**
 * Mock implementation of LLM-Automation-Core client.
 */
export class MockAutomationCoreClient implements AutomationCoreClient {
  readonly coreName = 'llm-automation-core' as const;
  private readonly config: MockCoreConfig;

  constructor(config: MockCoreConfig = {}) {
    this.config = config;
  }

  async call(request: AutomationCoreRequest): Promise<AutomationCoreResponse> {
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const spanHierarchy = buildMockSpanHierarchy(
      request.parentSpanId,
      request.traceId,
      'llm-automation-core',
      ['report-generator', 'audit-generator']
    );

    return {
      coreName: 'llm-automation-core',
      success: true,
      spanHierarchy,
      durationMs: this.config.latencyMs ?? 1,
      responseHash: createContentHashFromObject({ mock: true, ts: Date.now() }),
      artifacts: {
        simulationId: request.simulationId,
        generatedAt: request.requestedAt,
        artifacts: [],
        totalSizeBytes: 0,
        checksums: {},
        manifestHash: createContentHashFromObject({ empty: true }),
      },
    };
  }

  async checkHealth(): Promise<CoreHealth> {
    return {
      coreName: 'llm-automation-core',
      healthy: !this.config.simulateFailures,
      latencyMs: this.config.latencyMs ?? 0,
    };
  }

  private async simulateLatency(): Promise<void> {
    const latency = this.config.latencyMs ?? 0;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }

  private maybeSimulateFailure(): void {
    if (
      this.config.simulateFailures &&
      Math.random() < (this.config.failureRate ?? 0.1)
    ) {
      throw new Error('Simulated LLM-Automation-Core failure');
    }
  }
}

// ============================================================================
// MOCK GOVERNANCE CORE CLIENT
// ============================================================================

/**
 * Mock implementation of LLM-Governance-Core client.
 */
export class MockGovernanceCoreClient implements GovernanceCoreClient {
  readonly coreName = 'llm-governance-core' as const;
  private readonly config: MockCoreConfig;

  constructor(config: MockCoreConfig = {}) {
    this.config = config;
  }

  async call(
    request: GovernanceCoreRequest
  ): Promise<GovernanceCoreResponse> {
    await this.simulateLatency();
    this.maybeSimulateFailure();

    const spanHierarchy = buildMockSpanHierarchy(
      request.parentSpanId,
      request.traceId,
      'llm-governance-core',
      ['compliance-checker']
    );

    return {
      coreName: 'llm-governance-core',
      success: true,
      spanHierarchy,
      durationMs: this.config.latencyMs ?? 1,
      responseHash: createContentHashFromObject({ mock: true, ts: Date.now() }),
      validatedPolicyResult: request.policyResults,
      governanceMetrics: {
        complianceScore: 100,
        frameworkResults: (request.complianceRequirements ?? []).map((req) => ({
          framework: req.framework,
          score: 100,
          passed: req.controls.length,
          failed: 0,
        })),
      },
    };
  }

  async checkHealth(): Promise<CoreHealth> {
    return {
      coreName: 'llm-governance-core',
      healthy: !this.config.simulateFailures,
      latencyMs: this.config.latencyMs ?? 0,
    };
  }

  private async simulateLatency(): Promise<void> {
    const latency = this.config.latencyMs ?? 0;
    if (latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, latency));
    }
  }

  private maybeSimulateFailure(): void {
    if (
      this.config.simulateFailures &&
      Math.random() < (this.config.failureRate ?? 0.1)
    ) {
      throw new Error('Simulated LLM-Governance-Core failure');
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Creates a mock CoreClientRegistry with all four Core clients.
 *
 * @param config - Optional configuration for all mock clients
 * @returns CoreClientRegistry with mock implementations
 */
export function createMockCoreClientRegistry(
  config: MockCoreConfig = {}
): CoreClientRegistry {
  return {
    security: new MockSecurityCoreClient(config),
    data: new MockDataCoreClient(config),
    automation: new MockAutomationCoreClient(config),
    governance: new MockGovernanceCoreClient(config),
  };
}
