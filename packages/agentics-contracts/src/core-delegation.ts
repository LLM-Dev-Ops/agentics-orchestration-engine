/**
 * Core Delegation Types.
 *
 * Defines the type contracts for delegating execution responsibilities
 * to external Agentics Cores. The simulation engine acts as coordinator,
 * decomposing work and delegating to:
 *
 * - LLM-Security-Core: Policy evaluation
 * - LLM-Data-Core: Cost attribution
 * - LLM-Automation-Core: Artifact generation
 * - LLM-Governance-Core: Governance validation
 *
 * Each delegation propagates span context and requires nested span
 * hierarchies in responses. Flat results are rejected.
 *
 * @module types/core-delegation
 */

import type {
  SpanId,
  TraceId,
  ISOTimestamp,
  ContentHash,
  SimulationId,
} from './ids.js';
import type { TraceSpanData } from './trace.js';
import type { PolicyResult, ExecutionMetrics } from './simulation.js';
import type { ArtifactManifest } from './artifact.js';

// ============================================================================
// CORE IDENTIFIERS
// ============================================================================

/**
 * Identifies which external Agentics Core is being called.
 */
export type CoreName =
  | 'llm-security-core'
  | 'llm-data-core'
  | 'llm-automation-core'
  | 'llm-governance-core';

// ============================================================================
// SPAN HIERARCHY REQUIREMENT
// ============================================================================

/**
 * A nested span hierarchy returned by an external Core.
 *
 * REQUIREMENT: Every Core response MUST include at least:
 * - One "repo" span (representing the Core's repository-level work)
 * - One "agent" span nested under the repo span
 *
 * The engine validates this structure and REJECTS flat results.
 */
export interface CoreSpanHierarchy {
  /** The parent span ID assigned by the engine (the Core span). */
  readonly parentSpanId: SpanId;
  /** Trace ID propagated from the engine. */
  readonly traceId: TraceId;
  /** The Core's repo-level span (must have parentSpanId === parentSpanId above). */
  readonly repoSpan: TraceSpanData;
  /** Agent spans nested under the repo span. At least one required. */
  readonly agentSpans: ReadonlyArray<TraceSpanData>;
  /** All span data flattened for collector ingestion. */
  readonly allSpans: ReadonlyArray<TraceSpanData>;
}

// ============================================================================
// CORE REQUEST / RESPONSE BASE
// ============================================================================

/**
 * Base request sent to any external Core.
 * Includes span context for trace propagation.
 */
export interface CoreRequest {
  /** Simulation context */
  readonly simulationId: SimulationId;
  /** Trace ID for distributed tracing */
  readonly traceId: TraceId;
  /** Parent span ID - the Core MUST create children under this span */
  readonly parentSpanId: SpanId;
  /** Timestamp of the request */
  readonly requestedAt: ISOTimestamp;
  /** Timeout for the Core to respond */
  readonly timeoutMs: number;
}

/**
 * Base response from any external Core.
 * MUST include span hierarchy - flat results are rejected.
 */
export interface CoreResponse {
  /** The core that produced this response */
  readonly coreName: CoreName;
  /** Whether the core completed successfully */
  readonly success: boolean;
  /** Nested span hierarchy (MANDATORY - rejected if missing or flat) */
  readonly spanHierarchy: CoreSpanHierarchy;
  /** Duration of Core execution in ms */
  readonly durationMs: number;
  /** Content hash of the response for integrity */
  readonly responseHash: ContentHash;
  /** Error details if success is false */
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly recoverable: boolean;
  };
}

// ============================================================================
// LLM-SECURITY-CORE
// ============================================================================

/**
 * Request to LLM-Security-Core for policy evaluation.
 */
export interface SecurityCoreRequest extends CoreRequest {
  readonly coreType: 'llm-security-core';
  /** Policy references to evaluate */
  readonly policyReferences: ReadonlyArray<{
    readonly policyId: string;
    readonly version?: string;
  }>;
  /** The evaluation context (scenario info, action types, etc.) */
  readonly evaluationContext: Readonly<Record<string, unknown>>;
  /** Which phase: 'pre-execution' (INTELLIGENCE) or 'post-execution' (VALIDATION) */
  readonly phase: 'pre-execution' | 'post-execution';
  /** State data for policy evaluation */
  readonly stateSnapshot?: Readonly<Record<string, unknown>>;
}

/**
 * Response from LLM-Security-Core.
 */
export interface SecurityCoreResponse extends CoreResponse {
  readonly coreName: 'llm-security-core';
  /** Policy evaluation result in the format the engine expects */
  readonly policyResult: PolicyResult;
  /** Raw policy decisions for audit trail */
  readonly decisions: ReadonlyArray<{
    readonly policyId: string;
    readonly outcome: 'allow' | 'deny' | 'warn' | 'require_approval';
    readonly reason: string;
    readonly evaluationTimeMs: number;
  }>;
}

// ============================================================================
// LLM-DATA-CORE
// ============================================================================

/**
 * Request to LLM-Data-Core for cost attribution.
 */
export interface DataCoreRequest extends CoreRequest {
  readonly coreType: 'llm-data-core';
  /** Entity references for cost attribution */
  readonly entityReferences: ReadonlyArray<{
    readonly entityType: string;
    readonly entityId: string;
  }>;
  /** Scenario execution result summary for cost context */
  readonly executionSummary: Readonly<Record<string, unknown>>;
  /** Raw cost baseline data (passthrough from CostOps) */
  readonly costBaselines?: Readonly<Record<string, unknown>>;
}

/**
 * Response from LLM-Data-Core.
 */
export interface DataCoreResponse extends CoreResponse {
  readonly coreName: 'llm-data-core';
  /** Cost attribution metrics */
  readonly costMetrics: {
    readonly totalCost: number;
    readonly currency: string;
    readonly breakdown: ReadonlyArray<{
      readonly category: string;
      readonly amount: number;
      readonly description: string;
    }>;
  };
  /** Extended execution metrics with cost data */
  readonly executionMetrics: Partial<ExecutionMetrics>;
}

// ============================================================================
// LLM-AUTOMATION-CORE
// ============================================================================

/**
 * Request to LLM-Automation-Core for artifact generation.
 */
export interface AutomationCoreRequest extends CoreRequest {
  readonly coreType: 'llm-automation-core';
  /** The simulation result to generate artifacts from */
  readonly simulationResult: Readonly<Record<string, unknown>>;
  /** The simulation config for context */
  readonly simulationConfig: Readonly<Record<string, unknown>>;
  /** Which artifacts to generate */
  readonly artifactConfig: {
    readonly generateReport: boolean;
    readonly generatePolicyLog: boolean;
    readonly generateStateSnapshots: boolean;
    readonly generateTrace: boolean;
    readonly formats: ReadonlyArray<string>;
  };
}

/**
 * Response from LLM-Automation-Core.
 */
export interface AutomationCoreResponse extends CoreResponse {
  readonly coreName: 'llm-automation-core';
  /** The generated artifact manifest */
  readonly artifacts: ArtifactManifest;
}

// ============================================================================
// LLM-GOVERNANCE-CORE
// ============================================================================

/**
 * Request to LLM-Governance-Core for governance validation.
 */
export interface GovernanceCoreRequest extends CoreRequest {
  readonly coreType: 'llm-governance-core';
  /** Policy results from Security Core to validate */
  readonly policyResults: PolicyResult;
  /** Scenario execution results for governance review */
  readonly scenarioResults: Readonly<Record<string, unknown>>;
  /** Compliance requirements */
  readonly complianceRequirements?: ReadonlyArray<{
    readonly framework: string;
    readonly controls: ReadonlyArray<string>;
  }>;
}

/**
 * Response from LLM-Governance-Core.
 */
export interface GovernanceCoreResponse extends CoreResponse {
  readonly coreName: 'llm-governance-core';
  /** Validated and enriched policy result */
  readonly validatedPolicyResult: PolicyResult;
  /** Governance-specific metrics */
  readonly governanceMetrics: {
    readonly complianceScore: number;
    readonly frameworkResults: ReadonlyArray<{
      readonly framework: string;
      readonly score: number;
      readonly passed: number;
      readonly failed: number;
    }>;
  };
}

// ============================================================================
// SPAN VALIDATION
// ============================================================================

/**
 * Result of validating a Core's span hierarchy.
 */
export interface SpanValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<{
    readonly code: string;
    readonly message: string;
  }>;
}
