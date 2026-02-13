/**
 * Simulation configuration and result types.
 *
 * These types define the inputs and outputs of the simulation engine.
 *
 * @module types/simulation
 */

import type {
  SimulationId,
  ScenarioId,
  PolicyId,
  ISOTimestamp,
  StateVersion,
  ContentHash,
  SemanticVersion,
  ResourceLimits,
  TimingConfig,
  ExternalReference,
} from './ids.js';
import type { ArtifactManifest } from './artifact.js';
import type { ExecutionProof } from './execution-proof.js';

// ============================================================================
// SIMULATION STATUS
// ============================================================================

/**
 * Current status of a simulation.
 */
export type SimulationStatus =
  | 'queued'
  | 'initializing'
  | 'running'
  | 'paused'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

/**
 * Final outcome status of a completed simulation.
 */
export type SimulationOutcome =
  | 'success'
  | 'partial_success'
  | 'failure'
  | 'error'
  | 'timeout'
  | 'cancelled';

// ============================================================================
// SIMULATION CONFIGURATION
// ============================================================================

/**
 * Reference to a scenario for execution.
 */
export interface ScenarioReference {
  readonly scenarioId: ScenarioId;
  readonly version?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/**
 * Reference to a policy for application.
 */
export interface PolicyReference {
  readonly policyId: PolicyId;
  readonly version?: string;
  readonly overrides?: Readonly<Record<string, unknown>>;
}

/**
 * Configuration for a data source.
 */
export interface DataSourceConfig {
  readonly type: 'erp-surface' | 'costops' | 'mock' | 'inline';
  readonly id: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly refreshPolicy?: 'once' | 'on_demand' | 'periodic';
}

/**
 * Configuration for artifact generation.
 */
export interface ArtifactConfig {
  readonly generateReport: boolean;
  readonly generatePolicyLog: boolean;
  readonly generateStateSnapshots: boolean;
  readonly generateTrace: boolean;
  readonly formats: ReadonlyArray<'json' | 'yaml' | 'html' | 'pdf'>;
  readonly signArtifacts: boolean;
  readonly storageConfig?: {
    readonly type: 'local' | 's3' | 'gcs' | 'azure_blob';
    readonly basePath: string;
    readonly credentials?: string;
  };
}

/**
 * Configuration for observability (logging, metrics, tracing).
 */
export interface ObservabilityConfig {
  readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  readonly enableMetrics: boolean;
  readonly enableTracing: boolean;
  readonly traceSamplingRate: number;
  readonly exporters?: ReadonlyArray<{
    readonly type: 'console' | 'otlp' | 'jaeger';
    readonly endpoint?: string;
  }>;
}

/**
 * Metadata about a simulation.
 */
export interface SimulationMetadata {
  readonly name?: string;
  readonly description?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly labels?: Readonly<Record<string, string>>;
  readonly seed?: number;
  readonly requestedBy?: {
    readonly type: 'user' | 'api' | 'scheduler';
    readonly id: string;
    readonly name?: string;
  };
  readonly priority?: 'low' | 'normal' | 'high' | 'critical';
}

/**
 * Root configuration for a simulation execution.
 * This is the primary input to the simulation engine.
 */
export interface SimulationConfig {
  /** Unique identifier for this simulation run */
  readonly simulationId: SimulationId;
  /** Engine version for compatibility checking */
  readonly engineVersion?: SemanticVersion;
  /** Scenario to execute */
  readonly scenario: ScenarioReference;
  /** Policies to apply during execution */
  readonly policies: ReadonlyArray<PolicyReference>;
  /** Resource constraints */
  readonly resourceLimits: ResourceLimits;
  /** Timing configuration */
  readonly timing: TimingConfig;
  /** Data sources for the simulation */
  readonly dataSources: ReadonlyArray<DataSourceConfig>;
  /** Artifact generation configuration */
  readonly artifactConfig: ArtifactConfig;
  /** Observability configuration */
  readonly observability: ObservabilityConfig;
  /** Simulation metadata */
  readonly metadata: SimulationMetadata;
}

// ============================================================================
// SIMULATION RESULTS
// ============================================================================

/**
 * Timing information about the simulation execution.
 */
export interface ExecutionTiming {
  /** When the simulation started (wall clock) */
  readonly startTime: ISOTimestamp;
  /** When the simulation ended (wall clock) */
  readonly endTime: ISOTimestamp;
  /** Total wall-clock duration in milliseconds */
  readonly durationMs: number;
  /** Simulated time that passed during execution */
  readonly simulatedDurationMs: number;
  /** Time spent in each execution phase */
  readonly phaseTiming: Readonly<Record<string, number>>;
  /** Time spent waiting (e.g., for external data) */
  readonly waitTimeMs: number;
}

/**
 * Result of scenario execution.
 */
export interface ScenarioResult {
  /** Reference to the executed scenario */
  readonly scenario: ScenarioReference;
  /** Overall scenario status */
  readonly status: 'passed' | 'failed' | 'partial' | 'skipped';
  /** Results for each step */
  readonly stepResults: ReadonlyArray<StepResult>;
  /** Results for each expectation */
  readonly expectationResults: ReadonlyArray<ExpectationResult>;
  /** Coverage metrics */
  readonly coverage: {
    readonly stepsTotal: number;
    readonly stepsExecuted: number;
    readonly stepsPassed: number;
    readonly stepsFailed: number;
    readonly stepsSkipped: number;
    readonly branchesTotal: number;
    readonly branchesTaken: number;
  };
}

/**
 * Result of a single step execution.
 */
export interface StepResult {
  readonly stepId: string;
  readonly stepType: string;
  readonly status: 'success' | 'failure' | 'skipped' | 'policy_denied';
  readonly durationMs: number;
  readonly output?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly retryCount: number;
  readonly policyDecision?: {
    readonly outcome: string;
    readonly reason: string;
  };
}

/**
 * Result of an expectation evaluation.
 */
export interface ExpectationResult {
  readonly expectationId: string;
  readonly description: string;
  readonly passed: boolean;
  readonly actualValue?: unknown;
  readonly expectedValue?: unknown;
  readonly message?: string;
}

/**
 * Result of policy evaluation during simulation.
 */
export interface PolicyResult {
  /** Number of policies evaluated */
  readonly policiesEvaluated: number;
  /** Count of each decision type */
  readonly decisionCounts: Readonly<Record<string, number>>;
  /** List of policy violations */
  readonly violations: ReadonlyArray<PolicyViolation>;
  /** Overall compliance score (0-100) */
  readonly complianceScore: number;
  /** Results for each policy */
  readonly policyResults: ReadonlyArray<IndividualPolicyResult>;
}

/**
 * A policy violation that occurred during simulation.
 */
export interface PolicyViolation {
  readonly policyId: PolicyId;
  readonly ruleId: string;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly violationType: string;
  readonly description: string;
  readonly stepId?: string;
  readonly remediation?: string;
}

/**
 * Result for an individual policy.
 */
export interface IndividualPolicyResult {
  readonly policyId: PolicyId;
  readonly policyName: string;
  readonly evaluations: number;
  readonly allows: number;
  readonly denies: number;
  readonly warnings: number;
  readonly violations: number;
}

/**
 * Execution metrics for performance analysis.
 */
export interface ExecutionMetrics {
  /** Total events recorded */
  readonly totalEvents: number;
  /** Total state transitions */
  readonly stateTransitions: number;
  /** Total snapshots created */
  readonly snapshotsCreated: number;
  /** Peak memory usage in bytes */
  readonly peakMemoryBytes: number;
  /** Total external calls made */
  readonly externalCalls: number;
  /** Determinism verification result */
  readonly determinismVerified: boolean;
  /** Custom metrics */
  readonly custom?: Readonly<Record<string, number>>;
}

/**
 * Metadata about the simulation result.
 */
export interface ResultMetadata {
  /** Hash of the complete result for verification */
  readonly resultHash: ContentHash;
  /** Engine version that produced this result */
  readonly engineVersion: string;
  /** Environment where simulation ran */
  readonly environment: string;
  /** Whether result was cached */
  readonly cached: boolean;
}

/**
 * Reference to the execution trace.
 */
export interface TraceReference {
  readonly traceId: string;
  readonly location: string;
  readonly format: 'json' | 'otlp' | 'jaeger';
}

/**
 * Complete result of a simulation execution.
 * This is the primary output of the simulation engine.
 */
export interface SimulationResult {
  /** Unique identifier for this simulation */
  readonly simulationId: SimulationId;
  /** Final outcome status */
  readonly status: SimulationOutcome;
  /** Timing information */
  readonly timing: ExecutionTiming;
  /** Scenario execution results */
  readonly scenarioResult: ScenarioResult;
  /** Policy evaluation results */
  readonly policyResult: PolicyResult;
  /** Generated artifacts */
  readonly artifacts: ArtifactManifest;
  /** Execution metrics */
  readonly metrics: ExecutionMetrics;
  /** Final simulation state version */
  readonly finalStateVersion: StateVersion;
  /** Reference to detailed trace */
  readonly traceRef: TraceReference;
  /** Result metadata */
  readonly metadata: ResultMetadata;
  /**
   * Mandatory multi-layer execution proof.
   * MUST contain at least: foundational, intelligence, core layers.
   * Every successful response MUST include this proof.
   */
  readonly executionProof: ExecutionProof;
}

// ============================================================================
// DEFAULT CONFIGURATIONS
// ============================================================================

/**
 * Default artifact configuration.
 */
export const DEFAULT_ARTIFACT_CONFIG: ArtifactConfig = {
  generateReport: true,
  generatePolicyLog: true,
  generateStateSnapshots: false,
  generateTrace: true,
  formats: ['json'],
  signArtifacts: false,
} as const;

/**
 * Default observability configuration.
 */
export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  logLevel: 'info',
  enableMetrics: true,
  enableTracing: true,
  traceSamplingRate: 1.0,
} as const;
